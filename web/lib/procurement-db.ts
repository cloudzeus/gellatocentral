// Παραγγελίες/MRP: όλα τα IDs επαληθεύονται στο tenant και οι παραλαβές γράφονται ατομικά.
import { createHash } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { lineValueCents, missingQty, orderStatus } from "./backorders";
import { matchInvoiceLine, normalizedGrossUnitPrice } from "./invoice-match";
import { mrpSuggestion, sumDocumentTotals, uniqueSupplierItemFallback } from "./procurement";
import { postPurchaseInTransaction, type PurchaseLinePosted } from "./purchases-db";
import { resolvePrice, reviewReceiptPrice, type ReceiptPriceReview } from "./purchase-pricing";
import { purchaseSnapshots } from "./purchase-snapshots";
import { assertStockScope, STOCK_SCOPE_ERROR_MESSAGE, StockScopeError, type StockContext } from "./stock-scope";
import { STOCK_ERROR_MESSAGE, StockError } from "./stock-db";
import { stockTransaction } from "./stock-transaction";
import { stockCostScale } from "./units";
import { assertNonNegativeInt, assertParty, assertPositiveInt, auditWorkflow, cleanText, nextBusinessNumber, WorkflowError } from "./workflow-db";

export type PurchaseOrderInput = {
  supplierId: string;
  warehouseId: string;
  expectedAt?: Date | null;
  note?: string | null;
  lines: { genericItemId: string; supplierItemId?: string; quantityBase: number; unitPriceCents: number; vatRate: number; discountBps?: number }[];
};

export async function createPurchaseOrder(ctx: StockContext, input: PurchaseOrderInput) {
  if (!input.lines.length || input.lines.length > 200) throw new WorkflowError("Η παραγγελία χρειάζεται 1–200 γραμμές");
  if (new Set(input.lines.map((l) => l.genericItemId)).size !== input.lines.length) throw new WorkflowError("Κάθε είδος επιτρέπεται μία φορά");
  return stockTransaction(async (tx) => {
    await assertStockScope(tx, ctx, { warehouseId: input.warehouseId, forWrite: true });
    const supplier = await assertParty(tx, ctx.orgId, input.supplierId, "supplier");
    const generics = await tx.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: input.lines.map((l) => l.genericItemId) }, active: true }, select: { id: true, baseUnit: { select: { dimension: true } } } });
    if (generics.length !== input.lines.length) throw new WorkflowError("Βρέθηκε είδος εκτός επιχείρησης ή ανενεργό");
    const scales = new Map(generics.map((generic) => [generic.id, stockCostScale(generic.baseUnit.dimension)]));
    const packaging = new Map<string, { supplierItemId: string; packQty: number } | null>();
    for (const line of input.lines) {
      assertPositiveInt(line.quantityBase, "Ποσότητα");
      assertNonNegativeInt(line.unitPriceCents, "Τιμή");
      assertNonNegativeInt(line.vatRate, "ΦΠΑ", 100);
      assertNonNegativeInt(line.discountBps ?? 0, "Έκπτωση", 10000);
      if (line.supplierItemId !== undefined) {
        const supplierItem = await tx.supplierItem.findFirst({
          where: { id: line.supplierItemId, orgId: ctx.orgId, supplierId: supplier.id, active: true },
          select: { id: true, packQty: true, tradeItemId: true },
        });
        if (!supplierItem) throw new WorkflowError("Η συσκευασία προμηθευτή δεν βρέθηκε ή δεν είναι ενεργή");
        const mapping = await tx.itemMapping.findFirst({ where: { orgId: ctx.orgId, tradeItemId: supplierItem.tradeItemId, genericItemId: line.genericItemId }, select: { id: true } });
        if (!mapping) throw new WorkflowError("Η συσκευασία προμηθευτή δεν αντιστοιχεί στο γενικό είδος");
        packaging.set(line.genericItemId, { supplierItemId: supplierItem.id, packQty: supplierItem.packQty });
      } else {
        const candidates = await tx.supplierItem.findMany({
          where: { orgId: ctx.orgId, supplierId: supplier.id, active: true, tradeItem: { mappings: { some: { orgId: ctx.orgId, genericItemId: line.genericItemId } } } },
          select: { id: true, packQty: true },
        });
        // Η ασαφής συσκευασία δεν συνδέεται αυτόματα· η υπάρχουσα ροή παραγγελίας συνεχίζει χωρίς αυτήν.
        const fallback = uniqueSupplierItemFallback(candidates);
        packaging.set(line.genericItemId, fallback ? { supplierItemId: fallback.id, packQty: fallback.packQty } : null);
      }
    }
    const totals = sumDocumentTotals(input.lines.map((line) => ({ ...line, costScale: scales.get(line.genericItemId) })));
    const number = await nextBusinessNumber(tx, ctx.orgId, "purchase-order", "ΠΠ", () => tx.purchaseOrder.count({ where: { orgId: ctx.orgId } }));
    const order = await tx.purchaseOrder.create({
      data: {
        orgId: ctx.orgId, supplierId: supplier.id, warehouseId: input.warehouseId, number,
        expectedAt: input.expectedAt ?? null, note: cleanText(input.note, "Σημείωση", 500), ...totals, createdByName: ctx.userName,
        lines: { create: input.lines.map((line) => {
          const selected = packaging.get(line.genericItemId);
          return { orgId: ctx.orgId, genericItemId: line.genericItemId, supplierItemId: selected?.supplierItemId ?? null, packQty: selected?.packQty ?? 1, orderedBaseQty: line.quantityBase, unitPriceCents: line.unitPriceCents, vatRate: line.vatRate, discountBps: line.discountBps ?? 0 };
        }) },
      },
      include: { lines: true },
    });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "order.create", entityType: "purchase_order", entityId: order.id, warehouseId: order.warehouseId, metadata: { number, totalCents: totals.totalCents } });
    return order;
  }).catch((error) => { throw translateStockError(error); });
}

export async function markPurchaseOrderSent(ctx: StockContext, orderId: string) {
  return stockTransaction(async (tx) => {
    const order = await tx.purchaseOrder.findFirst({ where: { id: orderId, orgId: ctx.orgId } });
    if (!order) throw new WorkflowError("Η παραγγελία δεν βρέθηκε");
    await assertStockScope(tx, ctx, { warehouseId: order.warehouseId, forWrite: true });
    if (order.status !== "DRAFT") throw new WorkflowError("Η παραγγελία έχει ήδη σταλεί ή κλείσει");
    const updated = await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: "SENT", sentAt: new Date(), sentVia: "internal-record" } });
    await tx.documentDelivery.create({ data: { orgId: ctx.orgId, entityType: "purchase_order", entityId: order.id, channel: "internal", status: "RECORDED", detail: "Καταγραφή αποστολής· δεν πραγματοποιήθηκε εξωτερική αποστολή", createdByName: ctx.userName } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "order.send", entityType: "purchase_order", entityId: order.id, warehouseId: order.warehouseId });
    return updated;
  });
}

