// Καθαρός τραπεζικός έλεγχος: η αποθήκευση γίνεται στο DB layer και καμία αντιστοίχιση δεν γράφει ledger κίνηση.
import { createHash } from "node:crypto";

export type StatementReviewStatus = "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "CONFLICT";
export type BankStatementRow = {
  line: number;
  externalId: string | null;
  reference: string | null;
  description: string | null;
  bookedAt: Date;
  amountCents: number;
};
export type LedgerCandidate = {
  id: string;
  orgId: string;
  accountId: string;
  storeId: string | null;
  amountCents: number;
  occurredAt: Date;
  referenceId: string | null;
};
export type VivaPaymentCandidate = {
  orgId: string;
  storeId: string;
  issuedAt: Date;
  amountCents: number;
};
export type VivaCommissionCandidate = { orgId: string; storeId: string; businessDate: string; commissionCents: number };
export type VivaSettlementCandidate = {
  key: string;
  storeId: string;
  businessDate: string;
  grossAmountCents: number;
  commissionCents: number;
  amountCents: number;
  paymentCount: number;
};
export type StatementReviewRow = BankStatementRow & {
  status: StatementReviewStatus;
  reasons: string[];
  matchedTransactionId: string | null;
  candidateTransactionIds: string[];
  vivaCandidates: VivaSettlementCandidate[];
  suggestedKind: "viva_settlement" | null;
};
export type StatementReview = {
  reviewId: string;
  persistence: "STATELESS" | "PERSISTED";
  movementsCreated: 0;
  accountId: string;
  from: string;
  to: string;
  rows: StatementReviewRow[];
  summary: Record<StatementReviewStatus, number> & { total: number; amountCents: number };
};
export type PersistedStatementReview = StatementReview & {
  persistence: "PERSISTED";
  importId: string;
  storeId: string | null;
  sourceName: string | null;
  createdAt: Date;
};
export type StatementReviewListItem = Omit<PersistedStatementReview, "rows">;

const DAY = 86_400_000;
const HEADER_NAMES = {
  date: ["date", "bookedat", "bookingdate", "valuedate", "ημερομηνία", "ημερομηνια"],
  amount: ["amount", "amountcents", "ποσό", "ποσο", "value"],
  externalId: ["externalid", "transactionid", "id", "bankid", "κωδικός", "κωδικος"],
  reference: ["reference", "ref", "αιτιολογία", "αιτιολογια", "αναφορά", "αναφορα"],
  description: ["description", "details", "narrative", "περιγραφή", "περιγραφη"],
} as const;

function headerKey(value: string) {
  return value.trim().toLocaleLowerCase("el-GR").replace(/[\s_.-]/g, "");
}

/** Μικρός CSV reader με quotes, escaped quotes, νέες γραμμές και ελληνικό delimiter `;`. */
export function parseCsv(text: string, maximumRows = 5000): string[][] {
  if (text.length > 1_000_000) throw new Error("Το statement υπερβαίνει το 1 MB");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === "," || char === ";" || char === "\t") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      if (rows.length > maximumRows + 1) throw new Error(`Το statement δέχεται έως ${maximumRows} κινήσεις`);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("Μη έγκυρο CSV: ανοιχτά εισαγωγικά");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length > maximumRows + 1) throw new Error(`Το statement δέχεται έως ${maximumRows} κινήσεις`);
  return rows;
}

export function parseStatementDate(value: string): Date {
  const clean = value.trim();
  const greek = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(clean);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  const normalized = greek ? `${greek[3]}-${greek[2]}-${greek[1]}` : clean;
  const date = greek || iso ? new Date(`${normalized}T00:00:00.000Z`) : new Date(clean);
  if (Number.isNaN(date.getTime())) throw new Error(`Άκυρη ημερομηνία statement: ${value.slice(0, 40)}`);
  if ((greek || iso) && date.toISOString().slice(0, 10) !== normalized) throw new Error(`Άκυρη ημερομηνία statement: ${clean}`);
  return date;
}

