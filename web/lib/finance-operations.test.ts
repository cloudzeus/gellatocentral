import assert from "node:assert/strict";
import { test } from "node:test";
import { accountantCsv, buildAccountantPackage, type AccountantEntry } from "./accountant-export.ts";
import { moduleOfPermission } from "./modules.ts";
import { parseBankStatement, reviewBankStatementRows, type BankStatementRow, type LedgerCandidate } from "./finance-reconciliation.ts";
import { assertPayrollPaymentAccess, payrollMonthPeriod, payrollPaymentsCsv, preparePayrollPaymentBatch, type PayrollEmployeeSource } from "./payroll-payments.ts";
import { normalize } from "./permissions.ts";

const statementRow = (overrides: Partial<BankStatementRow> = {}): BankStatementRow => ({ line: 2, externalId: "bank-1", reference: "REF-1", description: "settlement", bookedAt: new Date("2026-11-03T00:00:00.000Z"), amountCents: 10000, ...overrides });
const ledgerRow = (overrides: Partial<LedgerCandidate> = {}): LedgerCandidate => ({ id: "ledger-1", orgId: "org-a", accountId: "account-a", storeId: "store-a", amountCents: 10000, occurredAt: new Date("2026-11-03T12:00:00.000Z"), referenceId: "bank-1", ...overrides });
const reviewInput = (statement: BankStatementRow[], ledger: LedgerCandidate[] = []) => ({ orgId: "org-a", accountId: "account-a", storeId: "store-a", from: "2026-11-01", to: "2026-11-30", statement, ledger });