export async function cancelPurchaseOrder(ctx: StockContext, orderId: string, reason: string) {
  const cleanReason = cleanText(reason, "Αιτιολογία", 300, true);
  return stockTransaction(async (tx) => {
    const order = await tx.purchaseOrder.findFirst({ where: { id: orderId, orgId: ctx.orgId }, include: { receipts: { select: { id: true } } } });
    if (!order) throw new WorkflowError("Η παραγγελία δεν βρέθηκε");
    await assertStockScope(tx, ctx, { warehouseId: order.warehouseId, forWrite: true });
    if (!["DRAFT", "SENT"].includes(order.status) || order.receipts.length) throw new WorkflowError("Ακυρώνεται μόνο παραγγελία χωρίς παραλαβές");
    const updated = await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", note: [order.note, `Ακύρωση: ${cleanReason}`].filter(Boolean).join("\n") } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "order.cancel", entityType: "purchase_order", entityId: order.id, warehouseId: order.warehouseId, reason: cleanReason });
    return updated;
  });
}

type ReceiptLineInput = { orderLineId: string; quantityBase: number; batchNumber?: string | null; expiresAt?: Date | null };
export type DeliveryNoteInput = { number?: string | null; date?: Date | null; mark?: string | null };
/** Για όσα λείπουν μετά την παραλαβή: wait = αναμένονται (back order), close = δεν θα έρθουν (αίτημα πιστωτικού αν υπάρχει τιμολόγιο παραγγελίας). */
export type ShortfallDecision = { orderLineId: string; action: "wait" | "close"; expectedAt?: Date | null };
const receiptHash = (orderId: string, lines: readonly ReceiptLineInput[]) => createHash("sha256").update(JSON.stringify({ orderId, lines: [...lines].sort((a, b) => a.orderLineId.localeCompare(b.orderLineId)).map((l) => ({ ...l, expiresAt: l.expiresAt?.toISOString() ?? null })) })).digest("hex");

function isUniqueConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && current.code === "P2002") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

async function existingReceipt(tx: Pick<Prisma.TransactionClient, "purchaseReceipt">, orgId: string, orderId: string, clientKey: string, requestHash: string) {
  const existing = await tx.purchaseReceipt.findFirst({ where: { orgId, clientKey } });
  if (!existing) return null;
  if (existing.orderId !== orderId || existing.requestHash !== requestHash) throw new WorkflowError("Το κλειδί παραλαβής χρησιμοποιήθηκε με διαφορετικά δεδομένα");
  return existing;
}

async function receiptPriceReview(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    supplierId: string;
    genericItemId: string;
    supplierItemId: string | null;
    quantityBase: number;
    unitPriceCents: number;
    discountBps: number;
    costScale: number;
    dimension: string;
    at: Date;
  },
): Promise<ReceiptPriceReview> {
  const supplierItem = input.supplierItemId ? await tx.supplierItem.findFirst({
    where: { id: input.supplierItemId, orgId: input.orgId, supplierId: input.supplierId },
    include: { tradeItem: { include: { contentUnit: true } }, prices: true },
  }) : null;
  let agreement: { priceCents: number; contentQty: number } | undefined;
  if (supplierItem?.tradeItem.contentUnit.dimension === input.dimension && supplierItem.tradeItem.contentQty > 0 && supplierItem.packQty > 0) {
    const packQtyTotal = input.quantityBase / (supplierItem.packQty * supplierItem.tradeItem.contentQty);
    const resolved = resolvePrice(supplierItem.prices, packQtyTotal, input.at);
    // Ο απλός τιμοκατάλογος δεν είναι ειδική συμφωνία και δεν αποκλείει το ιστορικό πραγματικών αγορών.
    if (resolved && (resolved.minPackQty != null || resolved.validTo != null)) {
      agreement = { priceCents: resolved.priceCents, contentQty: supplierItem.tradeItem.contentQty };
    }
  }

  let previous: { unitPriceCents: number; packQty: number; contentQty: number; discountBps: number } | undefined;
  if (!agreement) {
    const previousLine = await tx.purchaseLine.findFirst({
      where: {
        orgId: input.orgId,
        genericItemId: input.genericItemId,
        document: { orgId: input.orgId, supplierId: input.supplierId, kind: "INVOICE", status: "POSTED" },
        tradeItem: { contentQty: { gt: 0 }, contentUnit: { dimension: input.dimension } },
        OR: [{ supplierItemId: null }, { supplierItem: { packQty: { gt: 0 } } }],
      },
      include: { supplierItem: true, tradeItem: true },
      orderBy: [{ document: { createdAt: "desc" } }, { id: "desc" }],
    });
    if (previousLine?.tradeItem) previous = {
      unitPriceCents: previousLine.unitPriceCents,
      packQty: previousLine.supplierItem?.packQty ?? 1,
      contentQty: previousLine.tradeItem.contentQty,
      discountBps: previousLine.discountBps,
    };
  }
  return reviewReceiptPrice(
    { unitPriceCents: input.unitPriceCents, discountBps: input.discountBps },
    input.costScale,
    agreement,
    previous,
  );
}

