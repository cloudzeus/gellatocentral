// Καθαρό canonical request για idempotency· δεν περιλαμβάνει actor, τοπική ώρα ή server snapshots.
import { createHash } from "node:crypto";

export const STOCK_TRANSFER_ERROR = [
  "INVALID_TRANSFER_REQUEST",
  "SAME_WAREHOUSE",
  "DUPLICATE_TRANSFER_LINE",
  "IDEMPOTENCY_KEY_REUSED",
  "DESTINATION_LOT_EXPIRY_MISMATCH",
] as const;
export type StockTransferErrorCode = (typeof STOCK_TRANSFER_ERROR)[number];

export class StockTransferError extends Error {
  readonly code: StockTransferErrorCode;
  constructor(code: StockTransferErrorCode) {
    super(code);
    this.name = "StockTransferError";
    this.code = code;
  }
}

export const STOCK_TRANSFER_ERROR_MESSAGE: Record<StockTransferErrorCode, string> = {
  INVALID_TRANSFER_REQUEST: "Έλεγξε τα στοιχεία και τις ποσότητες της μεταφοράς",
  SAME_WAREHOUSE: "Η αποθήκη προέλευσης πρέπει να διαφέρει από την αποθήκη προορισμού",
  DUPLICATE_TRANSFER_LINE: "Το ίδιο είδος και η ίδια παρτίδα δηλώθηκαν περισσότερες από μία φορές",
  IDEMPOTENCY_KEY_REUSED: "Το αναγνωριστικό υποβολής έχει ήδη χρησιμοποιηθεί για διαφορετική μεταφορά",
  DESTINATION_LOT_EXPIRY_MISMATCH: "Στον προορισμό υπάρχει η ίδια παρτίδα με διαφορετική ημερομηνία λήξης",
};

export type StockTransferLineInput = {
  genericItemId: string;
  sourceLotId?: string | null;
  quantity: number;
};

export type StockTransferInput = {
  clientKey: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  storeId?: string | null;
  note?: string | null;
  lines: readonly StockTransferLineInput[];
};

export type CanonicalStockTransferRequest = {
  clientKey: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  storeId: string | null;
  note: string | null;
  lines: { genericItemId: string; sourceLotId: string | null; quantity: number }[];
};

function text(value: string | null | undefined, max: number): string {
  const clean = value?.trim() ?? "";
  if (!clean || clean.length > max) throw new StockTransferError("INVALID_TRANSFER_REQUEST");
  return clean;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Σταθερή σειρά και normalized IDs/ποσότητες, ώστε το replay να μην εξαρτάται από τη σειρά της φόρμας. */
export function canonicalStockTransferRequest(input: StockTransferInput): CanonicalStockTransferRequest {
  const sourceWarehouseId = text(input.sourceWarehouseId, 80);
  const destinationWarehouseId = text(input.destinationWarehouseId, 80);
  if (sourceWarehouseId === destinationWarehouseId) throw new StockTransferError("SAME_WAREHOUSE");
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) {
    throw new StockTransferError("INVALID_TRANSFER_REQUEST");
  }
  const storeId = input.storeId?.trim() ? text(input.storeId, 80) : null;
  const note = input.note?.trim() ? text(input.note, 500) : null;
  const seen = new Set<string>();
  const lines = input.lines.map((line) => {
    const genericItemId = text(line.genericItemId, 80);
    const sourceLotId = line.sourceLotId?.trim() ? text(line.sourceLotId, 80) : null;
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > 2_147_483_647) {
      throw new StockTransferError("INVALID_TRANSFER_REQUEST");
    }
    const key = JSON.stringify([genericItemId, sourceLotId]);
    if (seen.has(key)) throw new StockTransferError("DUPLICATE_TRANSFER_LINE");
    seen.add(key);
    return { genericItemId, sourceLotId, quantity: line.quantity };
  }).sort((a, b) => compareText(a.genericItemId, b.genericItemId) || compareText(a.sourceLotId ?? "", b.sourceLotId ?? ""));
  return { clientKey: text(input.clientKey, 100), sourceWarehouseId, destinationWarehouseId, storeId, note, lines };
}

export function stockTransferRequestHash(orgId: string, request: CanonicalStockTransferRequest): string {
  const tenant = text(orgId, 80);
  const logicalRequest = {
    sourceWarehouseId: request.sourceWarehouseId,
    destinationWarehouseId: request.destinationWarehouseId,
    storeId: request.storeId,
    note: request.note,
    lines: request.lines,
  };
  return createHash("sha256").update(JSON.stringify({ version: 1, orgId: tenant, ...logicalRequest })).digest("hex");
}
