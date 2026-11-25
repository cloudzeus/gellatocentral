// Προετοιμασία μισθοδοσίας· η εκτέλεση απαιτεί finance.export + staff.pay και ρητή επιβεβαίωση.
import { createHash } from "node:crypto";
import { csvCell } from "./accountant-export.ts";
import { reportPeriod, type ReportPeriod } from "./reports.ts";

export type PayrollEmployeeSource = {
  orgId: string;
  id: string;
  name: string;
  storeId: string | null;
  active: boolean;
  startDate: Date | null;
  endDate: Date | null;
  pay: { payType: string; monthlySalaryCents: number; iban: string | null } | null;
};
export type PayrollSummarySource = { orgId: string; employeeId: string; minutes: number; costCents: number };
export type PayrollExecutionStatus = "NOT_EXECUTED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";
export type PayrollPaymentRow = {
  employeeId: string;
  employeeName: string;
  storeId: string | null;
  iban: string;
  amountCents: number;
  workedMinutes: number;
  reviewStatus: "READY" | "REVIEW";
  issues: string[];
  executionStatus: "NOT_EXECUTED" | "SUCCEEDED";
};
export type PayrollPaymentBatch = {
  version: 1;
  batchId: string;
  kind: "PAYROLL_PAYMENT_PREPARATION";
  filters: { orgId: string; from: string; to: string; storeId: string | null };
  execution: { status: PayrollExecutionStatus; provider: string | null; financeTransactionsCreated: 0 | 1 };
  rows: PayrollPaymentRow[];
  totals: { employees: number; ready: number; review: number; amountCents: number; readyAmountCents: number };
};
export type PayrollPaymentBatchListItem = Omit<PayrollPaymentBatch, "rows"> & { createdAt: Date };
export type PayrollExecutionReceipt = {
  executionId: string;
  batchId: string;
  status: Exclude<PayrollExecutionStatus, "NOT_EXECUTED">;
  provider: string;
  providerReference: string | null;
  failureCode: string | null;
  amountCents: number;
  financeTransactionsCreated: 0 | 1;
};

export function assertPayrollPaymentAccess(ctx: { can: (permission: "staff.pay" | "finance.export") => boolean }) {
  if (!ctx.can("finance.export") || !ctx.can("staff.pay")) throw new Error("Η payroll ενέργεια απαιτεί δικαιώματα finance.export και staff.pay");
}

export function payrollMonthPeriod(from: string, to: string): ReportPeriod {
  // 32 ημέρες ως τεχνικό όριο για την επιπλέον ώρα DST· το πλήρες ημερολογιακό μήνα ελέγχεται παρακάτω.
  const period = reportPeriod(from, to, 32);
  const start = new Date(`${from}T00:00:00.000Z`), end = new Date(`${to}T00:00:00.000Z`);
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  if (start.getUTCDate() !== 1 || end.getTime() !== last.getTime()) throw new Error("Η payroll περίοδος πρέπει να είναι πλήρης ημερολογιακός μήνας");
  return period;
}

function validAmount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Άκυρο ποσό payroll");
  return value;
}
function validIban(value: string | null) {
  const iban = value?.replace(/\s/g, "").toUpperCase() ?? "";
  return /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban) ? iban : "";
}
function dateOnly(value: Date) { return value.toISOString().slice(0, 10); }

