// Scoped payroll preparation: τα pay/IBAN διαβάζονται μόνο μετά από finance.export + staff.pay.
import { db } from "./db";
import { assertPayrollPaymentAccess, payrollMonthPeriod, preparePayrollPaymentBatch } from "./payroll-payments";
import { staffPayrollSummary } from "./staff-db";
import { assertStockScope, type StockContext } from "./stock-scope";
import { auditWorkflow } from "./workflow-db";

export async function exportPayrollPaymentBatch(ctx: StockContext, input: { from: string; to: string; storeId?: string | null; format: "csv" | "json" }) {
  assertPayrollPaymentAccess(ctx);
  const period = payrollMonthPeriod(input.from, input.to);
  await assertStockScope(db, ctx, { storeId: input.storeId ?? undefined });
  const employeeWhere = input.storeId ? { storeId: input.storeId } : ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : ctx.warehouseIds.length ? { warehouseId: { in: [...ctx.warehouseIds] } } : {};
  const [employees, summaries] = await Promise.all([
    db.employee.findMany({ where: { orgId: ctx.orgId, active: true, ...employeeWhere }, include: { pay: true }, orderBy: { id: "asc" } }),
    staffPayrollSummary(ctx, period.fromAt, period.toAt, input.storeId),
  ]);
  const batch = preparePayrollPaymentBatch({
    orgId: ctx.orgId, from: input.from, to: input.to, storeId: input.storeId,
    employees: employees.map((employee) => ({ orgId: employee.orgId, id: employee.id, name: employee.name, storeId: employee.storeId, active: employee.active, startDate: employee.startDate, endDate: employee.endDate, pay: employee.pay })),
    summaries: summaries.map((row) => ({ orgId: ctx.orgId, employeeId: row.employeeId, minutes: row.minutes, costCents: row.costCents })),
  });
  await auditWorkflow(db, {
    orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "finance.export.payroll_prepare", entityType: "finance_payroll_batch", entityId: batch.batchId, storeId: input.storeId,
    metadata: { format: input.format, from: input.from, to: input.to, employees: batch.totals.employees, ready: batch.totals.ready, review: batch.totals.review, amountCents: batch.totals.amountCents, executionStatus: batch.execution.status, financeTransactionsCreated: 0 },
  });
  return batch;
}
