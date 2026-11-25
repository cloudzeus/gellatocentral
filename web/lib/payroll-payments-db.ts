// Persisted payroll snapshots και provider state machine· pay/IBAN μόνο με finance.export + staff.pay.
import { createHash } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { db } from "./db";
import {
  assertPayrollExecutionConfirmation,
  assertPayrollPaymentAccess,
  payrollMonthPeriod,
  preparePayrollPaymentBatch,
  type PayrollExecutionReceipt,
  type PayrollExecutionStatus,
  type PayrollPaymentBatch,
  type PayrollPaymentBatchListItem,
  type PayrollPaymentRow,
} from "./payroll-payments";
import { resolvePayrollPaymentProvider, type PayrollPaymentProvider, type PayrollProviderResult } from "./payroll-payment-providers";
import { staffPayrollSummary } from "./staff-db";
import { stockTransaction } from "./stock-transaction";
import { assertGlobalStockScope, assertStockScope, type StockContext } from "./stock-scope";
import { auditWorkflow, cleanText, WorkflowError } from "./workflow-db";

type Tx = Prisma.TransactionClient;
type StoredExecution = {
  id: string;
  batchId: string;
  accountId: string;
  clientKey: string;
  requestHash: string;
  status: string;
  provider: string;
  providerReference: string | null;
  failureCode: string | null;
};
type StoredItem = {
  employeeId: string;
  employeeName: string;
  storeId: string | null;
  iban: string;
  amountCents: number;
  workedMinutes: number;
  reviewStatus: string;
  issues: string[];
  executionStatus: string;
};
type StoredBatch = {
  id: string;
  orgId: string;
  storeId: string | null;
  batchId: string;
  fromDate: Date;
  toDate: Date;
  status: string;
  totalAmountCents: number;
  readyAmountCents: number;
  employeeCount: number;
  readyCount: number;
  reviewCount: number;
  createdAt: Date;
  items: StoredItem[];
  executions: StoredExecution[];
};
const batchInclude = { items: { orderBy: { employeeId: "asc" } }, executions: { orderBy: { createdAt: "desc" } } } satisfies Prisma.PayrollPaymentBatchInclude;

function paymentRow(row: StoredItem): PayrollPaymentRow {
  return {
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    storeId: row.storeId,
    iban: row.iban,
    amountCents: row.amountCents,
    workedMinutes: row.workedMinutes,
    reviewStatus: row.reviewStatus === "READY" ? "READY" : "REVIEW",
    issues: row.issues,
    executionStatus: row.executionStatus === "SUCCEEDED" ? "SUCCEEDED" : "NOT_EXECUTED",
  };
}

function storedBatch(batch: StoredBatch): PayrollPaymentBatch {
  const latest = batch.executions[0];
  const status = (latest?.status ?? (batch.status === "PREPARED" ? "NOT_EXECUTED" : batch.status)) as PayrollExecutionStatus;
  return {
    version: 1,
    batchId: batch.batchId,
    kind: "PAYROLL_PAYMENT_PREPARATION",
    filters: { orgId: batch.orgId, from: batch.fromDate.toISOString().slice(0, 10), to: batch.toDate.toISOString().slice(0, 10), storeId: batch.storeId },
    execution: { status, provider: latest?.provider ?? null, financeTransactionsCreated: status === "SUCCEEDED" ? 1 : 0 },
    rows: batch.items.map(paymentRow),
    totals: { employees: batch.employeeCount, ready: batch.readyCount, review: batch.reviewCount, amountCents: batch.totalAmountCents, readyAmountCents: batch.readyAmountCents },
  };
}

function executionReceipt(execution: StoredExecution, batch: StoredBatch): PayrollExecutionReceipt {
  const status = execution.status as PayrollExecutionReceipt["status"];
  return {
    executionId: execution.id,
    batchId: batch.batchId,
    status,
    provider: execution.provider,
    providerReference: execution.providerReference,
    failureCode: execution.failureCode,
    amountCents: batch.readyAmountCents,
    financeTransactionsCreated: status === "SUCCEEDED" ? 1 : 0,
  };
}