export function preparePayrollPaymentBatch(input: {
  orgId: string;
  from: string;
  to: string;
  storeId?: string | null;
  employees: readonly PayrollEmployeeSource[];
  summaries: readonly PayrollSummarySource[];
}): PayrollPaymentBatch {
  payrollMonthPeriod(input.from, input.to);
  const summaries = new Map<string, PayrollSummarySource>();
  for (const summary of input.summaries) {
    if (summary.orgId !== input.orgId) continue;
    if (summaries.has(summary.employeeId)) throw new Error("Διπλή payroll σύνοψη εργαζομένου");
    summaries.set(summary.employeeId, { ...summary, minutes: validAmount(summary.minutes), costCents: validAmount(summary.costCents) });
  }
  const employeeIds = new Set<string>();
  const rows = input.employees.filter((employee) => employee.orgId === input.orgId && employee.active && (!input.storeId || employee.storeId === input.storeId)).flatMap((employee): PayrollPaymentRow[] => {
    if (employeeIds.has(employee.id)) throw new Error("Διπλός εργαζόμενος payroll");
    employeeIds.add(employee.id);
    const summary = summaries.get(employee.id);
    const monthly = employee.pay?.payType === "MONTHLY";
    if (!employee.pay || (!monthly && !summary)) return [];
    const issues: string[] = [];
    const iban = validIban(employee.pay.iban);
    if (!iban) issues.push("MISSING_OR_INVALID_IBAN");
    let amountCents = monthly ? validAmount(employee.pay.monthlySalaryCents) : validAmount(summary?.costCents ?? 0);
    if (monthly && ((employee.startDate && dateOnly(employee.startDate) > input.from) || (employee.endDate && dateOnly(employee.endDate) < input.to))) {
      issues.push("PARTIAL_MONTH_REQUIRES_REVIEW");
      amountCents = 0;
    }
    if (amountCents <= 0) issues.push("ZERO_OR_MISSING_AMOUNT");
    return [{ employeeId: employee.id, employeeName: employee.name, storeId: employee.storeId, iban, amountCents, workedMinutes: summary?.minutes ?? 0, reviewStatus: issues.length ? "REVIEW" : "READY", issues, executionStatus: "NOT_EXECUTED" }];
  });
  const ibanRows = new Map<string, PayrollPaymentRow[]>();
  for (const row of rows) if (row.iban) ibanRows.set(row.iban, [...(ibanRows.get(row.iban) ?? []), row]);
  for (const duplicates of ibanRows.values()) if (duplicates.length > 1) for (const row of duplicates) {
    row.reviewStatus = "REVIEW";
    if (!row.issues.includes("DUPLICATE_IBAN")) row.issues.push("DUPLICATE_IBAN");
  }
  rows.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  const totals = {
    employees: rows.length,
    ready: rows.filter((row) => row.reviewStatus === "READY").length,
    review: rows.filter((row) => row.reviewStatus === "REVIEW").length,
    amountCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    readyAmountCents: rows.filter((row) => row.reviewStatus === "READY").reduce((sum, row) => sum + row.amountCents, 0),
  };
  validAmount(totals.amountCents); validAmount(totals.readyAmountCents);
  const batchId = createHash("sha256").update(JSON.stringify({ version: 1, orgId: input.orgId, from: input.from, to: input.to, storeId: input.storeId ?? null, rows })).digest("hex");
  return {
    version: 1, batchId, kind: "PAYROLL_PAYMENT_PREPARATION", filters: { orgId: input.orgId, from: input.from, to: input.to, storeId: input.storeId ?? null },
    execution: { status: "NOT_EXECUTED", provider: null, financeTransactionsCreated: 0 }, rows, totals,
  };
}

export function payrollConfirmationPhrase(batchId: string) {
  return `PAYROLL:${batchId}`;
}

export function assertPayrollExecutionConfirmation(input: { batchId: string; confirmation: string; amountCents: number; confirmedAmountCents: number }) {
  if (input.confirmation !== payrollConfirmationPhrase(input.batchId)) throw new Error("Η εκτέλεση απαιτεί το ακριβές κείμενο επιβεβαίωσης του batch");
  if (!Number.isSafeInteger(input.confirmedAmountCents) || input.confirmedAmountCents !== input.amountCents || input.amountCents <= 0) throw new Error("Το επιβεβαιωμένο ποσό payroll δεν συμφωνεί με το batch");
}

export function payrollPaymentsCsv(batch: PayrollPaymentBatch) {
  const header = ["employee_id", "employee_name", "store_id", "iban", "amount_cents", "worked_minutes", "review_status", "issues", "execution_status"];
  const rows = batch.rows.map((row) => [row.employeeId, row.employeeName, row.storeId, row.iban, row.amountCents, row.workedMinutes, row.reviewStatus, row.issues.join("|"), row.executionStatus]);
  return `\uFEFF${[header, ...rows].map((row) => row.map((value) => csvCell(value)).join(";")).join("\r\n")}\r\n`;
}
