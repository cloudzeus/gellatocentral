// Επιχειρησιακές αναφορές πάνω από τα ίδια scoped δεδομένα· καμία εγγραφή και καμία πρόσβαση εκτός tenant.
import { db } from "./db";
import { paymentBucket, purchaseTotals } from "./finance";
import {
  addAging, allocateCents, customerOutstandingDocuments, emptyAging, netFromGrossCents,
  productionCostProfiles, reportPeriod, signedDocument, splitStockCostCents, stockCostCents,
  type CostComponents, type ProductionCostBatch, type ProductionCostItem, type ReportPeriod,
} from "./reports";
import { staffPayrollSummary } from "./staff-db";
import { assertStockScope, type StockContext } from "./stock-scope";
import { warehouseScopeWhere } from "./stock-scope";
import { WorkflowError } from "./workflow-db";

export type ReportInput = { from: string; to: string; storeId?: string | null };
type CostBatchRow = ProductionCostBatch & { items: ProductionCostItem[] };
type ProductProfitabilityRow = CostComponents & {
  id: string; name: string; quantity: number; netCents: number; grossCents: number; cogsCents: number; commissionCents: number;
};
type WholesaleProfitabilityRow = CostComponents & {
  id: string; name: string; quantityBase: number; netCents: number; cogsCents: number; commissionCents: number;
};

function storeFilter(ctx: StockContext, storeId?: string | null) {
  if (storeId) return { storeId };
  if (ctx.storeIds.length) return { storeId: { in: [...ctx.storeIds] } };
  if (ctx.warehouseIds.length) return { storeId: { in: [] as string[] } };
  return {};
}

async function reportWarehouses(ctx: StockContext, storeId?: string | null) {
  const scope = warehouseScopeWhere(ctx);
  return db.warehouse.findMany({ where: { ...scope, ...(storeId ? { stores: { some: { storeId } } } : {}) }, select: { id: true, name: true } });
}

/** Φορτώνει μόνο τη γενεαλογία των πωληθέντων lots, συμπεριλαμβανομένων τυχόν ημιέτοιμων. */
async function productionCostByLot(orgId: string, lotIds: readonly string[]) {
  const batches = new Map<string, CostBatchRow>();
  const seenLots = new Set<string>();
  let pending = [...new Set(lotIds)];
  while (pending.length) {
    pending.forEach((lotId) => seenLots.add(lotId));
    const rows = await db.productionBatch.findMany({
      where: { orgId, outputLotId: { in: pending } },
      select: {
        id: true, outputLotId: true, costHundredths: true, labourCostCents: true,
        expectedQuantityGrams: true, quantityGrams: true, wasteGrams: true,
        items: { select: { id: true, batchId: true, lotId: true, costHundredths: true } },
      },
    });
    const next = new Set<string>();
    for (const row of rows) {
      if (batches.has(row.id)) continue;
      batches.set(row.id, row);
      for (const item of row.items) if (item.lotId && !seenLots.has(item.lotId)) next.add(item.lotId);
    }
    pending = [...next];
  }
  const profiles = productionCostProfiles([...batches.values()], [...batches.values()].flatMap((batch) => batch.items));
  const byLot = new Map<string, CostComponents>();
  for (const batch of batches.values()) if (batch.outputLotId) byLot.set(batch.outputLotId, profiles.get(batch.id)!);
  return byLot;
}

function commissionKey(storeId: string, day: string) {
  return `${storeId}:${day}`;
}

function visibleCosts(row: CostComponents, canSeePay: boolean) {
  return canSeePay
    ? { materialsCents: row.materialsCents, labourCents: row.labourCents, wasteCents: row.wasteCents }
    : { materialsCents: null, labourCents: null, wasteCents: null };
}

