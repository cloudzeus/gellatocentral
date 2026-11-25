import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { getAccountStatementReview, listAccountStatementReviews, reviewAccountStatement } from "./finance-reconciliation-db.ts";
import { executePayrollPaymentBatch, exportPayrollPaymentBatch, getPayrollPaymentBatch, listPayrollPaymentBatches } from "./payroll-payments-db.ts";
import type { PayrollPaymentProvider } from "./payroll-payment-providers.ts";
import { payrollConfirmationPhrase } from "./payroll-payments.ts";
import type { Permission } from "./permissions.ts";
import type { StockContext } from "./stock-scope.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const IBAN = "GR1601101250000000012300695";

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `FIN persisted ${suffix}`, vatNumber: `TEST-${suffix}` } });
  const foreign = await db.organization.create({ data: { name: `FIN persisted foreign ${suffix}`, vatNumber: `FOREIGN-${suffix}` } });
  const user = await db.user.create({ data: { email: `finance-persisted-${suffix}@example.test`, name: "FIN persisted" } });
  const role = await db.orgRole.create({ data: { orgId: org.id, name: "FIN persisted", permissions: ["finance.read", "finance.export", "staff.pay"] } });
  const membership = await db.membership.create({ data: { orgId: org.id, userId: user.id, roleId: role.id } });
  const store = await db.store.create({ data: { orgId: org.id, name: "FIN persisted store" } });
  const account = await db.financeAccount.create({ data: { orgId: org.id, storeId: store.id, name: "FIN persisted bank", kind: "bank", openingAt: new Date("2026-01-01T00:00:00.000Z") } });
  const employee = await db.employee.create({ data: {
    orgId: org.id, storeId: store.id, name: "Persisted Εργαζόμενος", active: true,
    pay: { create: { orgId: org.id, payType: "MONTHLY", monthlySalaryCents: 100000, iban: IBAN } },
  } });
  return { orgId: org.id, foreignOrgId: foreign.id, userId: user.id, membershipId: membership.id, storeId: store.id, accountId: account.id, employeeId: employee.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture, orgId = f.orgId): StockContext {
  const permissions: Permission[] = ["finance.read", "finance.export", "staff.pay"];
  return { orgId, userId: f.userId, membershipId: f.membershipId, userName: "FIN persisted", permissions, storeIds: [], warehouseIds: [], can: (permission) => permissions.includes(permission) };
}
function provider(execute: PayrollPaymentProvider["execute"]): PayrollPaymentProvider {
  return { name: "GENERIC_HTTPS", execute };
}