export function parseStatementAmount(value: string): number {
  let clean = value.trim().replace(/[\s\u00a0€]/g, "").replace(/EUR/gi, "");
  let sign = 1;
  if (/^\(.*\)$/.test(clean)) { sign = -1; clean = clean.slice(1, -1); }
  if (clean.startsWith("-")) { sign = -1; clean = clean.slice(1); }
  if (clean.startsWith("+")) clean = clean.slice(1);
  const comma = clean.lastIndexOf(","), dot = clean.lastIndexOf(".");
  let decimal = "";
  if (comma >= 0 && dot >= 0) {
    const separator = Math.max(comma, dot);
    decimal = clean.slice(separator + 1);
    clean = clean.slice(0, separator).replace(/[.,]/g, "");
  } else if (comma >= 0 || dot >= 0) {
    const separator = Math.max(comma, dot);
    const fraction = clean.slice(separator + 1);
    if (/^\d{1,2}$/.test(fraction)) { decimal = fraction; clean = clean.slice(0, separator).replace(/[.,]/g, ""); }
    else if (/^\d{3}$/.test(fraction) && clean.slice(0, separator)) clean = clean.replace(/[.,]/g, "");
  }
  if (!/^\d+$/.test(clean) || (decimal && !/^\d{1,2}$/.test(decimal))) throw new Error(`Άκυρο ποσό statement: ${value.slice(0, 40)}`);
  const cents = sign * (Number(clean) * 100 + Number(decimal.padEnd(2, "0") || 0));
  if (!Number.isSafeInteger(cents) || cents === 0) throw new Error("Το ποσό statement πρέπει να είναι μη μηδενικό και σε ασφαλή λεπτά");
  return cents;
}

function cleanCell(value: string | undefined, maximum = 300) {
  const clean = value?.trim() ?? "";
  if (clean.length > maximum) throw new Error(`Πεδίο statement με πάνω από ${maximum} χαρακτήρες`);
  return clean || null;
}

export function parseBankStatement(text: string): BankStatementRow[] {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("Το statement χρειάζεται κεφαλίδα και τουλάχιστον μία κίνηση");
  const headers = table[0].map(headerKey);
  const column = (names: readonly string[]) => headers.findIndex((header) => names.includes(header));
  const dateColumn = column(HEADER_NAMES.date), amountColumn = column(HEADER_NAMES.amount);
  if (dateColumn < 0 || amountColumn < 0) throw new Error("Λείπουν οι στήλες ημερομηνίας και ποσού");
  const externalIdColumn = column(HEADER_NAMES.externalId), referenceColumn = column(HEADER_NAMES.reference), descriptionColumn = column(HEADER_NAMES.description);
  return table.slice(1).map((row, index) => ({
    line: index + 2,
    bookedAt: parseStatementDate(row[dateColumn] ?? ""),
    amountCents: parseStatementAmount(row[amountColumn] ?? ""),
    externalId: externalIdColumn < 0 ? null : cleanCell(row[externalIdColumn], 120),
    reference: referenceColumn < 0 ? null : cleanCell(row[referenceColumn], 160),
    description: descriptionColumn < 0 ? null : cleanCell(row[descriptionColumn]),
  }));
}

function validDay(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}: YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) throw new Error(`Άκυρη ${label}`);
  return date;
}
function dayDifference(a: Date, b: Date) {
  return Math.round((Date.parse(`${a.toISOString().slice(0, 10)}T00:00:00.000Z`) - Date.parse(`${b.toISOString().slice(0, 10)}T00:00:00.000Z`)) / DAY);
}
function businessDate(date: Date) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
}
function statementKey(row: BankStatementRow) {
  return row.externalId ? `id:${row.externalId}` : `row:${row.bookedAt.toISOString().slice(0, 10)}:${row.amountCents}:${row.reference ?? ""}`;
}
function baseRow(row: BankStatementRow): StatementReviewRow {
  return { ...row, status: "UNMATCHED", reasons: [], matchedTransactionId: null, candidateTransactionIds: [], vivaCandidates: [], suggestedKind: null };
}

