// Accountant export πάνω από scoped νόμιμα δεδομένα· δεν περιλαμβάνει μισθούς, IBAN ή informal εγγραφές.
import { buildAccountantPackage, type AccountantEntry } from "./accountant-export";
import { db } from "./db";
import { purchaseTotals } from "./finance";
import { netFromGrossCents, reportPeriod } from "./reports";
import { assertStockScope, warehouseScopeWhere, type StockContext } from "./stock-scope";
import { auditWorkflow, WorkflowError } from "./workflow-db";

function counterpartyName(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("name" in snapshot)) return null;
  return typeof snapshot.name === "string" ? snapshot.name : null;
}

export async function exportAccountantPackage(ctx: StockContext, input: { from: string; to: string; storeId?: string | null; format: "csv" | "json" }) {
  if (!ctx.can("finance.export")) throw new WorkflowError("Δεν έχεις δικαίωμα accountant export");
  const period = reportPeriod(input.from, input.to);
  await assertStockScope(db, ctx, { storeId: input.storeId ?? undefined });
  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;
  const storeWhere = input.storeId ? { storeId: input.storeId } : ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : ctx.warehouseIds.length ? { storeId: { in: [] as string[] } } : {};
  const [accounts, warehouses] = await Promise.all([
    db.financeAccount.findMany({ where: { orgId: ctx.orgId, ...storeWhere }, select: { id: true } }),
    db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), ...(input.storeId ? { stores: { some: { storeId: input.storeId } } } : {}) }, select: { id: true } }),
  ]);
  const accountIds = accounts.map((row) => row.id), warehouseIds = warehouses.map((row) => row.id);
  const date = { gte: period.fromAt, lt: period.toAt };
  const [sales, salesDocuments, purchases, expenses, payments] = await Promise.all([
    db.sale.findMany({ where: { orgId: ctx.orgId, ...storeWhere, status: "COMPLETED", issuedAt: date, fiscal: { is: { status: "SIGNED" } } }, include: { lines: true }, orderBy: { issuedAt: "asc" } }),
    db.salesDocument.findMany({ where: { orgId: ctx.orgId, ...storeWhere, status: "ISSUED", docType: { in: ["1.1", "5.1"] }, issuedAt: date }, orderBy: { issuedAt: "asc" } }),
    db.purchaseDoc.findMany({ where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, kind: "INVOICE", status: "POSTED", issuedAt: date }, include: { lines: true, supplier: { select: { name: true } } }, orderBy: { issuedAt: "asc" } }),
    db.expense.findMany({ where: { orgId: ctx.orgId, ...storeWhere, informal: false, occurredAt: date }, orderBy: { occurredAt: "asc" } }),
    db.supplierPayment.findMany({ where: { orgId: ctx.orgId, ...(restricted || input.storeId ? { accountId: { in: accountIds } } : {}), informal: false, paidAt: date }, orderBy: { paidAt: "asc" } }),
  ]);
  const paymentIds = payments.map((row) => row.id);
  const [rawAllocations, accessiblePurchases, parties] = await Promise.all([
    db.supplierPaymentAllocation.findMany({ where: { orgId: ctx.orgId, paymentId: { in: paymentIds } } }),
    db.purchaseDoc.findMany({ where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, kind: "INVOICE", status: "POSTED" }, select: { id: true } }),
    db.party.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set([...expenses.map((row) => row.supplierId), ...payments.map((row) => row.supplierId)].filter((id): id is string => Boolean(id)))] } }, select: { id: true, name: true } }),
  ]);
  const accessiblePurchaseIds = new Set(accessiblePurchases.map((row) => row.id));
  const partyNames = new Map(parties.map((row) => [row.id, row.name]));
  const entries: AccountantEntry[] = [
    ...sales.map((sale): AccountantEntry => {
      const netCents = sale.lines.reduce((sum, line) => sum + netFromGrossCents(line.quantity * line.unitPriceCents, line.vatRate), 0);
      return { id: sale.id, orgId: sale.orgId, type: "POS_SALE", status: sale.status, fiscalSigned: true, storeId: sale.storeId, occurredAt: sale.issuedAt!, number: sale.series && sale.aa ? `${sale.series}-${sale.aa}` : null, counterparty: null, netCents, vatCents: sale.totalCents - netCents, totalCents: sale.totalCents, reference: null };
    }),
    ...salesDocuments.map((row): AccountantEntry => ({ id: row.id, orgId: row.orgId, type: "SALES_DOCUMENT", status: row.status, documentKind: row.docType, storeId: row.storeId, occurredAt: row.issuedAt, number: `${row.series}-${row.aa}`, counterparty: counterpartyName(row.customerSnapshot), netCents: row.netCents, vatCents: row.vatCents, totalCents: row.totalCents, reference: row.fiscalDocumentId })),
    ...purchases.map((row): AccountantEntry => ({ id: row.id, orgId: row.orgId, type: "PURCHASE", status: row.status, documentKind: row.kind, storeId: input.storeId ?? null, occurredAt: row.issuedAt!, number: row.number, counterparty: row.supplier.name, ...purchaseTotals(row, row.lines), reference: row.mydataMark })),
    ...expenses.map((row): AccountantEntry => ({ id: row.id, orgId: row.orgId, type: "EXPENSE", status: "RECORDED", informal: row.informal, storeId: row.storeId, occurredAt: row.occurredAt, number: row.documentNumber, counterparty: row.supplierId ? partyNames.get(row.supplierId) ?? null : null, netCents: row.netCents, vatCents: row.vatCents, totalCents: row.totalCents, reference: row.category })),
    ...payments.map((row): AccountantEntry => ({ id: row.id, orgId: row.orgId, type: "SUPPLIER_PAYMENT", status: "RECORDED", informal: row.informal, storeId: input.storeId ?? (restricted ? ctx.storeIds.length === 1 ? ctx.storeIds[0] : null : null), occurredAt: row.paidAt, number: null, counterparty: partyNames.get(row.supplierId) ?? null, netCents: 0, vatCents: 0, totalCents: row.amountCents, reference: row.reference })),
  ];
  const result = buildAccountantPackage({
    orgId: ctx.orgId, from: input.from, to: input.to, fromAt: period.fromAt, toAt: period.toAt, storeId: input.storeId,
    entries,
    allocations: rawAllocations.filter((row) => accessiblePurchaseIds.has(row.purchaseDocId)),
  });
  await auditWorkflow(db, {
    orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "finance.export.accountant", entityType: "finance_export", entityId: result.packageId, storeId: input.storeId,
    metadata: { format: input.format, from: input.from, to: input.to, entries: result.totals.entries, allocations: result.totals.allocations, formalOnly: true, includesPayroll: false },
  });
  return result;
}
