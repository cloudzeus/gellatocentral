// Καθαρή λογική προβολής αποθέματος: ασφαλής αποτίμηση και ημερολογιακές λήξεις Ελλάδας.
import { daysUntil } from "./production.ts";
import { formatBaseQty, type UnitLike } from "./units.ts";

const VIEW_UNITS: Record<string, UnitLike[]> = {
  mass: [{ code: "kg", dimension: "mass", toBase: 1_000_000 }, { code: "g", dimension: "mass", toBase: 1_000 }, { code: "mg", dimension: "mass", toBase: 1 }],
  volume: [{ code: "l", dimension: "volume", toBase: 1_000 }, { code: "ml", dimension: "volume", toBase: 1 }],
  count: [{ code: "τεμ", dimension: "count", toBase: 1 }],
};

export function formatStockQuantity(quantity: number, dimension: string): string {
  return formatBaseQty(quantity, VIEW_UNITS[dimension] ?? [{ code: "μον.", dimension, toBase: 1 }]);
}

export function safeStockNumber(value: number | bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("η τιμή αποθέματος υπερβαίνει το ασφαλές ακέραιο όριο");
  return result;
}

/** Αξία σε εκατοστά λεπτού: ποσότητα βάσης × μέσο κόστος ανά βασική μονάδα. */
export function stockValueHundredths(quantity: number, unitCostHundredths: number): number {
  if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(unitCostHundredths) || unitCostHundredths < 0) {
    throw new Error("μη έγκυρη ποσότητα ή κόστος αποθέματος");
  }
  return safeStockNumber(BigInt(quantity) * BigInt(unitCostHundredths));
}

/** Το αποθηκευμένο κόστος είναι ανά mg/ml/τεμ· για την οθόνη μετατρέπεται στη μονάδα κατανάλωσης. */
export function stockUnitCostHundredths(baseUnitCostHundredths: number, toBase: number): number {
  if (!Number.isSafeInteger(baseUnitCostHundredths) || baseUnitCostHundredths < 0 || !Number.isSafeInteger(toBase) || toBase < 1) {
    throw new Error("μη έγκυρη μονάδα ή κόστος αποθέματος");
  }
  return safeStockNumber(BigInt(baseUnitCostHundredths) * BigInt(toBase));
}

export function formatStockValue(valueHundredths: number | bigint): string {
  return new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" }).format(safeStockNumber(valueHundredths) / 10_000);
}

export type ExpiryStatus = "expired" | "today" | "urgent" | "soon" | "valid" | "none";

export function expiryStatus(expiresAt: Date | null, now = new Date()): { status: ExpiryStatus; days: number | null } {
  const days = daysUntil(expiresAt, now);
  if (days === null) return { status: "none", days };
  if (days < 0) return { status: "expired", days };
  if (days === 0) return { status: "today", days };
  if (days <= 7) return { status: "urgent", days };
  if (days <= 14) return { status: "soon", days };
  return { status: "valid", days };
}
