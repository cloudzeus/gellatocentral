// Ανοιχτοί λογαριασμοί στον server: άνοιγμα (τραπέζι ή ελεύθερος), αποστολές, ακύρωση γραμμής, πληρωμή.
// Κάθε συσκευή του καταστήματος βλέπει τους ίδιους λογαριασμούς· οι αλλαγές κλειδώνουν τη γραμμή του λογαριασμού.
import { type BillLineState, type BillPick, billStage, billTotals, canVoid, paidQuantity, pickDue, remaining } from "./bill";
import { db } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { tenantWriteTransaction } from "./migration-cutover";
import { issueRoundSlip, issueVoidSlips, type SlipCtx } from "./order-slips";
import type { PricedLine } from "./pos-cart";

type Ctx = { org: { id: string }; store: { id: string }; device: { id: string } };

/** Αποτυχία με γνωστή αιτία: το API τη στέλνει στη συσκευή με τον κωδικό της. */
export class BillError extends Error {
  constructor(readonly code: "not_found" | "closed" | "table_busy" | "paid_line" | "nothing_due" | "changed" | "too_much" | "sold_out", message: string) {
    super(message);
    this.name = "BillError";
  }
}

const lineSelect = {
  id: true, roundId: true, productId: true, name: true, quantity: true, unitPriceCents: true, vatRate: true, options: true, note: true, voidedAt: true, voidReason: true,
  seat: true, readyAt: true, servedAt: true, round: { select: { held: true, sentAt: true } },
  saleLines: { select: { quantity: true, sale: { select: { status: true } } } },
} satisfies Prisma.BillLineSelect;

const sumCents = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
// Μερίδια (μοίρασμα κατά ποσό) που εισπράχθηκαν και δεν έχουν μπει ακόμα σε ολοκληρωμένη απόδειξη
const heldShares = { status: "PAID", OR: [{ saleId: null }, { sale: { status: { not: "COMPLETED" } } }] } satisfies Prisma.BillShareWhereInput;
const summary = (lines: BillLineState[], held: { amountCents: number }[] = []) =>
  ({ ...billTotals(lines), heldCents: sumCents(held), items: lines.filter((l) => !l.voidedAt && !l.round?.held).reduce((s, l) => s + l.quantity, 0) });


/** Τι χρωστάει ο λογαριασμός και τι έχει εισπραχθεί ως μερίδια. Μέσα σε συναλλαγή που κλείδωσε τον λογαριασμό. */
export async function shareState(tx: Prisma.TransactionClient, billId: string) {
  const [lines, shares] = await Promise.all([
    tx.billLine.findMany({ where: { billId }, select: lineSelect }),
    tx.billShare.findMany({ where: { billId, status: { in: ["PENDING", "PAID"] }, saleId: null }, select: { status: true, amountCents: true } }),
  ]);
  const t = billTotals(lines);
  return { dueCents: t.dueCents, receiptPendingCents: t.pendingCents, heldCents: sumCents(shares.filter((x) => x.status === "PAID")), pendingCents: sumCents(shares.filter((x) => x.status === "PENDING")) };
}

/** Η κάτοψη: τα τραπέζια του καταστήματος και οι ανοιχτοί λογαριασμοί, με σύνολα. */
export async function storeBills(ctx: Ctx) {
  const [tables, bills] = await Promise.all([
    db.diningTable.findMany({ where: { orgId: ctx.org.id, storeId: ctx.store.id, active: true }, orderBy: [{ zone: "asc" }, { position: "asc" }, { name: "asc" }], select: { id: true, name: true, zone: true, seats: true } }),
    db.bill.findMany({
      where: { orgId: ctx.org.id, storeId: ctx.store.id, status: "OPEN" }, orderBy: { openedAt: "asc" },
      select: { id: true, tableId: true, label: true, guests: true, openedAt: true, openedByName: true, waiterId: true, billAskedAt: true, billAskedCash: true, lines: { select: { ...lineSelect, product: { select: { category: { select: { station: true } } } } } }, shares: { where: heldShares, select: { amountCents: true } } },
    }),
  ]);
  return { tables, soldOut: await soldOutIds(ctx), bills: bills.map(({ lines, shares, ...b }) => ({ ...b, ...summary(lines, shares), ...billStage(b, lines.map(({ product, ...l }) => ({ ...l, station: product.category.station }))) })) };
}

