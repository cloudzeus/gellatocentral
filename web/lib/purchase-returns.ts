// Επιστροφές σε προμηθευτή και πιστωτικά προμηθευτή, πάνω στο PurchaseDoc.
// RETURN: δική μας επιστροφή ειδών· με την έκδοση φεύγει απόθεμα και βγαίνει 9.3 με σκοπό 5 «Επιστροφή» (όπως η χονδρική:
// απόθεμα με την έκδοση, η διαβίβαση χωριστά με επανάληψη). CREDIT: το 5.1/5.2 του προμηθευτή· μειώνει ό,τι του χρωστάμε
// για το τιμολόγιο (PurchaseDoc.creditCents του τιμολογίου) και, μόνο αν «επιστρέφονται τώρα», βγάζει και απόθεμα.
import { randomUUID } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { writeAudit } from "./audit";
import { addressGaps } from "./documents/build";
import { advanceSeries, lockSeries, SeriesError } from "./documents/series";
import { calculatePurchaseDocument, partySnapshot } from "./purchase-document";
import { lineBaseQty, PurchaseError } from "./purchases";
import { checkQuantities, returnable, type LineQty } from "./purchase-returns-rules";
import { postStockMovement, STOCK_ERROR_MESSAGE, StockError } from "./stock-db";
import { stockTransaction } from "./stock-transaction";
import { assertStockScope, STOCK_SCOPE_ERROR_MESSAGE, StockScopeError, type StockContext } from "./stock-scope";

type Tx = Prisma.TransactionClient;
// Το τιμολόγιο παραγγελίας δεν έγραψε απόθεμα (το έγραψαν τα δελτία): επιστροφή από αυτό θα έβγαζε 9.3 χωρίς να φύγει τίποτα.
const ORDER_INVOICE_NO_STOCK = "Το τιμολόγιο παραγγελίας δεν έγραψε απόθεμα· για είδη που δεν ήρθαν κλείσε τα με αίτημα πιστωτικού από την παραγγελία";
export type StockMode = "returned" | "now" | "value";
export { awaitingCredit, checkQuantities, returnable, type LineQty } from "./purchase-returns-rules";

const docTotal = (doc: { lines: { quantity: number; unitPriceCents: number; discountBps: number; vatRate: number }[]; shippingCostCents: number; otherExpensesCents: number; expensesVatRate: number }) =>
  calculatePurchaseDocument(doc.lines, doc).totalCents;