export async function receivePurchaseOrder(ctx: StockContext, input: { orderId: string; clientKey: string; lines: ReceiptLineInput[]; deliveryNote?: DeliveryNoteInput; shortfall?: ShortfallDecision[]; remark?: string }) {
  if (!/^[-_a-zA-Z0-9]{8,100}$/.test(input.clientKey)) throw new WorkflowError("Άκυρο κλειδί παραλαβής");
  if (!input.lines.length || input.lines.length > 200) throw new WorkflowError("Δώσε τουλάχιστον μία ποσότητα παραλαβής");
  const requestHash = receiptHash(input.orderId, input.lines);
  try {
    return await stockTransaction(async (tx) => {
      const scopedOrder = await tx.purchaseOrder.findFirst({ where: { id: input.orderId, orgId: ctx.orgId }, select: { id: true, warehouseId: true } });
      if (!scopedOrder) throw new WorkflowError("Η παραγγελία δεν βρέθηκε");
      await assertStockScope(tx, ctx, { warehouseId: scopedOrder.warehouseId, forWrite: true });
      const previous = await existingReceipt(tx, ctx.orgId, input.orderId, input.clientKey, requestHash);
      if (previous) return previous;
      const order = await tx.purchaseOrder.findFirst({ where: { id: scopedOrder.id, orgId: ctx.orgId }, include: { lines: true } });
      if (!order || !["SENT", "PARTIAL"].includes(order.status)) throw new WorkflowError("Η παραγγελία δεν είναι διαθέσιμη για παραλαβή");
      const [supplier, organization] = await Promise.all([
        tx.party.findFirst({ where: { id: order.supplierId, orgId: ctx.orgId } }),
        tx.organization.findUnique({ where: { id: ctx.orgId } }),
      ]);
      if (!supplier || !organization) throw new WorkflowError("Τα στοιχεία της παραγγελίας δεν βρέθηκαν");
      await assertStockScope(tx, ctx, { warehouseId: order.warehouseId, forWrite: true });
      const byId = new Map(order.lines.map((line) => [line.id, line]));
      if (new Set(input.lines.map((l) => l.orderLineId)).size !== input.lines.length) throw new WorkflowError("Διπλή γραμμή παραλαβής");
      for (const line of input.lines) {
        const ordered = byId.get(line.orderLineId);
        assertPositiveInt(line.quantityBase, "Ποσότητα παραλαβής");
        if (!ordered || line.quantityBase > missingQty(ordered)) throw new WorkflowError("Η ποσότητα υπερβαίνει το υπόλοιπο της παραγγελίας");
      }

      const snapshots = await purchaseSnapshots(organization, supplier);
      const receivedAt = new Date();
      const note = deliveryNote(input.deliveryNote);
      const already = await receivedNote(tx, ctx.orgId, order.supplierId, note.deliveryNoteNumber, note.deliveryNoteMark);
      if (already) throw new WorkflowError(already.message);
      const doc = await tx.purchaseDoc.create({ data: { orgId: ctx.orgId, supplierId: order.supplierId, warehouseId: order.warehouseId, kind: "RECEIPT", number: note.deliveryNoteNumber ? `ΔΑ ${note.deliveryNoteNumber}` : `Παραλαβή ${order.number}`, issuedAt: receivedAt, note: [`Παραγγελία ${order.number}`, cleanText(input.remark, "Σημείωση", 300)].filter(Boolean).join(" · "), source: "order", ...snapshots, createdByName: ctx.userName } });
      const receipt = await tx.purchaseReceipt.create({ data: { orgId: ctx.orgId, orderId: order.id, purchaseDocId: doc.id, clientKey: input.clientKey, requestHash, reviewStatus: "PROVISIONAL", ...note, createdByName: ctx.userName } });
      const purchaseToOrder = new Map<string, string>();
      const priceReviews = new Map<string, { review: ReceiptPriceReview; itemName: string; dimension: string }>();

      for (const received of input.lines) {
        const line = byId.get(received.orderLineId)!;
        const generic = await tx.genericItem.findFirst({ where: { id: line.genericItemId, orgId: ctx.orgId }, include: { baseUnit: true } });
        if (!generic) throw new WorkflowError("Το είδος παραγγελίας δεν βρέθηκε");
        // Μία πραγματική συσκευασία παραλαβής: η τιμή παραμένει ανά kg/l/1000 τεμ.,
        // ενώ το παραστατικό γράφει μία γραμμή με ακέραιο συνολικό ποσό σε λεπτά.
        const scale = stockCostScale(generic.baseUnit.dimension);
        const review = await receiptPriceReview(tx, {
          orgId: ctx.orgId, supplierId: order.supplierId, genericItemId: generic.id, supplierItemId: line.supplierItemId,
          quantityBase: received.quantityBase, unitPriceCents: line.unitPriceCents, discountBps: line.discountBps,
          costScale: scale, dimension: generic.baseUnit.dimension, at: receivedAt,
        });
        priceReviews.set(line.id, { review, itemName: generic.name, dimension: generic.baseUnit.dimension });
        const trade = await tx.tradeItem.create({ data: { orgId: ctx.orgId, name: `${generic.name} · ${order.number}`, contentQty: received.quantityBase, contentUnitId: generic.baseUnitId } });
        await tx.itemMapping.create({ data: { orgId: ctx.orgId, genericItemId: generic.id, tradeItemId: trade.id } });
        const packagePriceCents = Math.round(received.quantityBase * line.unitPriceCents / scale);
        const purchaseLine = await tx.purchaseLine.create({ data: { orgId: ctx.orgId, documentId: doc.id, description: generic.name, quantity: 1, unitPriceCents: packagePriceCents, discountBps: line.discountBps, vatRate: line.vatRate, batchNumber: cleanText(received.batchNumber, "Παρτίδα", 80), expiresAt: received.expiresAt ?? null, tradeItemId: trade.id, genericItemId: generic.id, matchNote: "order" } });
        purchaseToOrder.set(purchaseLine.id, line.id);
      }

      const posted: PurchaseLinePosted[] = [];
      const discrepancies: { receiptLineId: string; basis: string; kind: string; expectedPriceCents: number; actualPriceCents: number; reason: string }[] = [];
      await postPurchaseInTransaction(tx, ctx, doc.id, (line) => { posted.push(line); });
      for (const line of posted) {
        const orderLineId = purchaseToOrder.get(line.purchaseLineId);
        if (!orderLineId) throw new WorkflowError("Ασυνεπής σύνδεση παραλαβής");
        const receiptLine = await tx.purchaseReceiptLine.create({ data: { orgId: ctx.orgId, receiptId: receipt.id, orderLineId, purchaseLineId: line.purchaseLineId, genericItemId: line.genericItemId, lotId: line.lotId, quantityBase: line.quantityBase, previousAvgCostHundredths: line.previousAvgCostHundredths, resultingAvgCostHundredths: line.resultingAvgCostHundredths } });
        const priceReview = priceReviews.get(orderLineId);
        const review = priceReview?.review;
        if (review?.kind && review.expectedPriceCents != null && review.actualPriceCents != null && priceReview) {
          const normalizedUnit = priceReview.dimension === "mass" ? "kg" : priceReview.dimension === "volume" ? "l" : "1000 τεμ.";
          const reason = review.basis === "AGREEMENT"
            ? `«${priceReview.itemName}»: η τιμή μετά την έκπτωση αποκλίνει από την έγκυρη ειδική συμφωνία (τιμές ανά συσκευασία).`
            : `«${priceReview.itemName}»: αύξηση τιμής αυστηρά άνω του 5% από την προηγούμενη πραγματική αγορά (τιμές μετά την έκπτωση ανά ${normalizedUnit}).`;
          const discrepancy = { receiptLineId: receiptLine.id, basis: review.basis, kind: review.kind, expectedPriceCents: review.expectedPriceCents, actualPriceCents: review.actualPriceCents, reason };
          await tx.purchaseReceiptDiscrepancy.create({ data: { orgId: ctx.orgId, receiptId: receipt.id, ...discrepancy } });
          discrepancies.push(discrepancy);
        }
        await tx.purchaseOrderLine.update({ where: { id: orderLineId }, data: { receivedBaseQty: { increment: line.quantityBase } } });
      }
      if (input.shortfall?.length) await applyShortfall(tx, ctx, order.id, input.shortfall);
      const freshLines = await tx.purchaseOrderLine.findMany({ where: { orderId: order.id } });
      const status = orderStatus(freshLines);
      const complete = status === "RECEIVED";
      const remaining = freshLines.reduce((sum, line) => sum + missingQty(line), 0);
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "order.receive", entityType: "purchase_receipt", entityId: receipt.id, warehouseId: order.warehouseId, metadata: { orderId: order.id, lines: posted.length, complete, remaining, reviewStatus: receipt.reviewStatus, discrepancyCount: discrepancies.length, discrepancies } });
      return receipt;
    }, LONG_POSTING);
  } catch (error) {
    if (isUniqueConflict(error)) {
      // Σε concurrent submit το ανοιχτό transaction ακυρώνεται· μόνο το committed, πλήρως ταυτόσημο receipt είναι replay.
      const { db } = await import("./db");
      const replay = await existingReceipt(db, ctx.orgId, input.orderId, input.clientKey, requestHash);
      if (replay) return replay;
    }
    throw translateStockError(error);
  }
}