/** Οι ανοιχτοί λογαριασμοί ενός σερβιτόρου: πριν λήξει η βάρδια του κλείνουν ή παραδίδονται σε συνάδελφο. */
export async function waiterBills(orgId: string, storeId: string, waiterId: string) {
  const bills = await db.bill.findMany({
    where: { orgId, storeId, status: "OPEN", waiterId }, orderBy: { openedAt: "asc" },
    select: { id: true, label: true, openedAt: true, table: { select: { name: true } }, lines: { select: lineSelect }, shares: { where: heldShares, select: { amountCents: true } } },
  });
  return bills.map(({ lines, shares, table, ...b }) => { const s = summary(lines, shares); return { id: b.id, name: table ? `Τραπέζι ${table.name}` : b.label ?? "Λογαριασμός", openedAt: b.openedAt, dueCents: s.dueCents - s.heldCents, items: s.items }; });
}

/** Ο λογαριασμός με τις αποστολές του και, ανά γραμμή, τι πληρώθηκε και τι μένει. */
export async function billDetail(ctx: Ctx, billId: string) {
  const bill = await db.bill.findFirst({
    where: { id: billId, orgId: ctx.org.id, storeId: ctx.store.id },
    select: {
      id: true, status: true, label: true, guests: true, openedAt: true, openedByName: true, closedAt: true, billAskedAt: true, billAskedCash: true,
      table: { select: { id: true, name: true, zone: true, seats: true } },
      rounds: { orderBy: { number: "asc" }, select: { id: true, number: true, sentAt: true, sentByName: true, held: true } },
      lines: { orderBy: { id: "asc" }, select: lineSelect },
      sales: { where: { status: "COMPLETED" }, orderBy: { issuedAt: "asc" }, select: { id: true, series: true, aa: true, totalCents: true, issuedAt: true } },
      shares: {
        where: { OR: [heldShares, { status: "PENDING" }] }, orderBy: { createdAt: "asc" },
        select: { id: true, amountCents: true, status: true, paidAt: true, method: { select: { name: true, code: true } } },
      },
    },
  });
  if (!bill) return null;
  const { lines, shares, ...rest } = bill;
  return {
    ...rest, ...summary(lines, shares.filter((x) => x.status === "PAID")),
    shares: shares.map(({ method, ...x }) => ({ ...x, method: method.name, cash: method.code === "cash" })),
    // round μένει στον υπολογισμό (τα «Μετά» δεν χρωστιούνται ακόμα) αλλά όχι στην απάντηση
    lines: lines.map(({ saleLines, round, ...l }) => ({ ...l, remaining: remaining({ ...l, round, saleLines }), paid: paidQuantity({ ...l, saleLines }), canVoid: canVoid({ ...l, round, saleLines }) })),
  };
}

/** Ανοίγει λογαριασμό. Σε τραπέζι που έχει ήδη ανοιχτό, επιστρέφει εκείνον (δύο σερβιτόροι, ένα τραπέζι). */
export async function openBill(ctx: Ctx, input: { tableId?: string; label?: string; guests?: number; byName?: string; waiterId?: string }) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    if (input.tableId) {
      const [table] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "DiningTable" WHERE id = ${input.tableId} AND "orgId" = ${ctx.org.id} AND "storeId" = ${ctx.store.id} AND active FOR UPDATE`;
      if (!table) throw new BillError("not_found", "Το τραπέζι δεν υπάρχει σε αυτό το κατάστημα.");
      const open = await tx.bill.findFirst({ where: { tableId: table.id, status: "OPEN" }, select: { id: true } });
      if (open) return { id: open.id, existing: true };
    }
    const bill = await tx.bill.create({
      data: { orgId: ctx.org.id, storeId: ctx.store.id, tableId: input.tableId, label: input.label, guests: input.guests, openedByName: input.byName, waiterId: input.waiterId },
      select: { id: true },
    });
    return { id: bill.id, existing: false };
  });
}

async function lockOpenBill(tx: Prisma.TransactionClient, ctx: Ctx, billId: string) {
  const [bill] = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status FROM "Bill" WHERE id = ${billId} AND "orgId" = ${ctx.org.id} AND "storeId" = ${ctx.store.id} FOR UPDATE`;
  if (!bill) throw new BillError("not_found", "Ο λογαριασμός δεν βρέθηκε.");
  if (bill.status !== "OPEN") throw new BillError("closed", "Ο λογαριασμός έχει κλείσει.");
}

