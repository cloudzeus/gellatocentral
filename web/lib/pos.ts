// Έκδοση απόδειξης: κοινή λογική για το ταμείο του browser (server actions) και την εφαρμογή Android (API).
import { terminalFiscal, transmissionNote } from "./viva/sign";
import { randomUUID } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { remaining } from "./bill";
import { BillError, closeBillIfDone, shareState } from "./bills";
import { tenantWriteTransaction } from "./migration-cutover";
import { lineDescription } from "./pos-modifiers";
import { buildPaymentProtocol, buildReceipt, type Prior, toVivaJson } from "./viva/fiscal";

/** Αποτυχία έκδοσης με γνωστή αιτία: το API του ταμείου τη στέλνει στη συσκευή με τον κωδικό της. */
export class PosError extends Error {
  constructor(readonly code: "busy" | "method_unavailable", message: string) {
    super(message);
    this.name = "PosError";
  }
}

// Η γραμμή της απόδειξης γράφει και τις επιλογές («Χωνάκι · Φιστίκι, Σαντιγί»)· η τιμή τους είναι ήδη στο unitPriceCents.
const fiscalLines = (lines: { name: string; options: Prisma.JsonValue; note: string | null; quantity: number; unitPriceCents: number; vatRate: number }[]) =>
  lines.map((l) => ({ name: lineDescription(l), quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: l.vatRate }));

/**
 * Πληρωμή λογαριασμού: ανάμεσα στο πρόχειρο και την έκδοση μια άλλη συσκευή μπορεί να πλήρωσε τις ίδιες γραμμές.
 * Κλείδωμα του λογαριασμού και νέος έλεγχος του υπολοίπου, ώστε η ίδια γραμμή να μη χρεωθεί δύο φορές.
 */
async function assertStillDue(tx: Prisma.TransactionClient, billId: string, lines: { billLineId: string | null; quantity: number }[]) {
  await tx.$queryRaw`SELECT id FROM "Bill" WHERE id = ${billId} FOR UPDATE`;
  const ids = lines.map((l) => l.billLineId).filter((x): x is string => !!x);
  const billLines = await tx.billLine.findMany({ where: { id: { in: ids } }, select: { id: true, quantity: true, unitPriceCents: true, voidedAt: true, saleLines: { select: { quantity: true, sale: { select: { status: true } } } } } });
  for (const l of lines) {
    const bl = billLines.find((b) => b.id === l.billLineId);
    if (!bl || l.quantity > remaining(bl)) throw new BillError("nothing_due", "Μέρος του λογαριασμού πληρώθηκε μόλις από άλλη συσκευή· άνοιξέ τον ξανά.");
  }
}

type Ctx = { org: { id: string }; issuer: { vatNumber: string }; device: { id: string; series: string } }; // issuer: lib/documents/issuer.ts

/** Μία πληρωμή τη φορά ανά ταμείο: απόδειξη ή μερίδιο λογαριασμού στο τερματικό. Μέσα σε κλείδωμα της συσκευής. */
async function assertIdle(tx: Prisma.TransactionClient, deviceId: string) {
  if (await tx.sale.findFirst({ where: { deviceId, status: "AWAITING_PAYMENT" }, select: { id: true } }) || await tx.billShare.findFirst({ where: { deviceId, status: "PENDING" }, select: { id: true } }))
    throw new PosError("busy", "Υπάρχει ήδη πληρωμή σε εξέλιξη σε αυτό το ταμείο.");
}

type HeldShare = { id: string; amountCents: number; vivaTransactionId: string | null; paidAt: Date | null; createdAt: Date; method: { name: string; payItemCase: number | null } };
const priorOf = (shares: HeldShare[]): Prior[] =>
  shares.map((h) => ({ description: h.method.name, payItemCase: h.method.payItemCase!, transactionId: h.vivaTransactionId ?? undefined, amountCents: h.amountCents, moment: h.paidAt ?? h.createdAt }));
const heldInclude = { method: { select: { name: true, payItemCase: true } } } as const;

/**
 * Κλειδώνει τη συσκευή, δίνει ΑΑ και γράφει πληρωμή + παραστατικό.
 * `live` = η πληρωμή/σήμανση θα γίνει στη Viva· ο ΑΑ «καίγεται» μόνο στο completeSale.
 * Αλλιώς (δοκιμαστική λειτουργία) η πώληση ολοκληρώνεται αμέσως, χωρίς διαβίβαση.
 */