/** Ρητή αποδοχή του τιμολογιακού ελέγχου· με ασυμφωνία απαιτείται τεκμηριωμένη αιτιολογία. */
export async function reviewPurchaseReceipt(ctx: StockContext, input: { receiptId: string; note?: string | null }) {
  const note = cleanText(input.note, "Σχόλιο ελέγχου", 500);
  try {
    return await stockTransaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`purchase-receipt:${ctx.orgId}:${input.receiptId}`}, 0))) AS lock`;
      const receipt = await tx.purchaseReceipt.findFirst({
        where: { id: input.receiptId, orgId: ctx.orgId },
        include: { order: { select: { warehouseId: true } }, discrepancies: true },
      });
      if (!receipt) throw new WorkflowError("Η παραλαβή δεν βρέθηκε");
      await assertStockScope(tx, ctx, { warehouseId: receipt.order.warehouseId, forWrite: true });
      if (receipt.reversedAt) throw new WorkflowError("Δεν ελέγχεται αναιρεμένη παραλαβή");
      if (receipt.reviewStatus === "REVIEWED") return receipt;
      if (receipt.discrepancies.length && !note) throw new WorkflowError("Η αποδοχή παραλαβής με ασυμφωνίες απαιτεί αιτιολογία");
      const reviewed = await tx.purchaseReceipt.update({
        where: { id: receipt.id },
        data: { reviewStatus: "REVIEWED", reviewedAt: new Date(), reviewedByName: ctx.userName, reviewNote: note },
        include: { order: { select: { warehouseId: true } }, discrepancies: true },
      });
      await auditWorkflow(tx, {
        orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "order.receipt.review",
        entityType: "purchase_receipt", entityId: receipt.id, warehouseId: receipt.order.warehouseId, reason: note,
        metadata: { discrepancyCount: receipt.discrepancies.length, discrepancies: receipt.discrepancies.map((item) => ({ id: item.id, basis: item.basis, kind: item.kind })) },
      });
      return reviewed;
    });
  } catch (error) { throw translateStockError(error); }
}

export type ReceiptInvoiceInput = {
  receiptId: string;
  number: string;
  issuedAt: Date;
  lines: { receiptLineId: string; quantityBase: number; unitPriceCents: number; discountBps?: number; vatRate: number }[];
};

function canonicalReceiptInvoice(input: ReceiptInvoiceInput) {
  const number = cleanText(input.number, "Αριθμός τιμολογίου", 100, true)!;
  if (!(input.issuedAt instanceof Date) || Number.isNaN(input.issuedAt.getTime())) throw new WorkflowError("Άκυρη ημερομηνία έκδοσης");
  if (!input.lines.length || input.lines.length > 200) throw new WorkflowError("Το τιμολόγιο χρειάζεται 1–200 γραμμές");
  const lines = input.lines.map((line) => {
    const receiptLineId = cleanText(line.receiptLineId, "Γραμμή παραλαβής", 100, true)!;
    assertPositiveInt(line.quantityBase, "Ποσότητα τιμολογίου");
    assertNonNegativeInt(line.unitPriceCents, "Τιμή τιμολογίου");
    assertNonNegativeInt(line.discountBps ?? 0, "Έκπτωση τιμολογίου", 10000);
    assertNonNegativeInt(line.vatRate, "ΦΠΑ τιμολογίου", 100);
    return { receiptLineId, quantityBase: line.quantityBase, unitPriceCents: line.unitPriceCents, discountBps: line.discountBps ?? 0, vatRate: line.vatRate };
  }).sort((a, b) => a.receiptLineId.localeCompare(b.receiptLineId));
  if (new Set(lines.map((line) => line.receiptLineId)).size !== lines.length) throw new WorkflowError("Κάθε γραμμή παραλαβής επιτρέπεται μία φορά στο τιμολόγιο");
  const requestHash = createHash("sha256").update(JSON.stringify({ version: 1, number, issuedAt: input.issuedAt.toISOString(), lines })).digest("hex");
  return { number, issuedAt: input.issuedAt, lines, requestHash };
}

/**
 * Μία REVIEWED παραλαβή → ένα τιμολόγιο. Καταγράφει τα πραγματικά invoice lines και το three-way match.
 * Απόκλιση δημιουργεί DRAFT εκτός οικονομικών reports μέχρι ρητή αποδοχή· δεν ξαναγράφεται stock ή κόστος.
 */
export async function createInvoiceFromReceipt(ctx: StockContext, input: ReceiptInvoiceInput) {
  const canonical = canonicalReceiptInvoice(input);
  try {
    return await stockTransaction(async (tx) => {
      // Το ίδιο lock με την αναίρεση/αποδοχή αποκλείει δεύτερο invoice ή ταυτόχρονη οριστικοποίηση.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`purchase-receipt:${ctx.orgId}:${input.receiptId}`}, 0))) AS lock`;
      const receipt = await tx.purchaseReceipt.findFirst({
        where: { id: input.receiptId, orgId: ctx.orgId },
        include: { order: { select: { warehouseId: true, number: true, invoiceDocId: true } }, lines: true },
      });
      if (!receipt) throw new WorkflowError("Η παραλαβή δεν βρέθηκε");
      if (receipt.order.invoiceDocId) throw new WorkflowError("Η παραγγελία έχει ήδη τιμολόγιο για όλα τα είδη· τα δελτία αποστολής δεν τιμολογούνται χωριστά");
      await assertStockScope(tx, ctx, { warehouseId: receipt.order.warehouseId, forWrite: true });
      if (receipt.invoiceDocId) {
        if (receipt.invoiceRequestHash === canonical.requestHash) {
          const existing = await tx.purchaseDoc.findFirst({ where: { id: receipt.invoiceDocId, orgId: ctx.orgId, kind: "INVOICE" } });
          if (existing) return existing;
        }
        throw new WorkflowError("Η παραλαβή έχει ήδη συνδεδεμένο τιμολόγιο με διαφορετικά δεδομένα");
      }
      if (receipt.reversedAt) throw new WorkflowError("Δεν εκδίδεται τιμολόγιο για αναιρεμένη παραλαβή");
      if (receipt.reviewStatus !== "REVIEWED") throw new WorkflowError("Η παραλαβή είναι με επιφύλαξη και απαιτεί τιμολογιακό έλεγχο πριν από το τιμολόγιο");
      const receiptDoc = await tx.purchaseDoc.findFirst({
        where: { id: receipt.purchaseDocId, orgId: ctx.orgId, kind: "RECEIPT", status: "POSTED" },
        include: { lines: true },
      });
      if (!receiptDoc) throw new WorkflowError("Το παραστατικό παραλαβής δεν είναι διαθέσιμο για τιμολόγηση");
      if (canonical.lines.length !== receipt.lines.length) throw new WorkflowError("Απαιτείται ακριβώς μία γραμμή τιμολογίου για κάθε γραμμή της παραλαβής");

      const [orderLines, generics] = await Promise.all([
        tx.purchaseOrderLine.findMany({ where: { orgId: ctx.orgId, orderId: receipt.orderId } }),
        tx.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: receipt.lines.map((line) => line.genericItemId) } }, include: { baseUnit: true } }),
      ]);
      const orderById = new Map(orderLines.map((line) => [line.id, line]));
      const genericById = new Map(generics.map((item) => [item.id, item]));
      const receiptLineById = new Map(receipt.lines.map((line) => [line.id, line]));
      const receiptPurchaseById = new Map(receiptDoc.lines.map((line) => [line.id, line]));
      const supplierItemIds = [...new Set(orderLines.map((line) => line.supplierItemId).filter((id): id is string => Boolean(id)))];
      const supplierItems = supplierItemIds.length ? await tx.supplierItem.findMany({
        where: { orgId: ctx.orgId, supplierId: receiptDoc.supplierId, id: { in: supplierItemIds } },
        include: { tradeItem: { include: { contentUnit: true } }, prices: true },
      }) : [];
      const supplierItemById = new Map(supplierItems.map((item) => [item.id, item]));

      const matched = canonical.lines.map((actual) => {
        const receiptLine = receiptLineById.get(actual.receiptLineId);
        if (!receiptLine) throw new WorkflowError("Βρέθηκε ξένη ή μη υπαρκτή γραμμή παραλαβής στο τιμολόγιο");
        const orderLine = orderById.get(receiptLine.orderLineId);
        const receiptPurchase = receiptPurchaseById.get(receiptLine.purchaseLineId);
        const generic = genericById.get(receiptLine.genericItemId);
        if (!orderLine || !receiptPurchase || !generic) throw new WorkflowError("Η τριπλή σύνδεση της γραμμής είναι ελλιπής");
        const scale = stockCostScale(generic.baseUnit.dimension);
        const supplierItem = orderLine.supplierItemId ? supplierItemById.get(orderLine.supplierItemId) : undefined;
        let agreement: { priceCents: number; contentQty: number } | undefined;
        if (supplierItem && supplierItem.packQty > 0 && supplierItem.tradeItem.contentQty > 0 && supplierItem.tradeItem.contentUnit.dimension === generic.baseUnit.dimension) {
          const packQtyTotal = receiptLine.quantityBase / (supplierItem.packQty * supplierItem.tradeItem.contentQty);
          const resolved = resolvePrice(supplierItem.prices, packQtyTotal, receipt.createdAt);
          if (resolved && (resolved.minPackQty != null || resolved.validTo != null)) agreement = { priceCents: resolved.priceCents, contentQty: supplierItem.tradeItem.contentQty };
        }
        const result = matchInvoiceLine(actual, {
          receivedQuantityBase: receiptLine.quantityBase,
          costScale: scale,
          agreement,
          order: { unitPriceCents: orderLine.unitPriceCents, discountBps: orderLine.discountBps, vatRate: orderLine.vatRate },
          receipt: {
            unitPriceCents: normalizedGrossUnitPrice(receiptPurchase.unitPriceCents, receiptLine.quantityBase, scale),
            discountBps: receiptPurchase.discountBps,
            vatRate: receiptPurchase.vatRate,
          },
        });
        return { actual, receiptLine, orderLine, receiptPurchase, generic, result };
      });
      const discrepancyCount = matched.reduce((sum, line) => sum + line.result.discrepancies.length, 0);
      const invoice = await tx.purchaseDoc.create({ data: {
        orgId: ctx.orgId, supplierId: receiptDoc.supplierId, warehouseId: receiptDoc.warehouseId, kind: "INVOICE", status: discrepancyCount ? "DRAFT" : "POSTED",
        number: canonical.number, issuedAt: canonical.issuedAt, source: "receipt", note: `Τιμολόγιο παραλαβής ${receipt.order.number}`,
        supplierSnapshot: receiptDoc.supplierSnapshot ?? undefined, buyerSnapshot: receiptDoc.buyerSnapshot ?? undefined, createdByName: ctx.userName,
      } });
      for (const line of matched) {
        const invoiceLine = await tx.purchaseLine.create({ data: {
          orgId: ctx.orgId, documentId: invoice.id, supplierCode: line.receiptPurchase.supplierCode, ean: line.receiptPurchase.ean, description: line.receiptPurchase.description,
          quantity: 1, unitPriceCents: line.result.grossCents, discountBps: line.actual.discountBps, vatRate: line.actual.vatRate,
          batchNumber: line.receiptPurchase.batchNumber, expiresAt: line.receiptPurchase.expiresAt, receiptTempC: line.receiptPurchase.receiptTempC, receiptIssue: line.receiptPurchase.receiptIssue,
          supplierItemId: line.receiptPurchase.supplierItemId, tradeItemId: line.receiptPurchase.tradeItemId, genericItemId: line.receiptPurchase.genericItemId, matchNote: "three-way-receipt",
        } });
        const match = await tx.purchaseInvoiceLineMatch.create({ data: {
          orgId: ctx.orgId, receiptId: receipt.id, orderLineId: line.orderLine.id, receiptLineId: line.receiptLine.id, invoiceLineId: invoiceLine.id,
          quantityBase: line.actual.quantityBase, unitPriceCents: line.actual.unitPriceCents, discountBps: line.actual.discountBps, vatRate: line.actual.vatRate,
        } });
        for (const discrepancy of line.result.discrepancies) {
          await tx.purchaseInvoiceDiscrepancy.create({ data: {
            orgId: ctx.orgId, receiptId: receipt.id, matchId: match.id, ...discrepancy,
            reason: `«${line.generic.name}»: ${discrepancy.reason}`,
          } });
        }
      }
      await tx.purchaseReceipt.update({ where: { id: receipt.id }, data: {
        invoiceDocId: invoice.id, invoiceRequestHash: canonical.requestHash, invoiceMatchStatus: discrepancyCount ? "DISCREPANCY" : "MATCHED",
      } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "purchase.receipt.invoice", entityType: "purchase", entityId: invoice.id, warehouseId: invoice.warehouseId, metadata: {
        receiptId: receipt.id, receiptDocId: receiptDoc.id, lines: matched.length, matchStatus: discrepancyCount ? "DISCREPANCY" : "MATCHED", discrepancyCount, stockMovements: 0,
      } });
      return invoice;
    });
  } catch (error) { throw translateStockError(error); }
}