async function assertBatchScope(tx: Tx, ctx: StockContext, batch: StoredBatch) {
  if (batch.storeId) {
    await assertStockScope(tx, ctx, { storeId: batch.storeId });
    if (!ctx.storeIds.length && ctx.warehouseIds.length) {
      const linked = await tx.storeWarehouse.findFirst({ where: { storeId: batch.storeId, warehouseId: { in: [...ctx.warehouseIds] }, warehouse: { orgId: ctx.orgId } }, select: { storeId: true } });
      if (!linked) throw new WorkflowError("Δεν έχεις πρόσβαση στο payroll batch");
    }
    return;
  }
  if (!ctx.storeIds.length && !ctx.warehouseIds.length) return;
  // Καθολικό batch με μερικό scope επιτρέπεται μόνο αν όλα τα snapshot items ανήκουν στο scope.
  if (ctx.storeIds.length) {
    if (batch.items.some((item) => !item.storeId || !ctx.storeIds.includes(item.storeId))) throw new WorkflowError("Δεν έχεις πρόσβαση σε όλο το payroll batch");
    return;
  }
  const employees = await tx.employee.findMany({ where: { orgId: ctx.orgId, id: { in: batch.items.map((item) => item.employeeId) }, warehouseId: { in: [...ctx.warehouseIds] } }, select: { id: true } });
  if (employees.length !== new Set(batch.items.map((item) => item.employeeId)).size) throw new WorkflowError("Δεν έχεις πρόσβαση σε όλο το payroll batch");
}

async function ownedPayrollAccount(tx: Tx, ctx: StockContext, accountId: string) {
  const account = await tx.financeAccount.findFirst({ where: { id: accountId, orgId: ctx.orgId, active: true, kind: "bank" } });
  if (!account) throw new WorkflowError("Ο τραπεζικός λογαριασμός πληρωμής δεν βρέθηκε ή είναι ανενεργός");
  if (!account.storeId) assertGlobalStockScope(ctx);
  await assertStockScope(tx, ctx, { storeId: account.storeId ?? undefined, forWrite: true });
  if (account.storeId && !ctx.storeIds.length && ctx.warehouseIds.length) {
    const linked = await tx.storeWarehouse.findFirst({ where: { storeId: account.storeId, warehouseId: { in: [...ctx.warehouseIds] }, warehouse: { orgId: ctx.orgId } }, select: { storeId: true } });
    if (!linked) throw new WorkflowError("Δεν έχεις πρόσβαση στον λογαριασμό πληρωμής");
  }
  return account;
}

async function scopedBatch(tx: Tx, ctx: StockContext, batchId: string) {
  const batch = await tx.payrollPaymentBatch.findFirst({ where: { orgId: ctx.orgId, batchId }, include: batchInclude });
  if (!batch) throw new WorkflowError("Το payroll batch δεν βρέθηκε");
  await assertBatchScope(tx, ctx, batch);
  return batch;
}