/** Νέα αποστολή: οι γραμμές μπαίνουν στον λογαριασμό με τις τιμές του καταλόγου εκείνη τη στιγμή. */
/** Νέα αποστολή: γραμμές + 8.6 (lib/order-slips.ts). Επιστρέφει και το 8.6, για υπογραφή μετά τη συναλλαγή (signOrderSlips). */
/** held («Μετά»): οι γραμμές γράφονται χωρίς 8.6 και χωρίς να χρωστιούνται· βγαίνουν με το fireRound. */
export async function addRound(ctx: SlipCtx, billId: string, lines: PricedLine[], byName?: string, held = false) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    await lockOpenBill(tx, ctx, billId);
    const last = await tx.billRound.findFirst({ where: { billId }, orderBy: { number: "desc" }, select: { number: true } });
    const round = await tx.billRound.create({ data: { billId, number: (last?.number ?? 0) + 1, deviceId: ctx.device.id, sentByName: byName, held }, select: { id: true, number: true } });
    await tx.billLine.createMany({ data: lines.map((l) => ({ ...l, options: l.options ?? undefined, billId, roundId: round.id })) });
    if (held) return { ...round, slipIds: [] as string[] };
    const slip = await issueRoundSlip(tx, ctx, round.id);
    return { ...round, slipIds: [slip.id] };
  });
}

/** «Βγάλ' το»: η αποστολή που περίμενε πάει τώρα σε κουζίνα/bar, με το 8.6 της, και μπαίνει στον λογαριασμό. */
export async function fireRound(ctx: SlipCtx, billId: string, roundId: string, byName?: string) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    await lockOpenBill(tx, ctx, billId);
    const fired = await tx.billRound.updateMany({ where: { id: roundId, billId, held: true }, data: { held: false, sentAt: new Date(), ...(byName ? { sentByName: byName } : {}) } });
    if (!fired.count) throw new BillError("changed", "Η αποστολή έχει ήδη βγει ή δεν υπάρχει.");
    // όλα ακυρωμένα όσο περίμενε: τίποτα για την κουζίνα, άρα ούτε 8.6
    if (!(await tx.billLine.count({ where: { roundId, voidedAt: null } }))) return { slipIds: [] as string[] };
    return { slipIds: [(await issueRoundSlip(tx, ctx, roundId)).id] };
  });
}

/** Ο σερβιτόρος σημειώνει ότι σέρβιρε (ή το αναιρεί). Μόνο γραμμές που έχουν βγει. */
export async function markServed(ctx: Ctx, billId: string, lineIds: string[], served: boolean) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    await lockOpenBill(tx, ctx, billId);
    const r = await tx.billLine.updateMany({ where: { billId, id: { in: lineIds }, voidedAt: null, round: { held: false } }, data: { servedAt: served ? new Date() : null } });
    return { count: r.count };
  });
}

/** «Ζήτησε λογαριασμό»: ο λογαριασμός μπαίνει στο «Σε περιμένουν» σερβιτόρου και ταμία. cash: θα πληρώσει μετρητά στον ταμία. */
export async function askBill(ctx: Ctx, billId: string, ask: boolean, cash = false) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    await lockOpenBill(tx, ctx, billId);
    await tx.bill.update({ where: { id: billId }, data: { billAskedAt: ask ? new Date() : null, billAskedCash: ask && cash } });
    return { ok: true };
  });
}