/** Οριστική οικονομική αποδοχή τιμολογίου με discrepancies, πάντα με αιτιολογία και μία audit εγγραφή. */
export async function reviewReceiptInvoice(ctx: StockContext, input: { receiptId: string; note?: string | null }) {
  const note = cleanText(input.note, "Αιτιολογία αποδοχής τιμολογίου", 500);
  try {
    return await stockTransaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`purchase-receipt:${ctx.orgId}:${input.receiptId}`}, 0))) AS lock`;
      const receipt = await tx.purchaseReceipt.findFirst({
        where: { id: input.receiptId, orgId: ctx.orgId },
        include: { order: { select: { warehouseId: true } }, invoiceDiscrepancies: { select: { id: true, basis: true, kind: true } } },
      });
      if (!receipt?.invoiceDocId) throw new WorkflowError("Δεν βρέθηκε συνδεδεμένο τιμολόγιο παραλαβής");
      await assertStockScope(tx, ctx, { warehouseId: receipt.order.warehouseId, forWrite: true });
      if (receipt.reversedAt) throw new WorkflowError("Δεν ελέγχεται τιμολόγιο αναιρεμένης παραλαβής");
      const invoice = await tx.purchaseDoc.findFirst({ where: { id: receipt.invoiceDocId, orgId: ctx.orgId, kind: "INVOICE" } });
      if (!invoice) throw new WorkflowError("Το συνδεδεμένο τιμολόγιο δεν βρέθηκε");
      if (receipt.invoiceMatchStatus === "MATCHED" || receipt.invoiceMatchStatus === "REVIEWED") return invoice;
      if (receipt.invoiceMatchStatus !== "DISCREPANCY" || invoice.status !== "DRAFT" || !receipt.invoiceDiscrepancies.length) throw new WorkflowError("Το τιμολόγιο δεν είναι διαθέσιμο για αποδοχή αποκλίσεων");
      if (!note) throw new WorkflowError("Η οριστική αποδοχή τιμολογίου με αποκλίσεις απαιτεί τεκμηριωμένη αιτιολογία");
      const reviewedAt = new Date();
      const reviewed = await tx.purchaseDoc.update({ where: { id: invoice.id }, data: { status: "POSTED" } });
      await tx.purchaseReceipt.update({ where: { id: receipt.id }, data: { invoiceMatchStatus: "REVIEWED", invoiceReviewedAt: reviewedAt, invoiceReviewedByName: ctx.userName, invoiceReviewNote: note } });
      await auditWorkflow(tx, {
        orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "purchase.receipt.invoice.review",
        entityType: "purchase", entityId: invoice.id, warehouseId: invoice.warehouseId, reason: note,
        metadata: { receiptId: receipt.id, discrepancyCount: receipt.invoiceDiscrepancies.length, discrepancies: receipt.invoiceDiscrepancies },
      });
      return reviewed;
    });
  } catch (error) { throw translateStockError(error); }
}

export async function reversePurchaseReceipt(ctx: StockContext, receiptId: string, reason: string) {
  const cleanReason = cleanText(reason, "Αιτιολογία αναίρεσης", 300, true);
  try {
    return await stockTransaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`purchase-receipt:${ctx.orgId}:${receiptId}`}, 0))) AS lock`;
      const receipt = await tx.purchaseReceipt.findFirst({ where: { id: receiptId, orgId: ctx.orgId }, include: { order: true, lines: true } });
      if (!receipt) throw new WorkflowError("Η παραλαβή δεν βρέθηκε");
      await assertStockScope(tx, ctx, { warehouseId: receipt.order.warehouseId, forWrite: true });
      if (receipt.reversedAt) throw new WorkflowError("Η παραλαβή έχει ήδη αναιρεθεί");
      if (receipt.invoiceDocId) throw new WorkflowError("Η παραλαβή έχει συνδεδεμένο τιμολόγιο και δεν μπορεί να αναιρεθεί");
      const { postStockMovement } = await import("./stock-db");
      for (const line of receipt.lines) {
        if (!line.lotId) throw new WorkflowError("Η παραλαβή περιέχει γραμμή χωρίς παρτίδα και δεν αναιρείται αυτόματα");
        const generic = await tx.genericItem.findFirst({ where: { id: line.genericItemId, orgId: ctx.orgId }, select: { avgCostHundredths: true, name: true } });
        if (!generic || generic.avgCostHundredths !== line.resultingAvgCostHundredths) throw new WorkflowError(`Το κόστος του «${generic?.name ?? "είδους"}» άλλαξε μεταγενέστερα· απαιτείται λογιστική διόρθωση`);
        const original = await tx.stockMovement.findFirst({ where: { orgId: ctx.orgId, documentId: receipt.purchaseDocId, lineId: line.purchaseLineId, source: "purchase" }, select: { recordedAt: true } });
        if (!original) throw new WorkflowError("Η αρχική κίνηση παραλαβής δεν βρέθηκε");
        const consumed = await tx.stockMovement.count({ where: { orgId: ctx.orgId, lotId: line.lotId, quantity: { lt: 0 }, recordedAt: { gt: original.recordedAt } } });
        if (consumed) throw new WorkflowError("Η παρτίδα έχει μεταγενέστερη κατανάλωση ή μεταφορά· η παραλαβή δεν μπορεί να αναιρεθεί");
        const balance = await tx.stockMovement.aggregate({ where: { orgId: ctx.orgId, lotId: line.lotId }, _sum: { quantity: true } });
        if ((balance._sum.quantity ?? 0) < line.quantityBase) throw new WorkflowError("Το υπόλοιπο της παρτίδας δεν επαρκεί για αναίρεση");
        await postStockMovement(tx, { orgId: ctx.orgId, warehouseId: receipt.order.warehouseId, documentId: receipt.purchaseDocId, lineId: `reversal:${line.id}`, quantity: -line.quantityBase, unitCostHundredths: line.resultingAvgCostHundredths, genericItemId: line.genericItemId, lotId: line.lotId, source: "purchase_reversal", note: cleanReason, actor: { id: ctx.userId, name: ctx.userName } });
        await tx.genericItem.update({ where: { id: line.genericItemId }, data: { avgCostHundredths: line.previousAvgCostHundredths } });
        await tx.purchaseOrderLine.update({ where: { id: line.orderLineId }, data: { receivedBaseQty: { decrement: line.quantityBase } } });
      }
      await tx.purchaseDoc.update({ where: { id: receipt.purchaseDocId }, data: { status: "CANCELLED" } });
      const reversed = await tx.purchaseReceipt.update({ where: { id: receipt.id }, data: { reversedAt: new Date(), reversalReason: cleanReason } });
      const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: receipt.orderId } });
      const status = orderStatus(lines);
      await tx.purchaseOrder.update({ where: { id: receipt.orderId }, data: { status } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "order.receipt.reverse", entityType: "purchase_receipt", entityId: receipt.id, warehouseId: receipt.order.warehouseId, reason: cleanReason, metadata: { purchaseDocId: receipt.purchaseDocId, lines: receipt.lines.length } });
      return reversed;
    });
  } catch (error) { throw translateStockError(error); }
}