/** Ο διακανονισμός ομαδοποιεί μόνο completed/successful Viva πληρωμές και αφαιρεί την προμήθεια κλεισμένου ταμείου. */
export function groupVivaSettlements(payments: readonly VivaPaymentCandidate[], orgId: string, storeId?: string | null, commissions: readonly VivaCommissionCandidate[] = []): VivaSettlementCandidate[] {
  const groups = new Map<string, VivaSettlementCandidate>();
  for (const payment of payments) {
    if (payment.orgId !== orgId || (storeId && payment.storeId !== storeId) || !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 || Number.isNaN(payment.issuedAt.getTime())) continue;
    const date = businessDate(payment.issuedAt), key = `${payment.storeId}:${date}`;
    const group = groups.get(key) ?? { key, storeId: payment.storeId, businessDate: date, grossAmountCents: 0, commissionCents: 0, amountCents: 0, paymentCount: 0 };
    group.grossAmountCents += payment.amountCents;
    group.amountCents = group.grossAmountCents;
    group.paymentCount += 1;
    if (!Number.isSafeInteger(group.grossAmountCents)) throw new Error("Το άθροισμα Viva υπερβαίνει το επιτρεπτό όριο");
    groups.set(key, group);
  }
  for (const row of commissions) {
    if (row.orgId !== orgId || (storeId && row.storeId !== storeId) || !Number.isSafeInteger(row.commissionCents) || row.commissionCents < 0) continue;
    const group = groups.get(`${row.storeId}:${row.businessDate}`);
    if (!group) continue;
    group.commissionCents += row.commissionCents;
    group.amountCents = group.grossAmountCents - group.commissionCents;
    if (group.amountCents < 0) throw new Error("Η προμήθεια Viva υπερβαίνει τις πωλήσεις της ημέρας");
  }
  return [...groups.values()].filter((group) => group.amountCents > 0).sort((a, b) => a.key.localeCompare(b.key));
}

