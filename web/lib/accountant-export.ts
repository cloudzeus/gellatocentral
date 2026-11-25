// Καθαρό accountant πακέτο: formal εγγραφές, σταθερό CSV και αποκλεισμός ξένου tenant/store/period.
import { createHash } from "node:crypto";

export type AccountantEntryType = "POS_SALE" | "SALES_DOCUMENT" | "PURCHASE" | "EXPENSE" | "SUPPLIER_PAYMENT";
export type AccountantEntry = {
  id: string;
  orgId: string;
  type: AccountantEntryType;
  status: string;
  storeId: string | null;
  occurredAt: Date;
  number: string | null;
  counterparty: string | null;
  netCents: number;
  vatCents: number;
  totalCents: number;
  reference: string | null;
  informal?: boolean;
  documentKind?: string;
  fiscalSigned?: boolean;
};
export type AccountantAllocation = {
  id: string;
  orgId: string;
  paymentId: string;
  purchaseDocId: string;
  amountCents: number;
};
export type AccountantPackage = {
  version: 1;
  packageId: string;
  filters: { orgId: string; from: string; to: string; storeId: string | null };
  formalOnly: true;
  includesPayroll: false;
  entries: AccountantEntry[];
  supplierPaymentAllocations: AccountantAllocation[];
  totals: { netCents: number; vatCents: number; totalCents: number; entries: number; allocations: number };
};

function validCents(value: number) {
  if (!Number.isSafeInteger(value)) throw new Error("Μη έγκυρο ποσό accountant export");
  return value;
}
function legalEntry(entry: AccountantEntry) {
  if (entry.informal) return false;
  if (entry.type === "POS_SALE") return entry.status === "COMPLETED" && entry.fiscalSigned === true;
  if (entry.type === "SALES_DOCUMENT") return entry.status === "ISSUED" && ["1.1", "5.1"].includes(entry.documentKind ?? "");
  if (entry.type === "PURCHASE") return entry.status === "POSTED" && entry.documentKind === "INVOICE";
  return entry.type === "EXPENSE" || entry.type === "SUPPLIER_PAYMENT";
}
function inside(entry: AccountantEntry, fromAt: Date, toAt: Date) {
  return entry.occurredAt >= fromAt && entry.occurredAt < toAt;
}

export function buildAccountantPackage(input: {
  orgId: string;
  from: string;
  to: string;
  fromAt: Date;
  toAt: Date;
  storeId?: string | null;
  entries: readonly AccountantEntry[];
  allocations: readonly AccountantAllocation[];
}): AccountantPackage {
  const entries = input.entries.filter((entry) => entry.orgId === input.orgId && legalEntry(entry) && inside(entry, input.fromAt, input.toAt) && (!input.storeId || entry.storeId === input.storeId))
    .map((entry) => ({ ...entry, netCents: validCents(entry.netCents), vatCents: validCents(entry.vatCents), totalCents: validCents(entry.totalCents) }))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  const paymentIds = new Set(entries.filter((entry) => entry.type === "SUPPLIER_PAYMENT").map((entry) => entry.id));
  const allocations = input.allocations.filter((row) => row.orgId === input.orgId && paymentIds.has(row.paymentId))
    .map((row) => ({ ...row, amountCents: validCents(row.amountCents) }))
    .filter((row) => row.amountCents > 0)
    .sort((a, b) => a.paymentId.localeCompare(b.paymentId) || a.purchaseDocId.localeCompare(b.purchaseDocId));
  const totals = {
    netCents: entries.reduce((sum, row) => sum + row.netCents, 0),
    vatCents: entries.reduce((sum, row) => sum + row.vatCents, 0),
    totalCents: entries.reduce((sum, row) => sum + row.totalCents, 0),
    entries: entries.length,
    allocations: allocations.length,
  };
  for (const value of [totals.netCents, totals.vatCents, totals.totalCents]) validCents(value);
  const packageId = createHash("sha256").update(JSON.stringify({
    version: 1, orgId: input.orgId, from: input.from, to: input.to, storeId: input.storeId ?? null,
    entries: entries.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })), allocations,
  })).digest("hex");
  return { version: 1, packageId, filters: { orgId: input.orgId, from: input.from, to: input.to, storeId: input.storeId ?? null }, formalOnly: true, includesPayroll: false, entries, supplierPaymentAllocations: allocations, totals };
}

/** Τα κελιά κειμένου προστατεύονται από spreadsheet formula injection· τα αριθμητικά ποσά μένουν λεπτά Int. */
export function csvCell(value: string | number | null | undefined) {
  if (typeof value === "number") return String(value);
  let text = value ?? "";
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function accountantCsv(data: AccountantPackage) {
  const header = ["record_type", "id", "date", "store_id", "entry_type", "status", "number", "counterparty", "net_cents", "vat_cents", "total_cents", "reference", "payment_id", "purchase_doc_id", "allocation_cents"];
  const entryRows = data.entries.map((row) => ["entry", row.id, row.occurredAt.toISOString(), row.storeId, row.type, row.status, row.number, row.counterparty, row.netCents, row.vatCents, row.totalCents, row.reference, null, null, null]);
  const allocationRows = data.supplierPaymentAllocations.map((row) => ["allocation", row.id, null, null, "SUPPLIER_PAYMENT_ALLOCATION", null, null, null, null, null, null, null, row.paymentId, row.purchaseDocId, row.amountCents]);
  return `\uFEFF${[header, ...entryRows, ...allocationRows].map((row) => row.map((value) => csvCell(value)).join(";")).join("\r\n")}\r\n`;
}