export async function issueSale(ctx: Ctx, saleId: string, methodId: string, live: boolean) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    // Κλείδωμα της συσκευής: δύο ταυτόχρονες πληρωμές δεν πρέπει να πάρουν τον ίδιο ΑΑ.
    const [{ nextAa }] = await tx.$queryRaw<{ nextAa: number }[]>`SELECT "nextAa" FROM "Device" WHERE id = ${ctx.device.id} FOR UPDATE`;
    await assertIdle(tx, ctx.device.id);
    const sale = await tx.sale.findFirst({ where: { id: saleId, orgId: ctx.org.id, deviceId: ctx.device.id, status: "DRAFT" }, include: { lines: { orderBy: { id: "asc" } } } }); // σταθερή σειρά: η ίδια απόδειξη ξαναχτίζεται στο pendingSale
    if (!sale || sale.lines.length === 0) return null;
    if (sale.billId) await assertStillDue(tx, sale.billId, sale.lines);
    // Μοίρασμα κατά ποσό: ό,τι εισπράχθηκε ήδη μπαίνει στις πληρωμές της απόδειξης, το τερματικό χρεώνει μόνο το υπόλοιπο
    const held = sale.billId ? await tx.billShare.findMany({ where: { billId: sale.billId, status: "PAID", saleId: null }, include: heldInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];
    if (sale.billId) {
      const s = await shareState(tx, sale.billId);
      if (s.pendingCents > 0) throw new BillError("changed", "Εισπράττεται τώρα μέρος του λογαριασμού σε άλλη συσκευή· περίμενε να τελειώσει.");
      if (held.length && s.dueCents !== sale.lines.reduce((t, l) => t + l.quantity * l.unitPriceCents, 0))
        throw new BillError("changed", "Έχουν εισπραχθεί μερίδια: η απόδειξη πρέπει να πάρει όλο το υπόλοιπο του λογαριασμού.");
    }

    // Ο τρόπος πληρωμής από την κοινή λίστα: μόνο ενεργός, για ταμείο, με φορολογική αντιστοίχιση
    const method = await tx.paymentMethod.findFirst({ where: { id: methodId, active: true, posEnabled: true } });
    if (!method?.payItemCase) throw new PosError("method_unavailable", "Ο τρόπος πληρωμής δεν είναι διαθέσιμος στο ταμείο.");

    // 8.6 των αποστολών που εξοφλεί η απόδειξη· τα NOT_SENT (δοκιμαστική λειτουργία) δεν υπάρχουν στη Viva
    const orderSlips = sale.billId ? (await tx.fiscalDocument.findMany({
      where: { docType: "8.6", status: { not: "NOT_SENT" }, billRound: { lines: { some: { id: { in: sale.lines.map((l) => l.billLineId).filter((x): x is string => !!x) } } } } },
      orderBy: { createdAt: "asc" }, select: { receiptReference: true },
    })).map((d) => d.receiptReference) : [];
    const reference = randomUUID(); // νέο σε κάθε προσπάθεια: η Viva επιστρέφει το παλιό αποτέλεσμα σε ίδιο sessionId
    const issuedAt = new Date();
    const receipt = buildReceipt({
      merchantVat: ctx.issuer.vatNumber,
      series: ctx.device.series,
      aa: nextAa,
      reference,
      moment: issuedAt,
      payItem: { description: method.name, payItemCase: method.payItemCase },
      lines: fiscalLines(sale.lines),
      prior: priorOf(held),
      orderSlips,
    });
    const chargeCents = receipt.totalCents - held.reduce((t, h) => t + h.amountCents, 0);

    // προηγούμενη αποτυχημένη προσπάθεια της ίδιας πώλησης
    await tx.payment.deleteMany({ where: { saleId: sale.id } });
    await tx.fiscalDocument.deleteMany({ where: { saleId: sale.id } });
    await tx.payment.create({ data: { saleId: sale.id, methodId: method.id, amountCents: chargeCents, vivaSessionId: live ? reference : null, success: !live } });
    await tx.fiscalDocument.create({ data: { saleId: sale.id, orgId: ctx.org.id, receiptReference: reference, status: live ? "PENDING" : "NOT_SENT", request: JSON.parse(toVivaJson(receipt.data)) } });
    await tx.sale.update({
      where: { id: sale.id },
      data: { status: live ? "AWAITING_PAYMENT" : "COMPLETED", totalCents: receipt.totalCents, series: ctx.device.series, aa: nextAa, issuedAt },
    });
    if (held.length) await tx.billShare.updateMany({ where: { id: { in: held.map((h) => h.id) } }, data: { saleId: sale.id } });
    if (!live) {
      await tx.device.update({ where: { id: ctx.device.id }, data: { nextAa: { increment: 1 } } });
      if (sale.billId) await closeBillIfDone(tx, sale.billId);
    }
    return { saleId: sale.id, reference, receipt, chargeCents };
  });
}