export function reviewBankStatementRows(input: {
  orgId: string;
  accountId: string;
  from: string;
  to: string;
  storeId?: string | null;
  statement: readonly BankStatementRow[];
  ledger: readonly LedgerCandidate[];
  vivaPayments?: readonly VivaPaymentCandidate[];
  vivaCommissions?: readonly VivaCommissionCandidate[];
}): StatementReview {
  const fromAt = validDay(input.from, "έναρξη"), toAt = validDay(input.to, "λήξη");
  if (fromAt > toAt || toAt.getTime() - fromAt.getTime() > 366 * DAY) throw new Error("Άκυρη περίοδος statement (έως 366 ημέρες)");
  const ledger = input.ledger.filter((row) => row.orgId === input.orgId && row.accountId === input.accountId && (!input.storeId || row.storeId === input.storeId || row.storeId === null));
  const settlements = groupVivaSettlements(input.vivaPayments ?? [], input.orgId, input.storeId, input.vivaCommissions);
  const duplicateKeys = new Set<string>();
  const seen = new Set<string>();
  for (const row of input.statement) {
    const key = statementKey(row);
    if (seen.has(key)) duplicateKeys.add(key);
    seen.add(key);
  }
  const rows = input.statement.map((statement) => {
    const result = baseRow(statement);
    const date = statement.bookedAt.toISOString().slice(0, 10);
    if (date < input.from || date > input.to) {
      result.status = "CONFLICT"; result.reasons = ["OUTSIDE_REVIEW_PERIOD"]; return result;
    }
    if (duplicateKeys.has(statementKey(statement))) {
      result.status = "CONFLICT"; result.reasons = ["DUPLICATE_STATEMENT_ROW"]; return result;
    }
    const reference = statement.externalId ?? (statement.reference && statement.reference.length >= 4 ? statement.reference : null);
    const referenced = reference ? ledger.filter((row) => row.referenceId === reference) : [];
    if (referenced.length > 1) {
      result.status = "AMBIGUOUS"; result.reasons = ["MULTIPLE_LEDGER_REFERENCES"]; result.candidateTransactionIds = referenced.map((row) => row.id); return result;
    }
    if (referenced.length === 1) {
      const candidate = referenced[0];
      result.candidateTransactionIds = [candidate.id];
      if (candidate.amountCents !== statement.amountCents) {
        result.status = "CONFLICT"; result.reasons = ["AMOUNT_DIFFERS_FROM_LEDGER"]; return result;
      }
      if (Math.abs(dayDifference(candidate.occurredAt, statement.bookedAt)) > 3) {
        result.status = "CONFLICT"; result.reasons = ["DATE_DIFFERS_FROM_LEDGER"]; return result;
      }
      result.status = "MATCHED"; result.matchedTransactionId = candidate.id; return result;
    }
    const amountMatches = ledger.filter((row) => row.amountCents === statement.amountCents && Math.abs(dayDifference(row.occurredAt, statement.bookedAt)) <= 3);
    if (amountMatches.length === 1) {
      result.status = "MATCHED"; result.matchedTransactionId = amountMatches[0].id; result.candidateTransactionIds = [amountMatches[0].id]; return result;
    }
    if (amountMatches.length > 1) {
      result.status = "AMBIGUOUS"; result.reasons = ["MULTIPLE_LEDGER_AMOUNT_DATE_MATCHES"]; result.candidateTransactionIds = amountMatches.map((row) => row.id); return result;
    }
    // Η Viva πώληση δεν είναι τραπεζική κίνηση. Μόνο προτείνουμε settlement· δεν το καταχωρούμε.
    if (statement.amountCents > 0) {
      const candidates = settlements.filter((settlement) => {
        const delay = dayDifference(statement.bookedAt, new Date(`${settlement.businessDate}T00:00:00.000Z`));
        return settlement.amountCents === statement.amountCents && delay >= 0 && delay <= 5;
      });
      result.vivaCandidates = candidates;
      if (candidates.length === 1) result.suggestedKind = "viva_settlement";
      if (candidates.length > 1) { result.status = "AMBIGUOUS"; result.reasons = ["MULTIPLE_VIVA_SETTLEMENT_MATCHES"]; }
    }
    return result;
  });
  const allocated = new Map<string, StatementReviewRow[]>();
  for (const row of rows) if (row.matchedTransactionId) allocated.set(row.matchedTransactionId, [...(allocated.get(row.matchedTransactionId) ?? []), row]);
  for (const matches of allocated.values()) if (matches.length > 1) for (const row of matches) {
    row.status = "CONFLICT"; row.reasons = ["LEDGER_TRANSACTION_MATCHED_MORE_THAN_ONCE"]; row.matchedTransactionId = null;
  }
  const summary = { MATCHED: 0, UNMATCHED: 0, AMBIGUOUS: 0, CONFLICT: 0, total: rows.length, amountCents: 0 };
  for (const row of rows) { summary[row.status] += 1; summary.amountCents += row.amountCents; }
  if (!Number.isSafeInteger(summary.amountCents)) throw new Error("Το άθροισμα statement υπερβαίνει το επιτρεπτό όριο");
  const reviewId = createHash("sha256").update(JSON.stringify({ version: 1, orgId: input.orgId, accountId: input.accountId, storeId: input.storeId ?? null, from: input.from, to: input.to, statement: input.statement.map((row) => ({ ...row, bookedAt: row.bookedAt.toISOString() })) })).digest("hex");
  return { reviewId, persistence: "STATELESS", movementsCreated: 0, accountId: input.accountId, from: input.from, to: input.to, rows, summary };
}