/** Τι έχει τελειώσει σήμερα στο κατάστημα: ids προϊόντων και επιλογών (γεύσεων). */
export async function soldOutIds(ctx: Ctx) {
  return (await db.soldOut.findMany({ where: { orgId: ctx.org.id, storeId: ctx.store.id }, select: { itemId: true } })).map((x) => x.itemId);
}

/** «Τελείωσε» / «Υπάρχει ξανά». Το id πρέπει να είναι προϊόν ή επιλογή της επιχείρησης. */
export async function setSoldOut(ctx: Ctx, itemId: string, out: boolean, byName?: string) {
  const known = (await db.product.count({ where: { id: itemId, orgId: ctx.org.id } })) || (await db.modifierOption.count({ where: { id: itemId, group: { orgId: ctx.org.id } } }));
  if (!known) throw new BillError("not_found", "Το είδος δεν βρέθηκε στον κατάλογο.");
  if (out) await db.soldOut.upsert({ where: { storeId_itemId: { storeId: ctx.store.id, itemId } }, create: { orgId: ctx.org.id, storeId: ctx.store.id, itemId, byName }, update: {} });
  else await db.soldOut.deleteMany({ where: { storeId: ctx.store.id, itemId } });
  return soldOutIds(ctx);
}

/** Ακύρωση γραμμής πριν πληρωθεί (λάθος παραγγελία, ο πελάτης το άλλαξε). Η γραμμή μένει, σημειωμένη. */
export async function voidLine(ctx: SlipCtx, billId: string, lineId: string, reason: string) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    await lockOpenBill(tx, ctx, billId);
    const line = await tx.billLine.findFirst({ where: { id: lineId, billId }, select: lineSelect });
    if (!line) throw new BillError("not_found", "Η γραμμή δεν βρέθηκε.");
    if (!canVoid(line)) throw new BillError("paid_line", "Η γραμμή έχει πληρωθεί ή πληρώνεται τώρα· δεν ακυρώνεται.");
    // Με εισπραγμένα μερίδια ο λογαριασμός πρέπει να χρωστάει ακόμα κάτι πάνω από αυτά, αλλιώς δεν βγαίνει η απόδειξη
    const s = await shareState(tx, billId);
    if (s.pendingCents > 0 || (s.heldCents > 0 && s.dueCents - remaining(line) * line.unitPriceCents <= s.heldCents))
      throw new BillError("paid_line", "Έχουν εισπραχθεί μερίδια του λογαριασμού: χωρίς αυτή τη γραμμή δεν καλύπτονται. Κλείσε πρώτα το μοίρασμα.");
    // ο λογαριασμός μένει ανοιχτός ακόμη κι αν άδειασε: συνήθως ακολουθεί η σωστή παραγγελία
    await tx.billLine.update({ where: { id: lineId }, data: { voidedAt: new Date(), voidReason: reason } });
    // ακυρωτικό 8.6 για ό,τι δεν πληρώθηκε από τη γραμμή
    return (await issueVoidSlips(tx, ctx, [{ ...line, quantity: remaining(line) }])).map((d) => d.id);
  });
}