/**
 * Μοίρασμα κατά ποσό: εισπράττει μέρος του λογαριασμού πριν από την απόδειξη. Κάρτα: «payment protocol» στο Viva Terminal
 * (PENDING ως το αποτέλεσμα). Μετρητά ή δοκιμαστική λειτουργία: καταγράφεται αμέσως ως εισπραγμένο. Το τελευταίο μέρος
 * δεν περνά από εδώ: πληρώνεται με την απόδειξη του υπολοίπου (settle), που γράφει όλα τα μερίδια.
 */
export async function startShare(ctx: Ctx & { store: { id: string } }, billId: string, methodId: string, amountCents: number, live: boolean) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Device" WHERE id = ${ctx.device.id} FOR UPDATE`;
    await assertIdle(tx, ctx.device.id);
    const [bill] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Bill" WHERE id = ${billId} AND "orgId" = ${ctx.org.id} AND "storeId" = ${ctx.store.id} FOR UPDATE`;
    if (!bill) throw new BillError("not_found", "Ο λογαριασμός δεν βρέθηκε.");
    if (bill.status !== "OPEN") throw new BillError("closed", "Ο λογαριασμός έχει κλείσει.");
    const s = await shareState(tx, billId);
    if (s.receiptPendingCents > 0) throw new BillError("changed", "Πληρώνεται τώρα απόδειξη αυτού του λογαριασμού· περίμενε να τελειώσει.");
    if (s.pendingCents > 0) throw new BillError("changed", "Εισπράττεται τώρα μέρος του λογαριασμού σε άλλη συσκευή· περίμενε να τελειώσει.");
    if (amountCents >= s.dueCents - s.heldCents) throw new BillError("too_much", "Το ποσό καλύπτει όλο το υπόλοιπο: πλήρωσέ το με την απόδειξη.");
    const method = await tx.paymentMethod.findFirst({ where: { id: methodId, active: true, posEnabled: true } });
    if (!method?.payItemCase) throw new PosError("method_unavailable", "Ο τρόπος πληρωμής δεν είναι διαθέσιμος στο ταμείο.");

    const terminal = live && method.provider === "VIVA_TERMINAL";
    const createdAt = new Date();
    const share = await tx.billShare.create({
      data: { orgId: ctx.org.id, storeId: ctx.store.id, billId, deviceId: ctx.device.id, methodId, amountCents, reference: randomUUID(), createdAt, status: terminal ? "PENDING" : "PAID", paidAt: terminal ? null : createdAt },
    });
    return { share, methodName: method.name, start: terminal ? shareStart(share, method) : null };
  });
}

const shareStart = (share: { id: string; reference: string; amountCents: number; createdAt: Date }, method: { name: string; payItemCase: number | null }) => ({
  saleId: share.id, // η εφαρμογή το χειρίζεται όπως μια πώληση (clientTransactionId, /api/pos/sales/[id]/result)
  reference: share.reference,
  receipt: { totalCents: share.amountCents, data: buildPaymentProtocol({ reference: share.reference, moment: share.createdAt, amountCents: share.amountCents, payItem: { description: method.name, payItemCase: method.payItemCase! } }) },
  chargeCents: share.amountCents,
});

/** Η Viva επιβεβαίωσε τη χρέωση του μεριδίου. Idempotent. */
export async function completeShare(deviceId: string, shareId: string, raw: Prisma.InputJsonValue, transactionId: string | undefined, orgId: string) {
  await tenantWriteTransaction(orgId, (tx) => tx.billShare.updateMany({ where: { id: shareId, orgId, deviceId, status: "PENDING" }, data: { status: "PAID", vivaTransactionId: transactionId, raw, paidAt: new Date() } }), { purpose: "SETTLEMENT" });
}

export async function failShare(deviceId: string, shareId: string, raw: Prisma.InputJsonValue | undefined, orgId: string) {
  await tenantWriteTransaction(orgId, (tx) => tx.billShare.updateMany({ where: { id: shareId, orgId, deviceId, status: "PENDING" }, data: { status: "FAILED", raw } }), { purpose: "SETTLEMENT" });
}

