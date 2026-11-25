// Κοινός writer παραλαβής: χρησιμοποιείται και από μεμονωμένο τιμολόγιο και από παραγγελία.
// Ο caller μπορεί να τρέξει τον writer στο ίδιο transaction με τα υπόλοιπα business records.
import type { Prisma } from "./generated/prisma/client";
import { PurchaseError, lineBaseQty, perPackCents, purchaseUnitCostHundredths } from "./purchases";
import { priceCheck, shouldWritePrice } from "./purchase-pricing";
import { genericStockBalance, postStockMovement, STOCK_ERROR_MESSAGE, StockError } from "./stock-db";
import { stockTransaction } from "./stock-transaction";
import { assertStockScope, STOCK_SCOPE_ERROR_MESSAGE, StockScopeError, type StockContext } from "./stock-scope";
import { writeAudit } from "./audit";

export type PurchaseLinePosted = { purchaseLineId: string; genericItemId: string; lotId: string | null; quantityBase: number; previousAvgCostHundredths: number; resultingAvgCostHundredths: number };

export async function postPurchaseInTransaction(
  tx: Prisma.TransactionClient,
  ctx: StockContext,
  docId: string,
  onLinePosted?: (line: PurchaseLinePosted) => Promise<void> | void,
) {
  const orgId = ctx.orgId;
  const doc = await tx.purchaseDoc.findFirst({
    where: { id: docId, orgId },
    include: { lines: { include: { supplierItem: { include: { prices: { orderBy: { validFrom: "desc" } } } }, tradeItem: { include: { contentUnit: true } }, genericItem: { include: { baseUnit: true } } } }, receiptInvoice: { select: { id: true } } },
  });
  if (!doc) throw new PurchaseError("Το τιμολόγιο δεν βρέθηκε");
  if (doc.receiptInvoice) throw new PurchaseError("Το τιμολόγιο παραλαβής οριστικοποιείται μόνο μέσω του τριπλού ελέγχου, χωρίς νέα εγγραφή αποθέματος");
  if (doc.status !== "DRAFT") throw new PurchaseError("Το τιμολόγιο έχει ήδη καταχωρηθεί");
  if (!doc.lines.length) throw new PurchaseError("Το τιμολόγιο δεν έχει γραμμές");
  const unmatched = doc.lines.find((l) => !l.genericItemId || !l.tradeItemId);
  if (unmatched) throw new PurchaseError(`Η γραμμή «${unmatched.description}» δεν έχει αντιστοιχιστεί`);
  await assertStockScope(tx, ctx, { warehouseId: doc.warehouseId, forWrite: true });
  const at = doc.issuedAt ?? new Date();

  for (const line of doc.lines) {
    const packQty = line.supplierItem?.packQty ?? 1;
    const content = line.tradeItem!.contentQty;
    if (line.tradeItem!.contentUnit.dimension !== line.genericItem!.baseUnit.dimension) throw new PurchaseError(`Η γραμμή «${line.description}» έχει ασύμβατη μονάδα`);
    const qtyBase = lineBaseQty(line.quantity, packQty, content);
    const generic = line.genericItem!;
    const perPack = perPackCents(line.unitPriceCents, packQty, line.discountBps);
    const pH = purchaseUnitCostHundredths(perPack, content, generic.baseUnit.dimension);
    const stock = generic.trackStock ? await genericStockBalance(tx, orgId, generic.id) : 0;
    const previousAvg = generic.avgCostHundredths;
    let lotId: string | null = null;

    if (generic.trackStock) {
      let lot = await tx.stockLot.findFirst({ where: { orgId, genericItemId: generic.id, warehouseId: doc.warehouseId, batchNumber: line.batchNumber ?? null } });
      if (!lot) lot = await tx.stockLot.create({ data: { orgId, genericItemId: generic.id, warehouseId: doc.warehouseId, batchNumber: line.batchNumber ?? null, expiresAt: line.expiresAt ?? null, documentId: doc.id } });
      else if (!lot.expiresAt && line.expiresAt) lot = await tx.stockLot.update({ where: { id: lot.id }, data: { expiresAt: line.expiresAt } });
      lotId = lot.id;
      await postStockMovement(tx, { orgId, warehouseId: doc.warehouseId, documentId: doc.id, lineId: line.id, quantity: qtyBase, unitCostHundredths: Math.round(pH), genericItemId: generic.id, lotId: lot.id, source: "purchase", occurredAt: at, actor: { id: ctx.userId, name: ctx.userName } });
    }

    const next = pH > 0 ? (!generic.trackStock || stock <= 0 ? Math.round(pH) : Math.round((stock * previousAvg + qtyBase * pH) / (stock + qtyBase))) : previousAvg;
    if (next !== previousAvg) await tx.genericItem.update({ where: { id: generic.id }, data: { avgCostHundredths: next } });
    await onLinePosted?.({ purchaseLineId: line.id, genericItemId: generic.id, lotId, quantityBase: qtyBase, previousAvgCostHundredths: previousAvg, resultingAvgCostHundredths: next });

    if (line.supplierItem && shouldWritePrice(priceCheck(perPack, line.supplierItem.prices, line.quantity * packQty, at))) {
      await tx.supplierItemPrice.create({ data: { supplierItemId: line.supplierItem.id, priceCents: perPack, validFrom: at, note: `Από τιμολόγιο${doc.number ? ` ${doc.number}` : ""}`, createdByName: doc.createdByName } });
    }
  }

  const posted = await tx.purchaseDoc.update({ where: { id: doc.id }, data: { status: "POSTED" } });
  await writeAudit(tx, { orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "purchase.post", entityType: "purchase", entityId: doc.id, warehouseId: doc.warehouseId, metadata: { lines: doc.lines.length } });
  return posted;
}

export async function postPurchase(ctx: StockContext, docId: string) {
  try {
    // τιμολόγιο με πολλές γραμμές: το προεπιλεγμένο όριο των 5 δευτ. του Prisma δεν φτάνει
    return await stockTransaction((tx) => postPurchaseInTransaction(tx, ctx, docId), { timeout: 30_000, maxWait: 10_000 });
  } catch (error) {
    if (error instanceof StockError) throw new PurchaseError(STOCK_ERROR_MESSAGE[error.code]);
    if (error instanceof StockScopeError) throw new PurchaseError(STOCK_SCOPE_ERROR_MESSAGE[error.code]);
    throw error;
  }
}