/**
 * Το ίδιο δελτίο αποστολής δεν καταχωρίζεται δεύτερη φορά: ίδιος προμηθευτής και ίδιος αριθμός ή ίδιο MARK,
 * σε παραλαβή που δεν έχει αντιλογιστεί. Επιστρέφει πότε, πού και από ποιον καταχωρίστηκε.
 */
export async function receivedNote(tx: Pick<Prisma.TransactionClient, "purchaseReceipt">, orgId: string, supplierId: string, number: string | null | undefined, mark: string | null | undefined) {
  const or = [number ? { deliveryNoteNumber: { equals: number, mode: "insensitive" as const } } : null, mark ? { deliveryNoteMark: mark } : null].filter((x) => x !== null);
  if (!or.length) return null;
  const r = await tx.purchaseReceipt.findFirst({ where: { orgId, reversedAt: null, order: { supplierId }, OR: or }, orderBy: { createdAt: "asc" }, select: { createdAt: true, createdByName: true, deliveryNoteNumber: true, order: { select: { number: true } } } });
  if (!r) return null;
  const at = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" }).format(r.createdAt);
  return { orderNumber: r.order.number, at: r.createdAt, by: r.createdByName, message: `Το δελτίο ${r.deliveryNoteNumber ?? number ?? ""} έχει ήδη καταχωριστεί στις ${at} από ${r.createdByName}, στην παραγγελία ${r.order.number}.`.replace("  ", " ") };
}