test("bank statement: ελληνικό CSV, quotes, ημερομηνία και ποσό σε λεπτά", () => {
  const rows = parseBankStatement('Ημερομηνία;Ποσό;Αναφορά;Περιγραφή\r\n03/11/2026;"1.234,56";"REF ""Α""";"Viva; settlement"\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountCents, 123456);
  assert.equal(rows[0].reference, 'REF "Α"');
  assert.equal(rows[0].description, "Viva; settlement");
  assert.equal(rows[0].bookedAt.toISOString(), "2026-11-03T00:00:00.000Z");
});

test("bank matching: tenant/account isolation και καμία νέα χρηματοοικονομική κίνηση", () => {
  const result = reviewBankStatementRows(reviewInput([statementRow()], [ledgerRow({ id: "foreign", orgId: "org-b" })]));
  assert.equal(result.rows[0].status, "UNMATCHED");
  assert.equal(result.movementsCreated, 0);
  assert.equal(result.persistence, "STATELESS");
  assert.equal(result.rows[0].matchedTransactionId, null);
});

test("bank matching: duplicate statement IDs και διπλή χρήση ledger γίνονται conflicts", () => {
  const duplicate = reviewBankStatementRows(reviewInput([statementRow(), statementRow({ line: 3 })], [ledgerRow()]));
  assert.deepEqual(duplicate.rows.map((row) => row.status), ["CONFLICT", "CONFLICT"]);
  assert.ok(duplicate.rows.every((row) => row.reasons.includes("DUPLICATE_STATEMENT_ROW")));
  const allocatedTwice = reviewBankStatementRows(reviewInput([
    statementRow({ externalId: null, reference: "a" }),
    statementRow({ line: 3, externalId: null, reference: "b", description: "other" }),
  ], [ledgerRow({ referenceId: null })]));
  assert.ok(allocatedTwice.rows.every((row) => row.status === "CONFLICT" && row.reasons.includes("LEDGER_TRANSACTION_MATCHED_MORE_THAN_ONCE")));
});

test("bank matching: amount/date candidates δεν επιλέγουν τυχαία διφορούμενο", () => {
  const result = reviewBankStatementRows(reviewInput([statementRow({ externalId: null, reference: null })], [ledgerRow({ id: "one", referenceId: null }), ledgerRow({ id: "two", referenceId: null })]));
  assert.equal(result.rows[0].status, "AMBIGUOUS");
  assert.deepEqual(result.rows[0].candidateTransactionIds, ["one", "two"]);
});

test("bank matching: ίδιο reference με διαφορετικό ποσό είναι conflict", () => {
  const result = reviewBankStatementRows(reviewInput([statementRow({ amountCents: 9999 })], [ledgerRow()]));
  assert.equal(result.rows[0].status, "CONFLICT");
  assert.deepEqual(result.rows[0].reasons, ["AMOUNT_DIFFERS_FROM_LEDGER"]);
});

test("Viva settlement: είναι μόνο πρόταση και δεν υπερισχύει υπάρχουσας ledger κίνησης", () => {
  const vivaPayments = [{ orgId: "org-a", storeId: "store-a", issuedAt: new Date("2026-11-02T12:00:00.000Z"), amountCents: 6000 }, { orgId: "org-a", storeId: "store-a", issuedAt: new Date("2026-11-02T13:00:00.000Z"), amountCents: 4000 }, { orgId: "org-b", storeId: "store-a", issuedAt: new Date("2026-11-02T12:00:00.000Z"), amountCents: 10000 }];
  const suggestion = reviewBankStatementRows({ ...reviewInput([statementRow({ externalId: null, reference: null })]), vivaPayments });
  assert.equal(suggestion.rows[0].status, "UNMATCHED");
  assert.equal(suggestion.rows[0].suggestedKind, "viva_settlement");
  assert.equal(suggestion.rows[0].vivaCandidates[0].paymentCount, 2);
  assert.equal(suggestion.movementsCreated, 0);
  const net = reviewBankStatementRows({ ...reviewInput([statementRow({ externalId: null, reference: null, amountCents: 9500 })]), vivaPayments, vivaCommissions: [{ orgId: "org-a", storeId: "store-a", businessDate: "2026-11-02", commissionCents: 500 }] });
  assert.equal(net.rows[0].suggestedKind, "viva_settlement");
  assert.equal(net.rows[0].vivaCandidates[0].grossAmountCents, 10000);
  assert.equal(net.rows[0].vivaCandidates[0].amountCents, 9500);
  const existing = reviewBankStatementRows({ ...reviewInput([statementRow()], [ledgerRow()]), vivaPayments });
  assert.equal(existing.rows[0].status, "MATCHED");
  assert.equal(existing.rows[0].suggestedKind, null);
});

test("bank review: γραμμή εκτός περιόδου δεν καταχωρείται ως matched", () => {
  const result = reviewBankStatementRows(reviewInput([statementRow({ bookedAt: new Date("2026-12-01T00:00:00.000Z") })], [ledgerRow({ occurredAt: new Date("2026-12-01T00:00:00.000Z") })]));
  assert.equal(result.rows[0].status, "CONFLICT");
  assert.deepEqual(result.rows[0].reasons, ["OUTSIDE_REVIEW_PERIOD"]);
});

const entry = (overrides: Partial<AccountantEntry> = {}): AccountantEntry => ({ id: "entry-1", orgId: "org-a", type: "SALES_DOCUMENT", status: "ISSUED", documentKind: "1.1", storeId: "store-a", occurredAt: new Date("2026-11-15T12:00:00.000Z"), number: "A-1", counterparty: "Πελάτης", netCents: 1000, vatCents: 240, totalCents: 1240, reference: null, ...overrides });
const exportInput = (entries: AccountantEntry[], allocations: { id: string; orgId: string; paymentId: string; purchaseDocId: string; amountCents: number }[] = []) => ({ orgId: "org-a", from: "2026-11-01", to: "2026-11-30", fromAt: new Date("2026-10-31T22:00:00.000Z"), toAt: new Date("2026-11-30T22:00:00.000Z"), storeId: "store-a", entries, allocations });

test("accountant export: tenant/store/period και μόνο νόμιμες εγγραφές", () => {
  const result = buildAccountantPackage(exportInput([
    entry(),
    entry({ id: "foreign", orgId: "org-b" }),
    entry({ id: "other-store", storeId: "store-b" }),
    entry({ id: "outside", occurredAt: new Date("2026-12-01T12:00:00.000Z") }),
    entry({ id: "cancelled", status: "CANCELLED" }),
    entry({ id: "delivery-note", status: "ISSUED", documentKind: "2.1" }),
    entry({ id: "draft-purchase", type: "PURCHASE", status: "DRAFT", documentKind: "INVOICE" }),
    entry({ id: "unsigned-pos", type: "POS_SALE", status: "COMPLETED", fiscalSigned: false }),
    entry({ id: "informal", type: "EXPENSE", status: "RECORDED", informal: true }),
  ]));
  assert.deepEqual(result.entries.map((row) => row.id), ["entry-1"]);
  assert.equal(result.formalOnly, true);
  assert.equal(result.includesPayroll, false);
});

test("accountant export: allocations μόνο προς scoped payment, χωρίς ξένο tenant", () => {
  const payment = entry({ id: "payment-a", type: "SUPPLIER_PAYMENT", status: "RECORDED", totalCents: 5000 });
  const result = buildAccountantPackage(exportInput([payment], [
    { id: "allocation-a", orgId: "org-a", paymentId: "payment-a", purchaseDocId: "purchase-a", amountCents: 3000 },
    { id: "foreign", orgId: "org-b", paymentId: "payment-a", purchaseDocId: "purchase-b", amountCents: 2000 },
    { id: "orphan", orgId: "org-a", paymentId: "excluded-payment", purchaseDocId: "purchase-a", amountCents: 2000 },
  ]));
  assert.deepEqual(result.supplierPaymentAllocations.map((row) => row.id), ["allocation-a"]);
  assert.equal(result.totals.allocations, 1);
  const csv = accountantCsv(result);
  assert.ok(csv.includes("purchase-a"));
  assert.ok(!csv.includes("purchase-b"));
});

test("accountant CSV: deterministic πακέτο και spreadsheet formula protection", () => {
  const input = exportInput([entry({ counterparty: "=HYPERLINK(\"bad\")" })]);
  const first = buildAccountantPackage(input), second = buildAccountantPackage(input);
  assert.equal(first.packageId, second.packageId);
  assert.ok(accountantCsv(first).includes("'=HYPERLINK"));
});

const employee = (overrides: Partial<PayrollEmployeeSource> = {}): PayrollEmployeeSource => ({ orgId: "org-a", id: "employee-a", name: "Εργαζόμενος Α", storeId: "store-a", active: true, startDate: null, endDate: null, pay: { payType: "HOURLY", monthlySalaryCents: 0, iban: "GR1601101250000000012300695" }, ...overrides });

test("payroll privacy: απαιτούνται και finance.export και staff.pay πριν από pay/IBAN", () => {
  const can = (permissions: string[]) => (permission: "staff.pay" | "finance.export") => permissions.includes(permission);
  assert.doesNotThrow(() => assertPayrollPaymentAccess({ can: can(["finance.export", "staff.pay"]) }));
  assert.throws(() => assertPayrollPaymentAccess({ can: can(["finance.export"]) }), /staff.pay/);
  assert.throws(() => assertPayrollPaymentAccess({ can: can(["staff.pay"]) }), /finance.export/);
  assert.ok(normalize(["finance.export"]).includes("finance.read"));
  assert.equal(moduleOfPermission("finance.export"), "finance");
});

test("payroll preparation: tenant/store isolation, hourly + monthly και NOT_EXECUTED", () => {
  const batch = preparePayrollPaymentBatch({
    orgId: "org-a", from: "2026-11-01", to: "2026-11-30", storeId: "store-a",
    employees: [employee(), employee({ id: "employee-b", name: "Εργαζόμενος Β", pay: { payType: "MONTHLY", monthlySalaryCents: 100000, iban: "GR9601101250000000012300696" } }), employee({ id: "foreign", orgId: "org-b" }), employee({ id: "other-store", storeId: "store-b" })],
    summaries: [{ orgId: "org-a", employeeId: "employee-a", minutes: 480, costCents: 6000 }, { orgId: "org-b", employeeId: "employee-b", minutes: 999, costCents: 999999 }],
  });
  assert.deepEqual(batch.rows.map((row) => [row.employeeId, row.amountCents, row.reviewStatus]), [["employee-a", 6000, "READY"], ["employee-b", 100000, "READY"]]);
  assert.equal(batch.totals.readyAmountCents, 106000);
  assert.equal(batch.execution.status, "NOT_EXECUTED");
  assert.equal(batch.execution.provider, null);
  assert.equal(batch.execution.financeTransactionsCreated, 0);
  assert.ok(payrollPaymentsCsv(batch).includes("NOT_EXECUTED"));
});

test("payroll preparation: duplicate IBAN και μερικός μήνας απαιτούν review", () => {
  const duplicate = preparePayrollPaymentBatch({ orgId: "org-a", from: "2026-11-01", to: "2026-11-30", employees: [employee(), employee({ id: "employee-b" })], summaries: [{ orgId: "org-a", employeeId: "employee-a", minutes: 60, costCents: 1000 }, { orgId: "org-a", employeeId: "employee-b", minutes: 60, costCents: 1000 }] });
  assert.ok(duplicate.rows.every((row) => row.reviewStatus === "REVIEW" && row.issues.includes("DUPLICATE_IBAN")));
  const partial = preparePayrollPaymentBatch({ orgId: "org-a", from: "2026-11-01", to: "2026-11-30", employees: [employee({ pay: { payType: "MONTHLY", monthlySalaryCents: 100000, iban: "GR1601101250000000012300695" }, startDate: new Date("2026-11-15T00:00:00.000Z") })], summaries: [] });
  assert.equal(partial.rows[0].amountCents, 0);
  assert.ok(partial.rows[0].issues.includes("PARTIAL_MONTH_REQUIRES_REVIEW"));
  assert.equal(partial.totals.readyAmountCents, 0);
});

test("payroll period: πλήρης μήνας με DST, όχι τμηματική περίοδος", () => {
  assert.doesNotThrow(() => payrollMonthPeriod("2026-10-01", "2026-10-31"));
  assert.throws(() => payrollMonthPeriod("2026-11-01", "2026-11-15"), /πλήρης/);
});