/** Κλείνει λογαριασμό χωρίς πληρωμή (ο πελάτης έφυγε πριν παραγγείλει, ανοίχτηκε κατά λάθος). Μόνο αν δεν έχει πληρωθεί τίποτα. */
export async function cancelBill(ctx: SlipCtx, billId: string, reason: string) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    await lockOpenBill(tx, ctx, billId);
    const lines = await tx.billLine.findMany({ where: { billId }, select: lineSelect });
    if (lines.some((l) => !l.voidedAt && !canVoid(l))) throw new BillError("paid_line", "Ο λογαριασμός έχει πληρωμές· κλείνει με πληρωμή του υπολοίπου.");
    const s = await shareState(tx, billId);
    if (s.heldCents + s.pendingCents > 0) throw new BillError("paid_line", "Έχουν εισπραχθεί μερίδια του λογαριασμού· κλείνει με πληρωμή του υπολοίπου.");
    const now = new Date();
    await tx.billLine.updateMany({ where: { billId, voidedAt: null }, data: { voidedAt: now, voidReason: reason } });
    await tx.bill.update({ where: { id: billId }, data: { status: "CANCELLED", closedAt: now } });
    return (await issueVoidSlips(tx, ctx, lines.filter((l) => !l.voidedAt).map((l) => ({ ...l, quantity: remaining(l) })))).map((d) => d.id);
  });
}

/**
 * Φτιάχνει την πρόχειρη απόδειξη για ό,τι μένει απλήρωτο στον λογαριασμό, ή μόνο για όσα διάλεξε ο ταμίας (pick). Η έκδοση/πληρωμή γίνεται μετά με το issueSale,
 * όπως στην άμεση πώληση. Οι γραμμές δένονται με τον λογαριασμό (billLineId), ώστε μετά την πληρωμή να ξέρουμε τι κάλυψε.
 */
export async function draftSettlement(ctx: Ctx, billId: string, pick?: BillPick[]) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    await lockOpenBill(tx, ctx, billId);
    const lines = await tx.billLine.findMany({ where: { billId }, orderBy: { id: "asc" }, select: lineSelect });
    const all = lines.map((l) => ({ l, q: remaining(l) })).filter((x) => x.q > 0);
    // Ο λογαριασμός είναι κλειδωμένος: τα υπόλοιπα που βλέπουμε εδώ δεν αλλάζουν ως το τέλος της συναλλαγής.
    const due = pick ? pickDue(all, pick) : all;
    if (!due) throw new BillError("changed", "Κάποια είδη πληρώθηκαν ή ακυρώθηκαν στο μεταξύ. Ξαναδιάλεξε από τον λογαριασμό.");
    const s = await shareState(tx, billId);
    if (s.pendingCents > 0) throw new BillError("changed", "Εισπράττεται τώρα μέρος του λογαριασμού στο τερματικό· περίμενε να τελειώσει.");
    if (pick && s.heldCents > 0) throw new BillError("changed", "Ο λογαριασμός μοιράζεται κατά ποσό: πληρώνεται μόνο όλο το υπόλοιπο.");
    if (due.length === 0) throw new BillError("nothing_due", "Ο λογαριασμός δεν χρωστάει κάτι· αν περιμένει πληρωμή, ολοκλήρωσέ την πρώτα.");
    await tx.sale.deleteMany({ where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "DRAFT" } });
    return tx.sale.create({
      data: {
        orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id, billId,
        lines: {
          create: due.map(({ l, q }) => ({
            productId: l.productId, name: l.name, quantity: q, unitPriceCents: l.unitPriceCents, vatRate: l.vatRate,
            options: l.options ?? undefined, note: l.note, billLineId: l.id,
          })),
        },
      },
      select: { id: true },
    });
  });
}

/** Μετά από πληρωμή: εξοφλημένος όταν δεν χρωστάει τίποτα και δεν περιμένει άλλη πληρωμή. Μέσα στη συναλλαγή της πληρωμής. */
export async function closeBillIfDone(tx: Prisma.TransactionClient, billId: string) {
  const lines = await tx.billLine.findMany({ where: { billId }, select: lineSelect });
  const t = billTotals(lines);
  // ό,τι περιμένει («Μετά») δεν έχει έρθει ακόμα στο τραπέζι: ο λογαριασμός μένει ανοιχτός γι' αυτό
  if (t.dueCents > 0 || t.pendingCents > 0 || t.paidCents === 0 || lines.some((l) => !l.voidedAt && l.round?.held)) return;
  await tx.bill.updateMany({ where: { id: billId, status: "OPEN" }, data: { status: "SETTLED", closedAt: new Date() } });
}