test("PostgreSQL FIN persisted: idempotent statements και ασφαλής payroll state machine", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  try {
    const ledger = await db.financeTransaction.create({ data: {
      orgId: f.orgId, accountId: f.accountId, storeId: f.storeId, amountCents: 10000, kind: "bank_receipt", referenceType: "bank_external", referenceId: "BANK-1", occurredAt: new Date("2026-11-03T12:00:00.000Z"), createdByName: "FIN persisted",
    } });
    const statement = { accountId: f.accountId, from: "2026-11-01", to: "2026-11-30", sourceName: "november.csv", csv: "Date;Amount;ExternalId;Reference\n03/11/2026;100,00;BANK-1;Settlement\n" };
    const first = await reviewAccountStatement(ctx, statement);
    const replay = await reviewAccountStatement(ctx, statement);
    assert.equal(first.persistence, "PERSISTED");
    assert.equal(first.importId, replay.importId);
    assert.equal(first.rows[0].matchedTransactionId, ledger.id);
    assert.equal(await db.financeStatementImport.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.financeStatementRow.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.financeTransaction.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "finance.reconciliation.review" } }), 1);
    assert.equal((await listAccountStatementReviews(ctx))[0].reviewId, first.reviewId);
    assert.equal((await getAccountStatementReview(ctx, { accountId: f.accountId, reviewId: first.reviewId })).rows[0].status, "MATCHED");
    await assert.rejects(reviewAccountStatement(context(f, f.foreignOrgId), statement), /δεν βρέθηκε/);
    assert.deepEqual(await listAccountStatementReviews(context(f, f.foreignOrgId)), []);

    const november = await exportPayrollPaymentBatch(ctx, { from: "2026-11-01", to: "2026-11-30", storeId: f.storeId, format: "json" });
    const novemberReplay = await exportPayrollPaymentBatch(ctx, { from: "2026-11-01", to: "2026-11-30", storeId: f.storeId, format: "json" });
    assert.equal(november.batchId, novemberReplay.batchId);
    assert.equal(november.execution.status, "NOT_EXECUTED");
    assert.equal(november.rows[0].amountCents, 100000);
    assert.equal(await db.payrollPaymentBatch.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "finance.export.payroll_prepare" } }), 1);
    assert.equal((await getPayrollPaymentBatch(ctx, november.batchId)).rows[0].iban, IBAN);
    assert.equal((await listPayrollPaymentBatches(ctx))[0].batchId, november.batchId);
    await assert.rejects(getPayrollPaymentBatch(context(f, f.foreignOrgId), november.batchId), /δεν βρέθηκε/);
    const noPay = { ...ctx, permissions: ["finance.read", "finance.export"] as Permission[], can: (permission: Permission) => permission !== "staff.pay" };
    await assert.rejects(getPayrollPaymentBatch(noPay, november.batchId), /staff.pay/);

    let successCalls = 0;
    const successProvider = provider(async (request) => {
      successCalls += 1;
      assert.equal(request.payments[0].employeeId, f.employeeId);
      assert.equal(request.amountCents, request.payments.reduce((sum, payment) => sum + payment.amountCents, 0));
      return { status: "SUCCEEDED", reference: "provider-success-1", confirmedAt: new Date("2026-11-25T10:00:00.000Z") };
    });
    const executionInput = { batchId: november.batchId, accountId: f.accountId, clientKey: randomUUID(), confirmation: payrollConfirmationPhrase(november.batchId), confirmedAmountCents: 100000 };
    await assert.rejects(executePayrollPaymentBatch(ctx, { ...executionInput, confirmation: "yes" }, { provider: successProvider }), /επιβεβαίωσης/);
    assert.equal(successCalls, 0);
    const succeeded = await executePayrollPaymentBatch(ctx, executionInput, { provider: successProvider });
    assert.equal(succeeded.status, "SUCCEEDED");
    assert.equal(succeeded.financeTransactionsCreated, 1);
    const replayed = await executePayrollPaymentBatch(ctx, executionInput, { provider: provider(async () => { throw new Error("Το replay δεν πρέπει να καλέσει provider"); }) });
    assert.equal(replayed.executionId, succeeded.executionId);
    assert.equal(successCalls, 1);
    const payrollLedger = await db.financeTransaction.findFirstOrThrow({ where: { orgId: f.orgId, referenceType: "payroll_payment_execution", referenceId: succeeded.executionId } });
    assert.equal(payrollLedger.amountCents, -100000);
    assert.equal(payrollLedger.accountId, f.accountId);
    assert.equal((await getPayrollPaymentBatch(ctx, november.batchId)).rows[0].executionStatus, "SUCCEEDED");
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "finance.payroll.execution_succeeded" } }), 1);

    await db.employeePay.update({ where: { employeeId: f.employeeId }, data: { monthlySalaryCents: 100100 } });
    const changed = await exportPayrollPaymentBatch(ctx, { from: "2026-11-01", to: "2026-11-30", storeId: f.storeId, format: "json" });
    assert.notEqual(changed.batchId, november.batchId);
    await assert.rejects(executePayrollPaymentBatch(ctx, { batchId: changed.batchId, accountId: f.accountId, clientKey: randomUUID(), confirmation: payrollConfirmationPhrase(changed.batchId), confirmedAmountCents: 100100 }, { provider: successProvider }), /ήδη επιτυχημένη/);
    assert.equal(successCalls, 1);

    const october = await exportPayrollPaymentBatch(ctx, { from: "2026-10-01", to: "2026-10-31", storeId: f.storeId, format: "json" });
    let failedCalls = 0;
    const failedProvider = provider(async () => { failedCalls += 1; return { status: "FAILED", code: "REJECTED" }; });
    const failedInput = { batchId: october.batchId, accountId: f.accountId, clientKey: randomUUID(), confirmation: payrollConfirmationPhrase(october.batchId), confirmedAmountCents: 100100 };
    const failed = await executePayrollPaymentBatch(ctx, failedInput, { provider: failedProvider });
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.financeTransactionsCreated, 0);
    assert.equal(await db.financeTransaction.count({ where: { orgId: f.orgId, referenceType: "payroll_payment_execution", referenceId: failed.executionId } }), 0);
    assert.equal((await executePayrollPaymentBatch(ctx, failedInput, { provider: failedProvider })).status, "FAILED");
    assert.equal(failedCalls, 1);
    const recovered = await executePayrollPaymentBatch(ctx, { ...failedInput, clientKey: randomUUID() }, { provider: successProvider });
    assert.equal(recovered.status, "SUCCEEDED");
    assert.equal(successCalls, 2);

    const september = await exportPayrollPaymentBatch(ctx, { from: "2026-09-01", to: "2026-09-30", storeId: f.storeId, format: "json" });
    const uncertainInput = { batchId: september.batchId, accountId: f.accountId, clientKey: randomUUID(), confirmation: payrollConfirmationPhrase(september.batchId), confirmedAmountCents: 100100 };
    const uncertain = await executePayrollPaymentBatch(ctx, uncertainInput, { provider: provider(async () => { throw new Error("timeout with private IBAN"); }) });
    assert.equal(uncertain.status, "UNCERTAIN");
    assert.equal(uncertain.failureCode, "PROVIDER_UNCERTAIN");
    assert.equal(await db.financeTransaction.count({ where: { orgId: f.orgId, referenceType: "payroll_payment_execution", referenceId: uncertain.executionId } }), 0);
    await assert.rejects(executePayrollPaymentBatch(ctx, { ...uncertainInput, clientKey: randomUUID() }, { provider: successProvider }), /απαιτεί συμψηφισμό/);
    assert.equal(successCalls, 2);
    assert.equal((await executePayrollPaymentBatch(ctx, uncertainInput, { provider: successProvider })).status, "UNCERTAIN");
    assert.equal(successCalls, 2);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [f.orgId, f.foreignOrgId] } } });
    await db.user.deleteMany({ where: { id: f.userId } });
  }
});
