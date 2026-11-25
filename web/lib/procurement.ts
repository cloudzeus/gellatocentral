// Καθαρή λογική MRP και παραγγελιών: ακέραιες βασικές μονάδες, νομίσματα σε λεπτά.
export function uniqueSupplierItemFallback<T>(candidates: readonly T[]): T | null {
  return candidates.length === 1 ? candidates[0]! : null;
}

export type OrderRounding = { requiredBaseQty: number; minimumBaseQty?: number; orderMultipleBase?: number };

export function roundedOrderQuantity(input: OrderRounding) {
  const { requiredBaseQty, minimumBaseQty = 0, orderMultipleBase = 1 } = input;
  if (![requiredBaseQty, minimumBaseQty, orderMultipleBase].every(Number.isSafeInteger) || requiredBaseQty < 0 || minimumBaseQty < 0 || orderMultipleBase < 1) throw new Error("Άκυροι κανόνες παραγγελίας");
  const target = requiredBaseQty === 0 ? 0 : Math.max(requiredBaseQty, minimumBaseQty);
  return target === 0 ? 0 : Math.ceil(target / orderMultipleBase) * orderMultipleBase;
}

export type MrpInput = {
  onHandBaseQty: number;
  reservedBaseQty?: number;
  averageDailyUsageBaseQty: number;
  leadDays: number;
  coverDays: number;
  safetyBaseQty?: number;
  minimumBaseQty?: number;
  orderMultipleBase?: number;
};

export function mrpSuggestion(input: MrpInput) {
  const reserved = input.reservedBaseQty ?? 0;
  const safety = input.safetyBaseQty ?? 0;
  const values = [input.onHandBaseQty, reserved, input.averageDailyUsageBaseQty, input.leadDays, input.coverDays, safety];
  if (!values.every((n) => Number.isFinite(n) && n >= 0) || input.onHandBaseQty < 0 || reserved < 0) throw new Error("Άκυρα δεδομένα MRP");
  const target = Math.ceil(input.averageDailyUsageBaseQty * (input.leadDays + input.coverDays) + safety);
  const shortage = Math.max(0, target - Math.max(0, input.onHandBaseQty - reserved));
  const suggestedBaseQty = roundedOrderQuantity({ requiredBaseQty: shortage, minimumBaseQty: shortage ? input.minimumBaseQty : 0, orderMultipleBase: input.orderMultipleBase });
  return { targetBaseQty: target, shortageBaseQty: shortage, suggestedBaseQty };
}

export function lineTotals(quantityBase: number, unitPriceCents: number, vatRate: number, discountBps = 0, costScale = 1) {
  if (![quantityBase, unitPriceCents, vatRate, discountBps, costScale].every(Number.isSafeInteger) || quantityBase < 0 || unitPriceCents < 0 || vatRate < 0 || vatRate > 100 || discountBps < 0 || discountBps > 10000 || costScale < 1) throw new Error("Άκυρη γραμμή παραγγελίας");
  const gross = Math.round(quantityBase * unitPriceCents / costScale);
  const netCents = Math.round(gross * (10000 - discountBps) / 10000);
  const vatCents = Math.round(netCents * vatRate / 100);
  return { netCents, vatCents, totalCents: netCents + vatCents };
}

export function sumDocumentTotals(lines: readonly { quantityBase: number; unitPriceCents: number; vatRate: number; discountBps?: number; costScale?: number }[]) {
  return lines.reduce((sum, line) => {
    const totals = lineTotals(line.quantityBase, line.unitPriceCents, line.vatRate, line.discountBps, line.costScale);
    return { netCents: sum.netCents + totals.netCents, vatCents: sum.vatCents + totals.vatCents, totalCents: sum.totalCents + totals.totalCents };
  }, { netCents: 0, vatCents: 0, totalCents: 0 });
}

/** Επόμενη επιτρεπτή ημερομηνία· 1=Δευτέρα … 7=Κυριακή, χωρίς timezone ambiguity. */
export function nextAllowedDay(from: Date, allowed: readonly number[], afterDays = 0) {
  if (allowed.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new Error("Άκυρες ημέρες παράδοσης");
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + Math.max(0, Math.trunc(afterDays))));
  if (!allowed.length) return date;
  for (let i = 0; i < 8; i += 1) {
    const weekday = date.getUTCDay() || 7;
    if (allowed.includes(weekday)) return date;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  throw new Error("unreachable");
}
