// Αξιολόγηση προμηθευτή αποκλειστικά από πραγματικά POSTED παραστατικά, παραλαβές και δομημένες αποκλίσεις.
// Δεν γράφει procurement δεδομένα και δεν δημιουργεί υποκειμενικό σκορ· κάθε KPI παραπέμπει σε συγκεκριμένα γεγονότα.
import { daysBetween } from "./crm.ts";
import { db } from "./db.ts";
import type { Permission } from "./permissions.ts";
import { calculatePurchaseDocument, type PurchaseLineAmounts, type PurchaseExpenses } from "./purchase-document.ts";
import type { StockContext } from "./stock-scope.ts";

export function canEvaluateSupplier(permissions: readonly Permission[]) {
  return permissions.includes("reports.read") && permissions.includes("purchases.read");
}

/** Υποχρεωτικό tenant/supplier/warehouse φίλτρο και για τα δύο είδη αγοράς. */
export function supplierPostedWhere(ctx: Pick<StockContext, "orgId">, supplierId: string, warehouseIds: readonly string[], kind: "INVOICE" | "RECEIPT") {
  return { orgId: ctx.orgId, supplierId, warehouseId: { in: [...warehouseIds] }, kind, status: "POSTED" as const };
}

type InvoiceRow = PurchaseExpenses & { id: string; status: string; lines: PurchaseLineAmounts[] };
type ReceiptDocRow = { id: string; issuedAt: Date | null; createdAt: Date; warehouse: { name: string } };
type ReceiptRow = {
  id: string; purchaseDocId: string; reversedAt: Date | null; invoiceMatchStatus: string;
  order: { id: string; number: string; expectedAt: Date | null };
  discrepancies: { id: string }[];
  invoiceDiscrepancies: { id: string }[];
};

export type SupplierEvaluationRow = {
  id: string; at: Date; orderId: string; orderNumber: string; warehouseName: string;
  expectedAt: Date | null; delayDays: number | null; discrepancyCount: number; invoiceMatchStatus: string;
};
export type SupplierEvaluation = {
  invoiceCount: number; netCents: number; vatCents: number; totalCents: number;
  receiptCount: number; scheduledReceiptCount: number; onTimeReceiptCount: number; lateReceiptCount: number;
  onTimeRateBps: number | null; receiptsWithDiscrepancies: number; discrepancyRateBps: number | null;
  receiptDiscrepancyCount: number; invoiceDiscrepancyCount: number; rows: SupplierEvaluationRow[];
};

/** Καθαρά KPI: αντιστρέψιμες/μη POSTED παραλαβές δεν μπαίνουν στον παρονομαστή ούτε στις αποκλίσεις. */
export function calculateSupplierEvaluation(input: { invoices: InvoiceRow[]; receiptDocs: ReceiptDocRow[]; receipts: ReceiptRow[] }): SupplierEvaluation {
  const invoices = input.invoices.filter((invoice) => invoice.status === "POSTED");
  const totals = invoices.map((invoice) => calculatePurchaseDocument(invoice.lines, invoice));
  const docs = new Map(input.receiptDocs.map((doc) => [doc.id, doc]));
  const receipts = input.receipts.filter((receipt) => !receipt.reversedAt && docs.has(receipt.purchaseDocId));
  let onTimeReceiptCount = 0, lateReceiptCount = 0, receiptsWithDiscrepancies = 0, receiptDiscrepancyCount = 0, invoiceDiscrepancyCount = 0;
  const rows = receipts.map((receipt): SupplierEvaluationRow => {
    const doc = docs.get(receipt.purchaseDocId)!;
    const at = doc.issuedAt ?? doc.createdAt;
    const delayDays = receipt.order.expectedAt ? daysBetween(receipt.order.expectedAt, at) : null;
    if (delayDays !== null) {
      if (delayDays <= 0) onTimeReceiptCount += 1;
      else lateReceiptCount += 1;
    }
    const discrepancyCount = receipt.discrepancies.length + receipt.invoiceDiscrepancies.length;
    if (discrepancyCount) receiptsWithDiscrepancies += 1;
    receiptDiscrepancyCount += receipt.discrepancies.length;
    invoiceDiscrepancyCount += receipt.invoiceDiscrepancies.length;
    return {
      id: receipt.id, at, orderId: receipt.order.id, orderNumber: receipt.order.number, warehouseName: doc.warehouse.name,
      expectedAt: receipt.order.expectedAt, delayDays, discrepancyCount, invoiceMatchStatus: receipt.invoiceMatchStatus,
    };
  });
  const scheduledReceiptCount = onTimeReceiptCount + lateReceiptCount;
  return {
    invoiceCount: invoices.length,
    netCents: totals.reduce((sum, total) => sum + total.totalNetCents, 0),
    vatCents: totals.reduce((sum, total) => sum + total.totalVatCents, 0),
    totalCents: totals.reduce((sum, total) => sum + total.totalCents, 0),
    receiptCount: receipts.length, scheduledReceiptCount, onTimeReceiptCount, lateReceiptCount,
    onTimeRateBps: scheduledReceiptCount ? Math.round((onTimeReceiptCount * 10_000) / scheduledReceiptCount) : null,
    receiptsWithDiscrepancies,
    discrepancyRateBps: receipts.length ? Math.round((receiptsWithDiscrepancies * 10_000) / receipts.length) : null,
    receiptDiscrepancyCount, invoiceDiscrepancyCount,
    rows: rows.sort((a, b) => b.at.getTime() - a.at.getTime()),
  };
}

export async function loadSupplierEvaluation(ctx: Pick<StockContext, "orgId" | "storeIds" | "warehouseIds">, supplierId: string): Promise<SupplierEvaluation> {
  const warehouses = await db.warehouse.findMany({
    where: {
      orgId: ctx.orgId,
      ...(ctx.warehouseIds.length ? { id: { in: [...ctx.warehouseIds] } } : ctx.storeIds.length ? { stores: { some: { storeId: { in: [...ctx.storeIds] } } } } : {}),
    },
    select: { id: true },
  });
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const [invoices, receiptDocs] = await Promise.all([
    db.purchaseDoc.findMany({
      where: supplierPostedWhere(ctx, supplierId, warehouseIds, "INVOICE"),
      select: { id: true, status: true, shippingCostCents: true, otherExpensesCents: true, expensesVatRate: true, lines: { select: { quantity: true, unitPriceCents: true, discountBps: true, vatRate: true } } },
    }),
    db.purchaseDoc.findMany({
      where: supplierPostedWhere(ctx, supplierId, warehouseIds, "RECEIPT"),
      select: { id: true, issuedAt: true, createdAt: true, warehouse: { select: { name: true } } },
    }),
  ]);
  const receiptDocIds = receiptDocs.map((doc) => doc.id);
  const receipts = receiptDocIds.length ? await db.purchaseReceipt.findMany({
    where: { orgId: ctx.orgId, purchaseDocId: { in: receiptDocIds }, reversedAt: null },
    select: {
      id: true, purchaseDocId: true, reversedAt: true, invoiceMatchStatus: true,
      order: { select: { id: true, number: true, expectedAt: true } },
      discrepancies: { select: { id: true } }, invoiceDiscrepancies: { select: { id: true } },
    },
  }) : [];
  return calculateSupplierEvaluation({ invoices, receiptDocs, receipts });
}