async function lockInvoice(tx: Tx, orgId: string, invoiceId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`purchase-adjust:${orgId}:${invoiceId}`}, 0))) AS lock`;
  const invoice = await tx.purchaseDoc.findFirst({ where: { id: invoiceId, orgId, kind: "INVOICE", status: "POSTED" }, include: { lines: true } });
  if (!invoice) throw new PurchaseError("Το τιμολόγιο αγοράς δεν βρέθηκε ή δεν είναι καταχωρημένο");
  return invoice;
}

/** Όσα έχουν ήδη επιστραφεί από το τιμολόγιο: επιστροφές (και πρόχειρες, για να μη διπλοδεσμεύονται) και πιστωτικά «τώρα». */
async function leftToReturn(tx: Tx, invoice: { id: string; orgId: string; lines: { id: string; quantity: number }[] }, exceptDocId?: string) {
  const prior = await tx.purchaseLine.findMany({
    where: { orgId: invoice.orgId, document: { relatedId: invoice.id, status: { not: "CANCELLED" }, id: exceptDocId ? { not: exceptDocId } : undefined, OR: [{ kind: "RETURN" }, { kind: "CREDIT", stockMode: "now" }] } },
    select: { sourceLineId: true, quantity: true },
  });
  return returnable(invoice.lines, prior);
}

const copyLine = (orgId: string, l: Prisma.PurchaseLineGetPayload<object>, quantity: number) => ({
  orgId, description: l.description, supplierCode: l.supplierCode, ean: l.ean, quantity, unitPriceCents: l.unitPriceCents, discountBps: l.discountBps, vatRate: l.vatRate,
  batchNumber: l.batchNumber, expiresAt: l.expiresAt, supplierItemId: l.supplierItemId, tradeItemId: l.tradeItemId, genericItemId: l.genericItemId, matchNote: l.matchNote, sourceLineId: l.id,
});

/** Βγάζει από την αποθήκη τις γραμμές ενός RETURN/CREDIT, από τις ίδιες παρτίδες που έφτιαξε η αγορά, στο μέσο κόστος. */
async function stockOut(tx: Tx, ctx: StockContext, docId: string, source: string, at: Date) {
  const doc = await tx.purchaseDoc.findFirstOrThrow({ where: { id: docId, orgId: ctx.orgId }, include: { lines: { include: { supplierItem: true, tradeItem: true, genericItem: true } } } });
  await assertStockScope(tx, ctx, { warehouseId: doc.warehouseId, forWrite: true });
  for (const line of doc.lines) {
    const generic = line.genericItem;
    if (!generic?.trackStock || !line.tradeItem) continue;
    const qtyBase = lineBaseQty(line.quantity, line.supplierItem?.packQty ?? 1, line.tradeItem.contentQty);
    const lot = await tx.stockLot.findFirst({ where: { orgId: ctx.orgId, genericItemId: generic.id, warehouseId: doc.warehouseId, batchNumber: line.batchNumber ?? null } });
    if (!lot) throw new PurchaseError(`Δεν βρέθηκε η παρτίδα της γραμμής «${line.description}» στην αποθήκη`);
    await postStockMovement(tx, { orgId: ctx.orgId, warehouseId: doc.warehouseId, documentId: doc.id, lineId: line.id, quantity: -qtyBase, unitCostHundredths: generic.avgCostHundredths, genericItemId: generic.id, lotId: lot.id, source, note: doc.note ?? undefined, occurredAt: at, actor: { id: ctx.userId, name: ctx.userName } });
  }
}

async function run<T>(work: (tx: Tx) => Promise<T>) {
  try {
    return await stockTransaction(work, { timeout: 30_000, maxWait: 10_000 });
  } catch (error) {
    if (error instanceof StockError) throw new PurchaseError(STOCK_ERROR_MESSAGE[error.code]);
    if (error instanceof StockScopeError) throw new PurchaseError(STOCK_SCOPE_ERROR_MESSAGE[error.code]);
    if (error instanceof SeriesError) throw new PurchaseError(error.message);
    throw error;
  }
}

/** Πρόχειρη επιστροφή από τιμολόγιο: τίποτα δεν φεύγει ακόμα, μόνο δεσμεύονται οι ποσότητες. */
export async function createReturn(ctx: StockContext, invoiceId: string, quantities: LineQty[], reason: string | null) {
  return run(async (tx) => {
    const invoice = await lockInvoice(tx, ctx.orgId, invoiceId);
    await assertStockScope(tx, ctx, { warehouseId: invoice.warehouseId, forWrite: true });
    if (invoice.source === "order") throw new PurchaseError(ORDER_INVOICE_NO_STOCK);
    const picked = checkQuantities(quantities, await leftToReturn(tx, invoice), new Map(invoice.lines.map((l) => [l.id, l.description])));
    const supplier = await tx.party.findFirstOrThrow({ where: { id: invoice.supplierId, orgId: ctx.orgId } });
    const doc = await tx.purchaseDoc.create({ data: {
      orgId: ctx.orgId, supplierId: invoice.supplierId, warehouseId: invoice.warehouseId, kind: "RETURN", relatedId: invoice.id, source: "manual",
      note: reason, supplierSnapshot: partySnapshot(supplier), buyerSnapshot: invoice.buyerSnapshot ?? undefined, expensesVatRate: invoice.expensesVatRate, createdByName: ctx.userName,
      lines: { create: picked.map((p) => copyLine(ctx.orgId, invoice.lines.find((l) => l.id === p.lineId)!, p.quantity)) },
    } });
    await writeAudit(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "purchase.return.draft", entityType: "purchase", entityId: doc.id, warehouseId: doc.warehouseId, metadata: { invoiceId, lines: picked.length } });
    return doc;
  });
}

/** Έκδοση: 9.3 (σκοπός 5) σε σειρά, απόθεμα έξω. Η διαβίβαση γίνεται μετά (transmitPurchaseReturn) και ξαναδοκιμάζεται μόνη της. */
export async function issueReturn(ctx: StockContext, returnId: string, seriesId: string) {
  return run(async (tx) => {
    const draft = await tx.purchaseDoc.findFirst({ where: { id: returnId, orgId: ctx.orgId, kind: "RETURN" }, select: { relatedId: true } });
    if (!draft?.relatedId) throw new PurchaseError("Η επιστροφή δεν βρέθηκε");
    const invoice = await lockInvoice(tx, ctx.orgId, draft.relatedId);
    const doc = await tx.purchaseDoc.findFirstOrThrow({ where: { id: returnId, orgId: ctx.orgId }, include: { lines: true, warehouse: { include: { stores: { include: { store: { include: { geoCity: { select: { name: true } } } } }, orderBy: [{ isDefault: "desc" }, { priority: "asc" }] } } } } });
    if (doc.status !== "DRAFT" || doc.fiscalDocumentId) throw new PurchaseError("Η επιστροφή έχει ήδη εκδοθεί");
    checkQuantities(doc.lines.map((l) => ({ lineId: l.sourceLineId!, quantity: l.quantity })), await leftToReturn(tx, invoice, doc.id), new Map(invoice.lines.map((l) => [l.id, l.description])));
    const locked = await lockSeries(tx, ctx.orgId, seriesId, "9.3");
    const store = locked.storeId ? doc.warehouse.stores.find((s) => s.storeId === locked.storeId)?.store : doc.warehouse.stores[0]?.store;
    if (!store) throw new PurchaseError(locked.storeId ? "Η σειρά ανήκει σε κατάστημα που δεν εξυπηρετεί αυτή την αποθήκη" : "Η αποθήκη δεν ανήκει σε κατάστημα· όρισέ το για να έχει το 9.3 διεύθυνση φόρτωσης");
    const supplier = await tx.party.findFirstOrThrow({ where: { id: doc.supplierId, orgId: ctx.orgId }, include: { geoCity: { select: { name: true } } } });
    if (!supplier.vatNumber) throw new PurchaseError("Ο προμηθευτής δεν έχει ΑΦΜ· συμπλήρωσέ τον στην καρτέλα του");
    const delivery = { street: supplier.address, city: supplier.city || supplier.geoCity?.name, postalCode: supplier.postalCode };
    const missing = [[`κατάστημα «${store.name}»`, addressGaps({ street: store.address, city: store.city || store.geoCity?.name, postalCode: store.postalCode })], [`προμηθευτής «${supplier.name}»`, addressGaps(delivery)]] as const;
    const gaps = missing.filter(([, g]) => g.length).map(([who, g]) => `${who}: ${g.join(", ")}`);
    if (gaps.length) throw new PurchaseError(`Το δελτίο αποστολής θέλει πλήρεις διευθύνσεις. Λείπουν — ${gaps.join(" · ")}`);

    const at = new Date();
    const totalCents = docTotal(doc);
    const fiscal = await tx.fiscalDocument.create({ data: {
      orgId: ctx.orgId, partyId: supplier.id, seriesId: locked.id, docType: "9.3", aa: locked.nextAa, receiptReference: randomUUID(), status: "NOT_SENT", error: "Δεν έχει γίνει διαβίβαση myDATA",
      request: { transmission: "NOT_SENT", docType: "9.3", series: locked.code, aa: locked.nextAa, issuedAt: at.toISOString(), purchaseDocId: doc.id, storeId: store.id, totalCents },
    } });
    await advanceSeries(tx, locked.id);
    await tx.purchaseDoc.update({ where: { id: doc.id }, data: { status: "POSTED", fiscalDocumentId: fiscal.id, number: `${locked.code}-${locked.nextAa}`, issuedAt: at, supplierSnapshot: partySnapshot({ ...supplier, city: delivery.city ?? null }) } });
    await stockOut(tx, ctx, doc.id, "purchase_return", at);
    await writeAudit(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "purchase.return.issue", entityType: "purchase", entityId: doc.id, warehouseId: doc.warehouseId, metadata: { series: locked.code, aa: locked.nextAa, totalCents } });
    return { id: doc.id, fiscalId: fiscal.id };
  });
}

export type CreditInput = {
  invoiceId: string; mydataType: "5.1" | "5.2"; number: string; issuedAt: Date; mark?: string | null; stockMode: StockMode;
  returnId?: string | null; quantities?: LineQty[]; amountCents?: number; vatRate?: number; note?: string | null;
};

/** Πιστωτικό του προμηθευτή, καταχωρημένο με τη μία. Μειώνει το υπόλοιπο του τιμολογίου· «τώρα» βγάζει και απόθεμα. */
export async function createCredit(ctx: StockContext, input: CreditInput) {
  return run(async (tx) => {
    const invoice = await lockInvoice(tx, ctx.orgId, input.invoiceId);
    await assertStockScope(tx, ctx, { warehouseId: invoice.warehouseId, forWrite: true });
    const names = new Map(invoice.lines.map((l) => [l.id, l.description]));
    let lines: ReturnType<typeof copyLine>[] | { orgId: string; description: string; quantity: number; unitPriceCents: number; discountBps: number; vatRate: number }[];
    let returnDoc: { id: string; total: number; credited: number } | null = null;
    if (input.returnId) {
      const r = await tx.purchaseDoc.findFirst({ where: { id: input.returnId, orgId: ctx.orgId, kind: "RETURN", status: "POSTED", relatedId: invoice.id }, include: { lines: true, credits: { where: { status: "POSTED" }, include: { lines: true } } } });
      if (!r) throw new PurchaseError("Η επιστροφή δεν βρέθηκε ή δεν έχει εκδοθεί");
      returnDoc = { id: r.id, total: docTotal(r), credited: r.credits.reduce((s, c) => s + docTotal(c), 0) };
      if (input.stockMode === "returned") {
        if (returnDoc.credited) throw new PurchaseError("Η επιστροφή έχει ήδη πιστωτικό· για τη διαφορά διάλεξε «Μόνο αξία»");
        lines = r.lines.map((l) => ({ ...copyLine(ctx.orgId, l, l.quantity), sourceLineId: l.sourceLineId }));
      }
    }
    if (input.stockMode === "returned" && !returnDoc) throw new PurchaseError("Διάλεξε την επιστροφή που πιστώνεται");
    if (input.stockMode === "now") {
      if (invoice.source === "order") throw new PurchaseError(ORDER_INVOICE_NO_STOCK);
      const picked = checkQuantities(input.quantities ?? [], await leftToReturn(tx, invoice), names);
      lines = picked.map((p) => copyLine(ctx.orgId, invoice.lines.find((l) => l.id === p.lineId)!, p.quantity));
    }
    if (input.stockMode === "value") {
      if (!input.amountCents || input.amountCents < 1) throw new PurchaseError("Γράψε την καθαρή αξία του πιστωτικού");
      lines = [{ orgId: ctx.orgId, description: input.note?.slice(0, 120) || "Πιστωτικό αξίας", quantity: 1, unitPriceCents: input.amountCents, discountBps: 0, vatRate: input.vatRate ?? 24 }];
    }
    const total = calculatePurchaseDocument(lines!).totalCents;
    const room = docTotal(invoice) - invoice.creditCents;
    if (total > room) throw new PurchaseError(`Το πιστωτικό (${(total / 100).toFixed(2)} €) ξεπερνά ό,τι απομένει στο τιμολόγιο (${(room / 100).toFixed(2)} €)`);
    const mark = input.mark?.trim() || null;
    if (mark && await tx.purchaseDoc.findFirst({ where: { orgId: ctx.orgId, mydataMark: mark }, select: { id: true } })) throw new PurchaseError("Υπάρχει ήδη παραστατικό με αυτό το MARK");
    const supplier = await tx.party.findFirstOrThrow({ where: { id: invoice.supplierId, orgId: ctx.orgId } });
    const doc = await tx.purchaseDoc.create({ data: {
      orgId: ctx.orgId, supplierId: invoice.supplierId, warehouseId: invoice.warehouseId, kind: "CREDIT", status: "POSTED", source: "manual",
      relatedId: invoice.id, returnId: returnDoc?.id ?? null, mydataType: input.mydataType, mydataMark: mark, stockMode: input.stockMode,
      number: input.number.trim() || null, issuedAt: input.issuedAt, note: input.note?.trim() || null,
      supplierSnapshot: partySnapshot(supplier), buyerSnapshot: invoice.buyerSnapshot ?? undefined, createdByName: ctx.userName,
      lines: { create: lines! },
    } });
    if (input.stockMode === "now") await stockOut(tx, ctx, doc.id, "purchase_credit", input.issuedAt);
    await tx.purchaseDoc.update({ where: { id: invoice.id }, data: { creditCents: { increment: total } } });
    await writeAudit(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "purchase.credit", entityType: "purchase", entityId: doc.id, warehouseId: doc.warehouseId, metadata: { invoiceId: invoice.id, returnId: returnDoc?.id ?? null, stockMode: input.stockMode, totalCents: total } });
    return doc;
  });
}

/** Πιστωτικό που ήρθε από το myDATA (πρόχειρο): δένεται με τιμολόγιο (και επιστροφή) και καταχωρείται χωρίς κίνηση αποθέματος. */
export async function postImportedCredit(ctx: StockContext, creditId: string, invoiceId: string, returnId: string | null) {
  return run(async (tx) => {
    const invoice = await lockInvoice(tx, ctx.orgId, invoiceId);
    const credit = await tx.purchaseDoc.findFirst({ where: { id: creditId, orgId: ctx.orgId, kind: "CREDIT", status: "DRAFT" }, include: { lines: true } });
    if (!credit) throw new PurchaseError("Το πιστωτικό δεν βρέθηκε ή έχει ήδη καταχωρηθεί");
    if (credit.supplierId !== invoice.supplierId) throw new PurchaseError("Το τιμολόγιο είναι άλλου προμηθευτή");
    await assertStockScope(tx, ctx, { warehouseId: invoice.warehouseId, forWrite: true });
    if (returnId && !await tx.purchaseDoc.findFirst({ where: { id: returnId, orgId: ctx.orgId, kind: "RETURN", status: "POSTED", relatedId: invoice.id }, select: { id: true } })) throw new PurchaseError("Η επιστροφή δεν ανήκει σε αυτό το τιμολόγιο");
    const total = docTotal(credit);
    const room = docTotal(invoice) - invoice.creditCents;
    if (total > room) throw new PurchaseError(`Το πιστωτικό (${(total / 100).toFixed(2)} €) ξεπερνά ό,τι απομένει στο τιμολόγιο (${(room / 100).toFixed(2)} €)`);
    await tx.purchaseDoc.update({ where: { id: credit.id }, data: { status: "POSTED", relatedId: invoice.id, returnId, stockMode: returnId ? "returned" : "value", warehouseId: invoice.warehouseId } });
    await tx.purchaseDoc.update({ where: { id: invoice.id }, data: { creditCents: { increment: total } } });
    await writeAudit(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "purchase.credit", entityType: "purchase", entityId: credit.id, warehouseId: invoice.warehouseId, metadata: { invoiceId, returnId, source: "mydata", totalCents: total } });
  });
}