export async function businessReport(ctx: StockContext, input: ReportInput) {
  const period = reportPeriod(input.from, input.to);
  await assertStockScope(db, ctx, { storeId: input.storeId ?? undefined });
  const scopedStore = storeFilter(ctx, input.storeId);
  const warehouses = await reportWarehouses(ctx, input.storeId);
  const warehouseIds = warehouses.map((row) => row.id);
  const date = { gte: period.fromAt, lt: period.toAt };
  const closingTo = new Date(`${period.to}T00:00:00.000Z`);
  closingTo.setUTCDate(closingTo.getUTCDate() + 1);
  const closingDate = { gte: new Date(`${period.from}T00:00:00.000Z`), lt: closingTo };
  const [sales, documents, movements, batches, purchases, expenses, cashTransactions, customerDocuments, supplierDocuments, supplierAllocations, closings] = await Promise.all([
    db.sale.findMany({
      where: { orgId: ctx.orgId, ...scopedStore, status: "COMPLETED", issuedAt: date },
      include: {
        lines: { include: { product: { select: { id: true, name: true, recipes: { select: { outputGenericItemId: true } } } } } },
        payment: { select: { success: true, method: { select: { code: true, ledgerKind: true } } } },
      },
    }),
    db.salesDocument.findMany({ where: { orgId: ctx.orgId, ...scopedStore, status: "ISSUED", docType: { in: ["1.1", "5.1"] }, issuedAt: date }, include: { lines: true } }),
    db.stockMovement.findMany({ where: { orgId: ctx.orgId, ...scopedStore, source: "sale", occurredAt: date, quantity: { lt: 0 } } }),
    db.productionBatch.findMany({ where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, producedAt: date }, include: { recipe: { select: { name: true } } }, orderBy: { producedAt: "desc" } }),
    db.purchaseDoc.findMany({ where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, kind: "INVOICE", status: "POSTED", OR: [{ issuedAt: date }, { issuedAt: null, createdAt: date }] }, include: { lines: true, supplier: { select: { name: true } } } }),
    db.expense.findMany({ where: { orgId: ctx.orgId, ...scopedStore, occurredAt: date }, orderBy: { occurredAt: "desc" } }),
    db.financeTransaction.findMany({ where: { orgId: ctx.orgId, ...scopedStore, occurredAt: date, transferId: null }, orderBy: { occurredAt: "desc" } }),
    db.salesDocument.findMany({ where: { orgId: ctx.orgId, ...scopedStore, docType: { in: ["1.1", "5.1"] }, OR: [{ status: "ISSUED" }, { status: "CANCELLED", docType: "1.1" }] }, include: { allocations: true } }),
    db.purchaseDoc.findMany({ where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, kind: "INVOICE", status: "POSTED" }, include: { lines: true, supplier: { select: { id: true, name: true } } } }),
    db.supplierPaymentAllocation.groupBy({ by: ["purchaseDocId"], where: { orgId: ctx.orgId }, _sum: { amountCents: true } }),
    db.cashClosing.findMany({ where: { orgId: ctx.orgId, ...scopedStore, status: "CLOSED", businessDate: closingDate, commissionCents: { gt: 0 } }, select: { storeId: true, businessDate: true, commissionCents: true } }),
  ]);
  const genericIds = [...new Set([...movements.map((row) => row.genericItemId), ...documents.flatMap((row) => row.lines.map((line) => line.genericItemId))].filter((id): id is string => Boolean(id)))];
  const lotIds = [...new Set([...movements.map((row) => row.lotId), ...documents.flatMap((row) => row.lines.map((line) => line.lotId))].filter((id): id is string => Boolean(id)))];
  const [generics, costByLot] = await Promise.all([
    db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: genericIds } }, include: { baseUnit: true } }),
    productionCostByLot(ctx.orgId, lotIds),
  ]);
  const genericById = new Map(generics.map((row) => [row.id, row]));
  const fiscalDocumentIds = customerDocuments.flatMap((document) => document.fiscalDocumentId ? [document.fiscalDocumentId] : []);
  const fiscalDocuments = await db.fiscalDocument.findMany({ where: { orgId: ctx.orgId, id: { in: fiscalDocumentIds } }, select: { id: true, relatedId: true } });

  let posNetCents = 0, posVatCents = 0, posGrossCents = 0;
  const products = new Map<string, ProductProfitabilityRow>();
  const commissionBasis = new Map<string, Map<string, number>>();
  for (const sale of sales) {
    const paymentKind = sale.payment?.success ? paymentBucket(sale.payment.method) : null;
    const basis = paymentKind === "card" || paymentKind === "platform"
      ? commissionKey(sale.storeId, sale.issuedAt!.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" }))
      : null;
    for (const line of sale.lines) {
      const gross = line.quantity * line.unitPriceCents;
      const net = netFromGrossCents(gross, line.vatRate);
      posGrossCents += gross; posNetCents += net; posVatCents += gross - net;
      const row = products.get(line.productId) ?? { id: line.productId, name: line.product.name, quantity: 0, netCents: 0, grossCents: 0, cogsCents: 0, materialsCents: 0, labourCents: 0, wasteCents: 0, commissionCents: 0 };
      row.quantity += line.quantity; row.grossCents += gross; row.netCents += net; products.set(line.productId, row);
      if (basis && gross > 0) {
        const byProduct = commissionBasis.get(basis) ?? new Map<string, number>();
        byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + gross);
        commissionBasis.set(basis, byProduct);
      }
    }
  }
  const saleIds = new Set(sales.map((sale) => sale.id));
  const salesById = new Map(sales.map((sale) => [sale.id, sale]));
  let posCogsCents = 0, posCostedMovements = 0, unallocatedPosCogsCents = 0;
  for (const movement of movements) {
    const generic = movement.genericItemId ? genericById.get(movement.genericItemId) : null;
    if (!movement.documentId || !saleIds.has(movement.documentId) || !generic || movement.unitCostHundredths == null) continue;
    const cost = stockCostCents(-movement.quantity, movement.unitCostHundredths, generic.baseUnit.dimension);
    posCogsCents += cost; posCostedMovements += 1;
    const sale = salesById.get(movement.documentId)!;
    const candidates = sale.lines.filter((line) => line.product.recipes.some((recipe) => recipe.outputGenericItemId === movement.genericItemId));
    if (!candidates.length) { unallocatedPosCogsCents += cost; continue; }
    const parts = splitStockCostCents(cost, movement.lotId ? costByLot.get(movement.lotId) : undefined);
    let weights = candidates.map((line) => ({ id: line.id, weight: line.quantity * line.unitPriceCents }));
    // Σε μηδενική αξία πώλησης το κόστος επιμερίζεται με τις ποσότητες, όχι με αυθαίρετη «τελευταία» γραμμή.
    if (!weights.some((row) => row.weight > 0)) weights = candidates.map((line) => ({ id: line.id, weight: Math.max(0, line.quantity) }));
    const allocated = {
      materialsCents: allocateCents(parts.materialsCents, weights),
      labourCents: allocateCents(parts.labourCents, weights),
      wasteCents: allocateCents(parts.wasteCents, weights),
    };
    for (const line of candidates) {
      const row = products.get(line.productId)!;
      const materials = allocated.materialsCents.get(line.id)!;
      const labour = allocated.labourCents.get(line.id)!;
      const waste = allocated.wasteCents.get(line.id)!;
      row.materialsCents += materials; row.labourCents += labour; row.wasteCents += waste;
      row.cogsCents += materials + labour + waste;
    }
  }

  let wholesaleNetCents = 0, wholesaleVatCents = 0, wholesaleGrossCents = 0, wholesaleCogsCents = 0;
  const wholesaleItems = new Map<string, WholesaleProfitabilityRow>();
  for (const document of documents) {
    const signed = signedDocument(document);
    wholesaleNetCents += signed.netCents; wholesaleVatCents += signed.vatCents; wholesaleGrossCents += signed.totalCents;
    const sign = document.docType === "5.1" ? -1 : 1;
    for (const line of document.lines) {
      const cost = Math.round(line.costHundredths / 100);
      const parts = splitStockCostCents(cost, line.lotId ? costByLot.get(line.lotId) : undefined);
      wholesaleCogsCents += sign * cost;
      const row = wholesaleItems.get(line.genericItemId) ?? { id: line.genericItemId, name: genericById.get(line.genericItemId)?.name ?? "Είδος", quantityBase: 0, netCents: 0, cogsCents: 0, materialsCents: 0, labourCents: 0, wasteCents: 0, commissionCents: 0 };
      const generic = genericById.get(line.genericItemId);
      // Στη χονδρική η unitPriceCents είναι καθαρή αξία ανά kg/l/1.000 τεμ., όχι τελική με ΦΠΑ.
      const lineNet = generic ? stockCostCents(line.quantityBase, line.unitPriceCents * 100, generic.baseUnit.dimension) : 0;
      row.quantityBase += sign * line.quantityBase; row.netCents += sign * lineNet; row.cogsCents += sign * cost;
      row.materialsCents += sign * parts.materialsCents; row.labourCents += sign * parts.labourCents; row.wasteCents += sign * parts.wasteCents;
      wholesaleItems.set(line.genericItemId, row);
    }
  }

  // Η πηγή είναι πραγματικό κλείσιμο, αλλά το ποσό ανά προϊόν είναι διαχειριστικός επιμερισμός, όχι ledger γραμμή.
  const commissionByDay = new Map<string, number>();
  for (const closing of closings) {
    const key = commissionKey(closing.storeId, closing.businessDate.toISOString().slice(0, 10));
    commissionByDay.set(key, (commissionByDay.get(key) ?? 0) + closing.commissionCents);
  }
  let commissionCents = 0, unallocatedCommissionCents = 0;
  for (const [key, amount] of commissionByDay) {
    commissionCents += amount;
    const byProduct = commissionBasis.get(key);
    const weights = [...(byProduct?.entries() ?? [])].map(([id, weight]) => ({ id, weight }));
    if (!weights.some((row) => row.weight > 0)) { unallocatedCommissionCents += amount; continue; }
    const allocated = allocateCents(amount, weights);
    for (const [productId, value] of allocated) products.get(productId)!.commissionCents += value;
  }

  const purchaseRows = purchases.map((purchase) => ({ id: purchase.id, number: purchase.number, supplierName: purchase.supplier.name, ...purchaseTotals(purchase, purchase.lines) }));
  const purchasesNetCents = purchaseRows.reduce((sum, row) => sum + row.netCents, 0);
  const purchasesVatCents = purchaseRows.reduce((sum, row) => sum + row.vatCents, 0);
  const expenseNetCents = expenses.reduce((sum, row) => sum + row.netCents, 0);
  const expenseVatCents = expenses.reduce((sum, row) => sum + row.vatCents, 0);
  const canSeePay = ctx.can("staff.pay");
  const payroll = canSeePay ? await staffPayrollSummary(ctx, period.fromAt, period.toAt, input.storeId) : [];
  const payrollCents = payroll.reduce((sum, row) => sum + row.costCents, 0);
  const production = {
    batches: batches.length,
    expectedGrams: batches.reduce((sum, row) => sum + (row.expectedQuantityGrams ?? row.quantityGrams), 0),
    actualGrams: batches.reduce((sum, row) => sum + row.quantityGrams, 0),
    wasteGrams: batches.reduce((sum, row) => sum + row.wasteGrams, 0),
    labourMinutes: batches.reduce((sum, row) => sum + row.labourMinutes, 0),
    labourCostCents: canSeePay ? batches.reduce((sum, row) => sum + row.labourCostCents, 0) : null,
    rows: batches.map((row) => ({ id: row.id, batchNumber: row.batchNumber, recipeName: row.recipe.name, producedAt: row.producedAt, expectedGrams: row.expectedQuantityGrams ?? row.quantityGrams, actualGrams: row.quantityGrams, wasteGrams: row.wasteGrams, scrapReason: row.scrapReason })),
  };

  const at = new Date();
  const paidByPurchase = new Map(supplierAllocations.map((row) => [row.purchaseDocId, row._sum.amountCents ?? 0]));
  const supplierById = new Map<string, { id: string; name: string; outstandingCents: number; aging: ReturnType<typeof emptyAging> }>();
  for (const purchase of supplierDocuments) {
    const outstanding = Math.max(0, purchaseTotals(purchase, purchase.lines).totalCents - (paidByPurchase.get(purchase.id) ?? 0));
    if (!outstanding) continue;
    const row = supplierById.get(purchase.supplierId) ?? { id: purchase.supplierId, name: purchase.supplier.name, outstandingCents: 0, aging: emptyAging() };
    row.outstandingCents += outstanding; addAging(row.aging, outstanding, purchase.issuedAt, at); supplierById.set(purchase.supplierId, row);
  }
  const customerById = new Map<string, { id: string; name: string; outstandingCents: number; aging: ReturnType<typeof emptyAging> }>();
  for (const document of customerOutstandingDocuments(customerDocuments, fiscalDocuments)) {
    const snapshot = document.customerSnapshot as { name?: unknown };
    const name = typeof snapshot.name === "string" ? snapshot.name : "Πελάτης";
    const row = customerById.get(document.customerId) ?? { id: document.customerId, name, outstandingCents: 0, aging: emptyAging() };
    row.outstandingCents += document.outstandingCents; addAging(row.aging, document.outstandingCents, document.dueAt, at); customerById.set(document.customerId, row);
  }

  const cashInCents = cashTransactions.filter((row) => row.amountCents > 0).reduce((sum, row) => sum + row.amountCents, 0);
  const cashOutCents = -cashTransactions.filter((row) => row.amountCents < 0).reduce((sum, row) => sum + row.amountCents, 0);
  const netRevenueCents = posNetCents + wholesaleNetCents;
  const cogsCents = posCogsCents + wholesaleCogsCents;
  return {
    period: period satisfies ReportPeriod,
    sales: { posCount: sales.length, posNetCents, posVatCents, posGrossCents, wholesaleCount: documents.filter((row) => row.docType === "1.1").length, creditCount: documents.filter((row) => row.docType === "5.1").length, wholesaleNetCents, wholesaleVatCents, wholesaleGrossCents, netRevenueCents },
    margin: { posCogsCents, wholesaleCogsCents, cogsCents, grossCents: netRevenueCents - cogsCents, expenseNetCents, payrollCents, operatingCents: netRevenueCents - cogsCents - expenseNetCents - payrollCents, posCostedMovements, posMovementCount: movements.filter((row) => row.documentId && saleIds.has(row.documentId)).length, unallocatedPosCogsCents, commissionCents, unallocatedCommissionCents },
    vat: { outputCents: posVatCents + wholesaleVatCents, purchaseCents: purchasesVatCents, expenseCents: expenseVatCents, balanceCents: posVatCents + wholesaleVatCents - purchasesVatCents - expenseVatCents },
    cash: { inCents: cashInCents, outCents: cashOutCents, netCents: cashInCents - cashOutCents, rows: cashTransactions.slice(0, 50) },
    production,
    purchases: { netCents: purchasesNetCents, vatCents: purchasesVatCents, rows: purchaseRows },
    payroll,
    products: [...products.values()].map((row) => ({ ...row, ...visibleCosts(row, canSeePay), contributionCents: row.netCents - row.cogsCents - row.commissionCents })).sort((a, b) => b.netCents - a.netCents || a.id.localeCompare(b.id)),
    wholesaleItems: [...wholesaleItems.values()].map((row) => ({ ...row, ...visibleCosts(row, canSeePay), contributionCents: row.netCents - row.cogsCents - row.commissionCents })).sort((a, b) => b.netCents - a.netCents || a.id.localeCompare(b.id)),
    customers: [...customerById.values()].sort((a, b) => b.outstandingCents - a.outstandingCents),
    suppliers: [...supplierById.values()].sort((a, b) => b.outstandingCents - a.outstandingCents),
  };
}

export async function reportTarget(ctx: StockContext, period: ReportPeriod, storeId?: string | null) {
  const month = Number(period.fromAt.toLocaleDateString("en-US", { timeZone: "Europe/Athens", month: "numeric" }));
  const year = Number(period.fromAt.toLocaleDateString("en-US", { timeZone: "Europe/Athens", year: "numeric" }));
  const target = await db.budgetTarget.findFirst({ where: { orgId: ctx.orgId, storeId: storeId ?? null, year, month } });
  if (target && target.storeId) await assertStockScope(db, ctx, { storeId: target.storeId });
  if (!storeId && (ctx.storeIds.length || ctx.warehouseIds.length)) return null;
  return target;
}

export function reportError(error: unknown) {
  return error instanceof Error ? error.message : "Η αναφορά δεν είναι διαθέσιμη";
}

export { WorkflowError };