/**
 * Η πώληση της συσκευής που περιμένει πληρωμή, με ό,τι χρειάζεται η εφαρμογή για να ξανανοίξει το Viva Terminal.
 * Η απόδειξη ξαναχτίζεται από τα αποθηκευμένα στοιχεία (ίδιος ΑΑ, ίδιο reference, ίδια ώρα): το αποθηκευμένο JSON του
 * αιτήματος δεν κάνει, γιατί οι 64-bit κωδικοί της σήμανσης χάνουν ακρίβεια όταν περάσουν από JSON.parse.
 */
export async function pendingSale(db: Pick<Prisma.TransactionClient, "sale" | "billShare">, ctx: Ctx) {
  const sale = await db.sale.findFirst({
    where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "AWAITING_PAYMENT" },
    include: { lines: { orderBy: { id: "asc" } }, payment: { include: { method: true } }, shares: { include: heldInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, fiscal: { select: { request: true } } },
  });
  if (!sale) {
    // ή ένα μερίδιο λογαριασμού που έμεινε στο τερματικό
    const share = await db.billShare.findFirst({ where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "PENDING" }, include: { method: true } });
    return share && { ...shareStart(share, share.method), methodId: share.methodId, methodName: share.method.name, issuedAt: share.createdAt };
  }
  const method = sale.payment?.method;
  if (!sale.aa || !sale.issuedAt || !sale.payment?.vivaSessionId || !method?.payItemCase) return null;
  const receipt = buildReceipt({
    merchantVat: ctx.issuer.vatNumber, series: sale.series ?? ctx.device.series, aa: sale.aa, reference: sale.payment.vivaSessionId, moment: sale.issuedAt,
    payItem: { description: method.name, payItemCase: method.payItemCase }, lines: fiscalLines(sale.lines), prior: priorOf(sale.shares),
    orderSlips: [(sale.fiscal?.request as { cbPreviousReceiptReference?: string | string[] } | null)?.cbPreviousReceiptReference ?? []].flat(), // κείμενα: δεν χάνουν ακρίβεια
  });
  return { saleId: sale.id, reference: sale.payment.vivaSessionId, receipt, chargeCents: sale.payment.amountCents, methodId: method.id, methodName: method.name, issuedAt: sale.issuedAt };
}

/** Η Viva επιβεβαίωσε πληρωμή και σήμανση. Το settlement επιτρέπεται και κατά το freeze. */
export async function completeSale(deviceId: string, saleId: string, raw: Prisma.InputJsonValue, transactionId: string | undefined, orgId: string) {
  await tenantWriteTransaction(orgId, async (tx) => {
    const { count } = await tx.sale.updateMany({ where: { id: saleId, orgId, deviceId, status: "AWAITING_PAYMENT" }, data: { status: "COMPLETED" } });
    if (count === 0) return;
    await tx.payment.update({ where: { saleId }, data: { success: true, vivaTransactionId: transactionId, raw } });
    // όλη η απάντηση φυλάσσεται· το MARK και σε στήλη, για τα πιστωτικά και την αναζήτηση (QR/σύνδεσμος: terminalFiscal)
    await tx.fiscalDocument.update({ where: { saleId }, data: { status: "SIGNED", response: raw, mark: terminalFiscal(raw).mark ?? null, error: transmissionNote(raw) } });
    await tx.device.update({ where: { id: deviceId }, data: { nextAa: { increment: 1 } } });
    // πληρωμή λογαριασμού τραπεζιού: κλείνει όταν εξοφληθεί όλος
    const { billId } = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, select: { billId: true } });
    if (billId) await closeBillIfDone(tx, billId);
  }, { purpose: "SETTLEMENT" });
}

/** Η πληρωμή δεν έγινε: η πώληση γυρίζει σε πρόχειρο και ο ΑΑ μένει ελεύθερος για την επόμενη. */
export async function failSale(deviceId: string, saleId: string, error: string, raw: Prisma.InputJsonValue | undefined, orgId: string) {
  await tenantWriteTransaction(orgId, async (tx) => {
    const { count } = await tx.sale.updateMany({ where: { id: saleId, orgId, deviceId, status: "AWAITING_PAYMENT" }, data: { status: "DRAFT", series: null, aa: null, issuedAt: null } });
    if (count === 0) return;
    await tx.fiscalDocument.update({ where: { saleId }, data: { status: "FAILED", error } });
    await tx.payment.update({ where: { saleId }, data: { success: false, raw } });
    await tx.billShare.updateMany({ where: { saleId }, data: { saleId: null } }); // τα μερίδια μένουν εισπραγμένα για την επόμενη προσπάθεια
  }, { purpose: "SETTLEMENT" });
}