function deliveryNote(input: DeliveryNoteInput | undefined) {
  const date = input?.date && !Number.isNaN(input.date.getTime()) ? input.date : null;
  return { deliveryNoteNumber: cleanText(input?.number, "Αριθμός δελτίου", 60), deliveryNoteDate: date, deliveryNoteMark: cleanText(input?.mark, "MARK δελτίου", 30) };
}

/**
 * Τι γίνεται με όσα λείπουν. «close» κλείνει τη γραμμή κοντά: αν η παραγγελία έχει τιμολόγιο (πληρώσαμε όλα),
 * η αξία τους γράφεται ως αίτημα πιστωτικού· χωρίς τιμολόγιο απλώς δεν τα περιμένουμε άλλο.
 */
async function applyShortfall(tx: Prisma.TransactionClient, ctx: StockContext, orderId: string, decisions: readonly ShortfallDecision[]) {
  if (new Set(decisions.map((d) => d.orderLineId)).size !== decisions.length) throw new WorkflowError("Διπλή απόφαση για το ίδιο είδος");
  const order = await tx.purchaseOrder.findFirstOrThrow({ where: { id: orderId, orgId: ctx.orgId }, include: { lines: true } });
  const byId = new Map(order.lines.map((line) => [line.id, line]));
  let creditCents = 0;
  for (const decision of decisions) {
    const line = byId.get(decision.orderLineId);
    if (!line) throw new WorkflowError("Το είδος δεν ανήκει στην παραγγελία");
    const missing = missingQty(line);
    if (!missing) continue;
    if (decision.action === "wait") {
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { expectedAt: decision.expectedAt ?? order.expectedAt ?? null } });
      continue;
    }
    if (order.invoiceDocId) {
      const generic = await tx.genericItem.findFirstOrThrow({ where: { id: line.genericItemId, orgId: ctx.orgId }, select: { baseUnit: { select: { dimension: true } } } });
      creditCents += lineValueCents(missing, line, stockCostScale(generic.baseUnit.dimension));
    }
    await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { closedBaseQty: { increment: missing }, expectedAt: null } });
  }
  if (creditCents) await tx.purchaseOrder.update({ where: { id: order.id }, data: { creditRequestedCents: { increment: creditCents } } });
  await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "order.shortfall", entityType: "purchase_order", entityId: order.id, warehouseId: order.warehouseId, metadata: { decisions: decisions.map((d) => ({ ...d, expectedAt: d.expectedAt?.toISOString() ?? null })), creditRequestedCents: creditCents } });
}

/** Αναμενόμενα ή αίτημα πιστωτικού έξω από παραλαβή, π.χ. όταν πέρασε η ημερομηνία και τα είδη δεν ήρθαν. */
export async function resolveShortfall(ctx: StockContext, orderId: string, decisions: ShortfallDecision[]) {
  if (!decisions.length) throw new WorkflowError("Δεν επιλέχθηκε κανένα είδος");
  return stockTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`purchase-order:${ctx.orgId}:${orderId}`}, 0))) AS lock`;
    const order = await tx.purchaseOrder.findFirst({ where: { id: orderId, orgId: ctx.orgId }, select: { id: true, warehouseId: true, status: true } });
    if (!order) throw new WorkflowError("Η παραγγελία δεν βρέθηκε");
    await assertStockScope(tx, ctx, { warehouseId: order.warehouseId, forWrite: true });
    if (!["SENT", "PARTIAL"].includes(order.status)) throw new WorkflowError("Η παραγγελία δεν είναι ανοιχτή");
    await applyShortfall(tx, ctx, order.id, decisions);
    const status = orderStatus(await tx.purchaseOrderLine.findMany({ where: { orderId: order.id } }));
    return tx.purchaseOrder.update({ where: { id: order.id }, data: { status } });
  }).catch((error) => { throw translateStockError(error); });
}

/**
 * Τιμολόγιο του προμηθευτή για όλη την παραγγελία, πριν έρθουν τα είδη (προπληρωμή). Μόνο οικονομικό:
 * χρωστάμε και πληρώνουμε, δεν γράφει απόθεμα· το απόθεμα το γράφουν τα δελτία αποστολής (παραλαβές).
 */
export async function createOrderInvoice(ctx: StockContext, input: { orderId: string; number: string; issuedAt: Date; mark?: string | null }) {
  const number = cleanText(input.number, "Αριθμός τιμολογίου", 100, true)!;
  if (!(input.issuedAt instanceof Date) || Number.isNaN(input.issuedAt.getTime())) throw new WorkflowError("Άκυρη ημερομηνία έκδοσης");
  const mark = cleanText(input.mark, "MARK", 30);
  return stockTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`purchase-order:${ctx.orgId}:${input.orderId}`}, 0))) AS lock`;
    const order = await tx.purchaseOrder.findFirst({ where: { id: input.orderId, orgId: ctx.orgId }, include: { lines: true, receipts: { where: { invoiceDocId: { not: null } }, select: { id: true } } } });
    if (!order) throw new WorkflowError("Η παραγγελία δεν βρέθηκε");
    await assertStockScope(tx, ctx, { warehouseId: order.warehouseId, forWrite: true });
    if (order.invoiceDocId) throw new WorkflowError("Η παραγγελία έχει ήδη τιμολόγιο");
    if (order.status === "DRAFT" || order.status === "CANCELLED") throw new WorkflowError("Τιμολόγιο καταχωρείται σε παραγγελία που έχει σταλεί");
    if (order.receipts.length) throw new WorkflowError("Κάποιο δελτίο της παραγγελίας έχει ήδη δικό του τιμολόγιο");
    if (mark && await tx.purchaseDoc.findFirst({ where: { orgId: ctx.orgId, mydataMark: mark }, select: { id: true } })) throw new WorkflowError("Υπάρχει ήδη παραστατικό με αυτό το MARK");
    const [supplier, organization, generics] = await Promise.all([
      tx.party.findFirst({ where: { id: order.supplierId, orgId: ctx.orgId } }),
      tx.organization.findUnique({ where: { id: ctx.orgId } }),
      tx.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: order.lines.map((l) => l.genericItemId) } }, include: { baseUnit: true } }),
    ]);
    if (!supplier || !organization) throw new WorkflowError("Τα στοιχεία της παραγγελίας δεν βρέθηκαν");
    const genericById = new Map(generics.map((g) => [g.id, g]));
    const invoice = await tx.purchaseDoc.create({ data: {
      orgId: ctx.orgId, supplierId: order.supplierId, warehouseId: order.warehouseId, kind: "INVOICE", status: "POSTED", number, issuedAt: input.issuedAt, mydataMark: mark,
      source: "order", note: `Τιμολόγιο παραγγελίας ${order.number}`, ...(await purchaseSnapshots(organization, supplier)), createdByName: ctx.userName,
      lines: { create: order.lines.map((line) => {
        const generic = genericById.get(line.genericItemId)!;
        return { orgId: ctx.orgId, description: generic.name, quantity: 1, unitPriceCents: Math.round(line.orderedBaseQty * line.unitPriceCents / stockCostScale(generic.baseUnit.dimension)), discountBps: line.discountBps, vatRate: line.vatRate, supplierItemId: line.supplierItemId, genericItemId: generic.id, matchNote: "order" };
      }) },
    } });
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { invoiceDocId: invoice.id } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "order.invoice", entityType: "purchase", entityId: invoice.id, warehouseId: order.warehouseId, metadata: { orderId: order.id, lines: order.lines.length, stockMovements: 0 } });
    return invoice;
  }).catch((error) => { throw translateStockError(error); });
}

