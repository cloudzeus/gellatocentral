// Καθαρή validation και canonical requests απογραφής· δεν περιέχουν Next runtime ή database access.
import { createHash } from "node:crypto";

export const STOCK_COUNT_ERROR = [
  "INVALID_COUNT_REQUEST",
  "INVALID_COUNT_LINE",
  "COUNT_NOT_FOUND",
  "COUNT_ALREADY_FINALIZED",
  "EMPTY_COUNT",
  "MISSING_ACTUAL_QUANTITY",
  "MISSING_DIFFERENCE_REASON",
  "DUPLICATE_COUNT_LINE",
  "LOT_ALREADY_EXISTS",
  "FINALIZED_COUNT_EXISTS",
  "IDEMPOTENCY_KEY_REUSED",
  "COUNT_REVISION_CONFLICT",
] as const;
export type StockCountErrorCode = (typeof STOCK_COUNT_ERROR)[number];

export class StockCountError extends Error {
  readonly code: StockCountErrorCode;
  constructor(code: StockCountErrorCode) {
    super(code);
    this.name = "StockCountError";
    this.code = code;
  }
}

export const STOCK_COUNT_ERROR_MESSAGE: Record<StockCountErrorCode, string> = {
  INVALID_COUNT_REQUEST: "Έλεγξε την αποθήκη, την ημερομηνία και τα στοιχεία της απογραφής",
  INVALID_COUNT_LINE: "Η γραμμή απογραφής έχει άκυρη ή ασυνεπή μέτρηση",
  COUNT_NOT_FOUND: "Η απογραφή δεν βρέθηκε ή δεν έχεις πρόσβαση",
  COUNT_ALREADY_FINALIZED: "Η απογραφή έχει οριστικοποιηθεί και δεν αλλάζει",
  EMPTY_COUNT: "Πρόσθεσε τουλάχιστον μία γραμμή πριν από την οριστικοποίηση",
  MISSING_ACTUAL_QUANTITY: "Συμπλήρωσε την πραγματική ποσότητα σε κάθε γραμμή",
  MISSING_DIFFERENCE_REASON: "Κάθε μη μηδενική διαφορά χρειάζεται αιτιολογία 3–200 χαρακτήρων",
  DUPLICATE_COUNT_LINE: "Το είδος και η παρτίδα υπάρχουν ήδη στην απογραφή",
  LOT_ALREADY_EXISTS: "Η παρτίδα υπάρχει ήδη· πρόσθεσέ την από την επιλογή υπάρχουσας παρτίδας",
  FINALIZED_COUNT_EXISTS: "Υπάρχει ήδη οριστικοποιημένη απογραφή για αυτή την αποθήκη και ημερομηνία",
  IDEMPOTENCY_KEY_REUSED: "Το αναγνωριστικό υποβολής έχει χρησιμοποιηθεί για διαφορετική απογραφή",
  COUNT_REVISION_CONFLICT: "Η απογραφή άλλαξε από άλλη συσκευή· ανανέωσε και έλεγξε τις μετρήσεις πριν ξαναστείλεις",
};

export type StockCountInput = {
  clientKey: string;
  storeId?: string | null;
  warehouseId: string;
  countedOn: string;
  note?: string | null;
};

export type CanonicalStockCountRequest = {
  clientKey: string;
  storeId: string | null;
  warehouseId: string;
  countedOn: string;
  note: string | null;
};

function text(value: string, max: number): string {
  const clean = value.trim();
  if (!clean || clean.length > max) throw new StockCountError("INVALID_COUNT_REQUEST");
  return clean;
}

/** Η επιχειρησιακή ημερομηνία είναι πραγματικό calendar date και αποθηκεύεται ως DATE, όχι browser timestamp. */
export function stockCountedOnDate(value: string): Date {
  const clean = value.trim();
  const date = new Date(`${clean}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== clean) {
    throw new StockCountError("INVALID_COUNT_REQUEST");
  }
  return date;
}

export function canonicalStockCountRequest(input: StockCountInput): CanonicalStockCountRequest {
  const countedOn = input.countedOn.trim();
  stockCountedOnDate(countedOn);
  const note = input.note?.trim() || null;
  if (note && note.length > 500) throw new StockCountError("INVALID_COUNT_REQUEST");
  const storeId = input.storeId?.trim() || null;
  if (storeId && storeId.length > 80) throw new StockCountError("INVALID_COUNT_REQUEST");
  return {
    clientKey: text(input.clientKey, 100),
    storeId,
    warehouseId: text(input.warehouseId, 80),
    countedOn,
    note,
  };
}

export function stockCountRequestHash(orgId: string, request: CanonicalStockCountRequest): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    orgId: text(orgId, 80),
    // Το παλιό workshop hash μένει συμβατό· το store μπαίνει μόνο όταν υπάρχει.
    ...(request.storeId ? { storeId: request.storeId } : {}),
    warehouseId: request.warehouseId,
    countedOn: request.countedOn,
    note: request.note,
  })).digest("hex");
}

export type StockCountMeasurementInput = {
  actualQty: number | null;
  reason?: string | null;
};

export function canonicalStockCountMeasurement(input: StockCountMeasurementInput) {
  if (input.actualQty !== null && (!Number.isSafeInteger(input.actualQty) || input.actualQty < 0 || input.actualQty > 2_147_483_647)) {
    throw new StockCountError("INVALID_COUNT_LINE");
  }
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 200) throw new StockCountError("INVALID_COUNT_LINE");
  return { actualQty: input.actualQty, reason };
}

export function stockCountDifference(expectedQty: number, actualQty: number | null): number | null {
  if (actualQty === null) return null;
  const differenceQty = actualQty - expectedQty;
  if (!Number.isSafeInteger(expectedQty) || !Number.isSafeInteger(differenceQty) || differenceQty < -2_147_483_648 || differenceQty > 2_147_483_647) {
    throw new StockCountError("INVALID_COUNT_LINE");
  }
  return differenceQty;
}

/** Ελέγχει και το persisted difference, ώστε το finalized ιστορικό να μην εξαρτάται από νέο υπολογισμό. */
export function assertFinalizableStockCountLine(line: {
  expectedQty: number;
  actualQty: number | null;
  differenceQty: number | null;
  reason: string | null;
}) {
  if (line.actualQty === null) throw new StockCountError("MISSING_ACTUAL_QUANTITY");
  const differenceQty = stockCountDifference(line.expectedQty, line.actualQty);
  if (differenceQty === null || differenceQty !== line.differenceQty) throw new StockCountError("INVALID_COUNT_LINE");
  const reason = line.reason?.trim() || null;
  if (differenceQty !== 0 && (!reason || reason.length < 3 || reason.length > 200)) {
    throw new StockCountError("MISSING_DIFFERENCE_REASON");
  }
  return { differenceQty, reason };
}


/** Σταθερό hash ανεξάρτητο από τη σειρά με την οποία ήρθαν οι γραμμές της φόρμας. */
export function stockCountMeasurementsHash(
  orgId: string,
  countId: string,
  measurements: readonly ({ lineId: string; actualQty: number | null; reason: string | null })[],
): string {
  const canonical = measurements
    .map((measurement) => ({
      lineId: measurement.lineId,
      actualQty: measurement.actualQty,
      reason: measurement.reason,
    }))
    .sort((a, b) => a.lineId.localeCompare(b.lineId));
  return createHash("sha256").update(JSON.stringify({ version: 1, orgId, countId, measurements: canonical })).digest("hex");
}