export async function exportPayrollPaymentBatch(ctx: StockContext, input: { from: string; to: string; storeId?: string | null; format: "csv" | "json" }) {
  assertPayrollPaymentAccess(ctx);
  const period = payrollMonthPeriod(input.from, input.to);
  await assertStockScope(db, ctx, { storeId: input.storeId ?? undefined });
  const employeeWhere = input.storeId ? { storeId: input.storeId } : ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : ctx.warehouseIds.length ? { warehouseId: { in: [...ctx.warehouseIds] } } : {};
  const [employees, summaries] = await Promise.all([
    db.employee.findMany({ where: { orgId: ctx.orgId, active: true, ...employeeWhere }, include: { pay: true }, orderBy: { id: "asc" } }),
    staffPayrollSummary(ctx, period.fromAt, period.toAt, input.storeId),
  ]);
  const prepared = preparePayrollPaymentBatch({
    orgId: ctx.orgId, from: input.from, to: input.to, storeId: input.storeId,
    employees: employees.map((employee) => ({ orgId: employee.orgId, id: employee.id, name: employee.name, storeId: employee.storeId, active: employee.active, startDate: employee.startDate, endDate: employee.endDate, pay: employee.pay })),
    summaries: summaries.map((row) => ({ orgId: ctx.orgId, employeeId: row.employeeId, minutes: row.minutes, costCents: row.costCents })),
  });
  return stockTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`payroll-batch:${ctx.orgId}:${prepared.batchId}`}, 0))) AS lock`;
    const previous = await tx.payrollPaymentBatch.findUnique({ where: { orgId_batchId: { orgId: ctx.orgId, batchId: prepared.batchId } }, include: batchInclude });
    if (previous) return storedBatch(previous);
    const created = await tx.payrollPaymentBatch.create({ data: {
      orgId: ctx.orgId,
      storeId: input.storeId ?? null,
      batchId: prepared.batchId,
      fromDate: new Date(`${input.from}T00:00:00.000Z`),
      toDate: new Date(`${input.to}T00:00:00.000Z`),
      totalAmountCents: prepared.totals.amountCents,
      readyAmountCents: prepared.totals.readyAmountCents,
      employeeCount: prepared.totals.employees,
      readyCount: prepared.totals.ready,
      reviewCount: prepared.totals.review,
      createdById: ctx.userId,
      createdByName: ctx.userName,
      items: { create: prepared.rows.map((row) => ({
        orgId: ctx.orgId,
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        storeId: row.storeId,
        iban: row.iban,
        amountCents: row.amountCents,
        workedMinutes: row.workedMinutes,
        reviewStatus: row.reviewStatus,
        issues: row.issues,
        executionStatus: "NOT_EXECUTED",
      })) },
    }, include: batchInclude });
    await auditWorkflow(tx, {
      orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "finance.export.payroll_prepare", entityType: "finance_payroll_batch", entityId: prepared.batchId, storeId: input.storeId,
      metadata: { format: input.format, from: input.from, to: input.to, employees: prepared.totals.employees, ready: prepared.totals.ready, review: prepared.totals.review, amountCents: prepared.totals.amountCents, executionStatus: "NOT_EXECUTED", financeTransactionsCreated: 0 },
    });
    return storedBatch(created);
  });
}

export async function getPayrollPaymentBatch(ctx: StockContext, batchId: string) {
  assertPayrollPaymentAccess(ctx);
  const cleanBatchId = cleanText(batchId, "Payroll batch", 64, true)!;
  return storedBatch(await scopedBatch(db, ctx, cleanBatchId));
}

export async function listPayrollPaymentBatches(ctx: StockContext): Promise<PayrollPaymentBatchListItem[]> {
  assertPayrollPaymentAccess(ctx);
  const batches = await db.payrollPaymentBatch.findMany({ where: { orgId: ctx.orgId }, include: batchInclude, orderBy: { createdAt: "desc" }, take: 100 });
  const accessible: PayrollPaymentBatchListItem[] = [];
  for (const batch of batches) {
    try { await assertBatchScope(db, ctx, batch); } catch { continue; }
    const { rows, ...listed } = storedBatch(batch);
    void rows;
    accessible.push({ ...listed, createdAt: batch.createdAt });
  }
  return accessible.slice(0, 50);
}

function executionHash(ctx: StockContext, batch: StoredBatch, accountId: string, provider: string) {
  return createHash("sha256").update(JSON.stringify({ version: 1, orgId: ctx.orgId, batchId: batch.batchId, accountId, amountCents: batch.readyAmountCents, provider })).digest("hex");
}

function providerFailureCode(value: string) {
  return /^[A-Z][A-Z0-9_]{0,60}$/.test(value) ? value : "PROVIDER_REJECTED";
}

function validProviderSuccess(result: Extract<PayrollProviderResult, { status: "SUCCEEDED" }>) {
  return /^[A-Za-z0-9._:-]{1,120}$/.test(result.reference) && !Number.isNaN(result.confirmedAt.getTime());
}

export async function executePayrollPaymentBatch(
  ctx: StockContext,
  input: { batchId: string; accountId: string; clientKey: string; confirmation: string; confirmedAmountCents: number },
  dependencies: { provider?: PayrollPaymentProvider } = {},
): Promise<PayrollExecutionReceipt> {
  assertPayrollPaymentAccess(ctx);
  const clientKey = cleanText(input.clientKey, "Κλειδί εκτέλεσης", 100, true)!;
  if (!/^[-_a-zA-Z0-9]{8,100}$/.test(clientKey)) throw new WorkflowError("Άκυρο κλειδί εκτέλεσης payroll");
  const provider = dependencies.provider ?? resolvePayrollPaymentProvider();
  const started = await stockTransaction(async (tx) => {
    // Ένα lock ανά tenant αποκλείει overlapping batches και διπλοπληρωμή ίδιου εργαζομένου/μήνα.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`payroll-execution:${ctx.orgId}`}, 0))) AS lock`;
    const batch = await scopedBatch(tx, ctx, input.batchId);
    const account = await ownedPayrollAccount(tx, ctx, input.accountId);
    if (batch.reviewCount !== 0 || batch.readyCount !== batch.employeeCount || batch.items.some((item) => item.reviewStatus !== "READY")) throw new WorkflowError("Το batch έχει γραμμές που απαιτούν έλεγχο και δεν μπορεί να εκτελεστεί");
    assertPayrollExecutionConfirmation({ batchId: batch.batchId, confirmation: input.confirmation, amountCents: batch.readyAmountCents, confirmedAmountCents: input.confirmedAmountCents });
    if (account.storeId && batch.storeId && account.storeId !== batch.storeId) throw new WorkflowError("Ο λογαριασμός πληρωμής ανήκει σε άλλο κατάστημα");
    if (account.storeId && batch.items.some((item) => item.storeId !== account.storeId)) throw new WorkflowError("Ο store λογαριασμός δεν καλύπτει όλο το payroll batch");
    const requestHash = executionHash(ctx, batch, account.id, provider.name);
    const previous = await tx.payrollPaymentExecution.findUnique({ where: { orgId_clientKey: { orgId: ctx.orgId, clientKey } }, include: { batch: { include: batchInclude } } });
    if (previous) {
      if (previous.requestHash !== requestHash || previous.batchId !== batch.id) throw new WorkflowError("Το κλειδί εκτέλεσης χρησιμοποιήθηκε με διαφορετικά δεδομένα");
      return { execution: previous, batch: previous.batch, replay: true };
    }
    if (batch.status === "SUCCEEDED") {
      const success = batch.executions.find((execution) => execution.status === "SUCCEEDED");
      if (!success) throw new WorkflowError("Λείπει η επιβεβαίωση της payroll εκτέλεσης");
      return { execution: success, batch, replay: true };
    }
    if (batch.status === "PROCESSING" || batch.status === "UNCERTAIN") throw new WorkflowError("Η payroll κατάσταση απαιτεί συμψηφισμό με τον provider· δεν επιτρέπεται αυτόματο retry");
    const paid = await tx.payrollPaymentItem.findFirst({ where: {
      orgId: ctx.orgId,
      employeeId: { in: batch.items.map((item) => item.employeeId) },
      executionStatus: "SUCCEEDED",
      batch: { fromDate: batch.fromDate, toDate: batch.toDate },
    }, select: { id: true } });
    if (paid) throw new WorkflowError("Υπάρχει ήδη επιτυχημένη payroll πληρωμή για εργαζόμενο αυτού του μήνα");
    const execution = await tx.payrollPaymentExecution.create({ data: {
      orgId: ctx.orgId,
      batchId: batch.id,
      accountId: account.id,
      storeId: account.storeId ?? batch.storeId,
      clientKey,
      requestHash,
      status: "PROCESSING",
      provider: provider.name,
      createdById: ctx.userId,
      createdByName: ctx.userName,
    } });
    await tx.payrollPaymentBatch.update({ where: { id: batch.id }, data: { status: "PROCESSING" } });
    await auditWorkflow(tx, {
      orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "finance.payroll.execution_started", entityType: "finance_payroll_execution", entityId: execution.id, storeId: execution.storeId,
      metadata: { batchId: batch.batchId, accountId: account.id, provider: provider.name, employees: batch.readyCount, amountCents: batch.readyAmountCents },
    });
    return { execution, batch, replay: false };
  });
  if (started.replay) return executionReceipt(started.execution, started.batch);

  let result: PayrollProviderResult;
  try {
    result = await provider.execute({
      executionId: started.execution.id,
      batchId: started.batch.batchId,
      from: started.batch.fromDate.toISOString().slice(0, 10),
      to: started.batch.toDate.toISOString().slice(0, 10),
      amountCents: started.batch.readyAmountCents,
      payments: started.batch.items.map((item) => ({ employeeId: item.employeeId, employeeName: item.employeeName, storeId: item.storeId, iban: item.iban, amountCents: item.amountCents })),
    });
  } catch {
    result = { status: "UNCERTAIN", code: "PROVIDER_UNCERTAIN" };
  }
  if (result.status === "SUCCEEDED" && !validProviderSuccess(result)) result = { status: "UNCERTAIN", code: "PROVIDER_UNCERTAIN" };

  return stockTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`payroll-execution:${ctx.orgId}`}, 0))) AS lock`;
    const execution = await tx.payrollPaymentExecution.findFirst({ where: { id: started.execution.id, orgId: ctx.orgId }, include: { batch: { include: batchInclude }, account: true } });
    if (!execution) throw new WorkflowError("Η payroll εκτέλεση δεν βρέθηκε");
    if (execution.status !== "PROCESSING") return executionReceipt(execution, execution.batch);
    const { batch, account } = execution;
    const storeId = account.storeId ?? batch.storeId ?? (batch.items.length && batch.items.every((item) => item.storeId === batch.items[0].storeId) ? batch.items[0].storeId : null);
    if (result.status === "SUCCEEDED") {
      // Ledger, success και audit δεσμεύονται ατομικά ΜΟΝΟ μετά από επιβεβαιωμένη επιτυχία provider.
      await tx.financeTransaction.create({ data: {
        orgId: ctx.orgId,
        accountId: account.id,
        storeId,
        amountCents: -batch.readyAmountCents,
        kind: "payroll_payment",
        referenceType: "payroll_payment_execution",
        referenceId: execution.id,
        occurredAt: result.confirmedAt,
        note: `Μισθοδοσία ${batch.fromDate.toISOString().slice(0, 7)}`,
        createdByName: ctx.userName,
      } });
      await tx.payrollPaymentExecution.update({ where: { id: execution.id }, data: { status: "SUCCEEDED", providerReference: result.reference, confirmedAt: result.confirmedAt, failureCode: null } });
      await tx.payrollPaymentBatch.update({ where: { id: batch.id }, data: { status: "SUCCEEDED" } });
      await tx.payrollPaymentItem.updateMany({ where: { orgId: ctx.orgId, batchId: batch.id }, data: { executionStatus: "SUCCEEDED" } });
      await auditWorkflow(tx, {
        orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "finance.payroll.execution_succeeded", entityType: "finance_payroll_execution", entityId: execution.id, storeId,
        metadata: { batchId: batch.batchId, accountId: account.id, provider: execution.provider, providerReference: result.reference, amountCents: batch.readyAmountCents, financeTransactionsCreated: 1 },
      });
      return executionReceipt({ ...execution, status: "SUCCEEDED", providerReference: result.reference, failureCode: null }, batch);
    }
    const uncertain = result.status === "UNCERTAIN";
    const status = uncertain ? "UNCERTAIN" : "FAILED";
    const failureCode = uncertain ? "PROVIDER_UNCERTAIN" : providerFailureCode(result.code);
    await tx.payrollPaymentExecution.update({ where: { id: execution.id }, data: { status, failureCode } });
    await tx.payrollPaymentBatch.update({ where: { id: batch.id }, data: { status } });
    await auditWorkflow(tx, {
      orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: uncertain ? "finance.payroll.execution_uncertain" : "finance.payroll.execution_failed", entityType: "finance_payroll_execution", entityId: execution.id, storeId,
      metadata: { batchId: batch.batchId, accountId: account.id, provider: execution.provider, failureCode, financeTransactionsCreated: 0 },
    });
    return executionReceipt({ ...execution, status, failureCode }, batch);
  });
}