function translateStockError(error: unknown) {
  if (error instanceof StockError) return new WorkflowError(STOCK_ERROR_MESSAGE[error.code]);
  if (error instanceof StockScopeError) return new WorkflowError(STOCK_SCOPE_ERROR_MESSAGE[error.code]);
  return error;
}

export async function saveMrpSetting(ctx: StockContext, input: { genericItemId: string; warehouseId?: string | null; supplierId?: string | null; leadDays: number; coverDays: number; minimumBaseQty: number; orderMultipleBase: number }) {
  assertNonNegativeInt(input.leadDays, "Ημέρες παράδοσης", 365);
  assertNonNegativeInt(input.coverDays, "Ημέρες κάλυψης", 365);
  assertNonNegativeInt(input.minimumBaseQty, "Ελάχιστη παραγγελία");
  assertPositiveInt(input.orderMultipleBase, "Πολλαπλάσιο παραγγελίας");
  return stockTransaction(async (tx) => {
    if (!input.warehouseId && (ctx.storeIds.length || ctx.warehouseIds.length)) throw new WorkflowError("Ο καθολικός κανόνας MRP απαιτεί πρόσβαση σε όλα τα καταστήματα και αποθήκες");
    await assertStockScope(tx, ctx, { warehouseIds: input.warehouseId ? [input.warehouseId] : [], forWrite: true });
    const generic = await tx.genericItem.findFirst({ where: { id: input.genericItemId, orgId: ctx.orgId }, select: { id: true } });
    if (!generic) throw new WorkflowError("Το είδος δεν βρέθηκε");
    if (input.supplierId) await assertParty(tx, ctx.orgId, input.supplierId, "supplier");
    const existing = await tx.mrpItemSetting.findFirst({ where: { orgId: ctx.orgId, genericItemId: input.genericItemId, warehouseId: input.warehouseId ?? null } });
    const data = { supplierId: input.supplierId ?? null, leadDays: input.leadDays, coverDays: input.coverDays, minimumBaseQty: input.minimumBaseQty, orderMultipleBase: input.orderMultipleBase };
    const setting = existing ? await tx.mrpItemSetting.update({ where: { id: existing.id }, data }) : await tx.mrpItemSetting.create({ data: { ...data, orgId: ctx.orgId, genericItemId: input.genericItemId, warehouseId: input.warehouseId ?? null } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "mrp.configure", entityType: "mrp_setting", entityId: setting.id, warehouseId: input.warehouseId });
    return setting;
  });
}

export async function buildMrpSuggestions(ctx: StockContext, warehouseId: string) {
  const { db } = await import("./db");
  await assertStockScope(db, ctx, { warehouseId });
  const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { mrpUsageDays: true, mrpCoverDays: true } });
  const usageDays = org?.mrpUsageDays ?? 28;
  const since = new Date(Date.now() - usageDays * 86400000);
  const [balances, usage, settings, generics, openLines] = await Promise.all([
    db.stockMovement.groupBy({ by: ["genericItemId"], where: { orgId: ctx.orgId, warehouseId, genericItemId: { not: null } }, _sum: { quantity: true } }),
    db.stockMovement.groupBy({ by: ["genericItemId"], where: { orgId: ctx.orgId, warehouseId, source: "production", quantity: { lt: 0 }, occurredAt: { gte: since }, genericItemId: { not: null } }, _sum: { quantity: true } }),
    db.mrpItemSetting.findMany({ where: { orgId: ctx.orgId, OR: [{ warehouseId }, { warehouseId: null }] } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, include: { baseUnit: true } }),
    db.purchaseOrderLine.findMany({ where: { orgId: ctx.orgId, order: { warehouseId, status: { in: ["SENT", "PARTIAL"] } } } }),
  ]);
  const onHand = new Map(balances.map((r) => [r.genericItemId!, r._sum.quantity ?? 0]));
  const consumed = new Map(usage.map((r) => [r.genericItemId!, -(r._sum.quantity ?? 0)]));
  const incoming = new Map<string, number>();
  for (const line of openLines) incoming.set(line.genericItemId, (incoming.get(line.genericItemId) ?? 0) + missingQty(line));
  return generics.map((generic) => {
    const setting = settings.find((s) => s.genericItemId === generic.id && s.warehouseId === warehouseId) ?? settings.find((s) => s.genericItemId === generic.id && s.warehouseId === null);
    const suggestion = mrpSuggestion({ onHandBaseQty: (onHand.get(generic.id) ?? 0) + (incoming.get(generic.id) ?? 0), averageDailyUsageBaseQty: (consumed.get(generic.id) ?? 0) / usageDays, leadDays: setting?.leadDays ?? 1, coverDays: setting?.coverDays ?? org?.mrpCoverDays ?? 4, minimumBaseQty: setting?.minimumBaseQty ?? 0, orderMultipleBase: setting?.orderMultipleBase ?? 1 });
    return { generic, setting, ...suggestion, onHandBaseQty: onHand.get(generic.id) ?? 0, incomingBaseQty: incoming.get(generic.id) ?? 0 };
  }).filter((row) => row.suggestedBaseQty > 0).sort((a, b) => b.suggestedBaseQty - a.suggestedBaseQty);
}
// Παραλαβή έως 200 γραμμών με πολλά ερωτήματα ανά γραμμή: το προεπιλεγμένο όριο των 5 δευτ. του Prisma δεν φτάνει.
const LONG_POSTING = { timeout: 30_000, maxWait: 10_000 };

