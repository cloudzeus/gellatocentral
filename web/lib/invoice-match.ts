// Τριπλός έλεγχος μίας παραλαβής προς ένα τιμολόγιο. Ποσότητες σε base units,
// τιμές προ εκπτώσεως ανά kg/l/1.000 τεμ. και όλα τα χρηματικά ποσά σε ακέραια cents.

export type ActualInvoiceLine = {
  quantityBase: number;
  unitPriceCents: number;
  discountBps?: number;
  vatRate: number;
};

export type InvoicePriceBasis = "AGREEMENT" | "ORDER" | "RECEIPT";
export type InvoiceDiscrepancyKind = "QUANTITY_MISMATCH" | "PRICE_MISMATCH" | "VAT_MISMATCH";

export type InvoiceMatchBaseline = {
  receivedQuantityBase: number;
  costScale: number;
  agreement?: { priceCents: number; contentQty: number };
  order?: { unitPriceCents: number; discountBps: number; vatRate: number };
  receipt: { unitPriceCents: number; discountBps: number; vatRate: number };
};

export type InvoiceLineDiscrepancy = {
  basis: "AGREEMENT" | "ORDER" | "RECEIPT" | "ACCOUNTING";
  kind: InvoiceDiscrepancyKind;
  expectedQuantityBase: number | null;
  actualQuantityBase: number | null;
  expectedUnitPriceCents: number | null;
  actualUnitPriceCents: number | null;
  expectedVatRate: number | null;
  actualVatRate: number | null;
  reason: string;
};

const roundedRatio = (numerator: bigint, denominator: bigint): number => {
  const value = Number((numerator + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(value)) throw new Error("Το ποσό τιμολογίου υπερβαίνει το επιτρεπτό όριο");
  return value;
};

const netUnitPrice = (unitPriceCents: number, discountBps: number) =>
  roundedRatio(BigInt(unitPriceCents) * BigInt(10_000 - discountBps), 10_000n);

export const normalizedGrossUnitPrice = (grossCents: number, quantityBase: number, costScale: number) =>
  roundedRatio(BigInt(grossCents) * BigInt(costScale), BigInt(quantityBase));

/** Η μερική παραλαβή συγκρίνεται με το receivedQuantityBase, ποτέ με την αρχική ποσότητα παραγγελίας. */
export function matchInvoiceLine(actual: ActualInvoiceLine, baseline: InvoiceMatchBaseline) {
  const discountBps = actual.discountBps ?? 0;
  const grossCents = roundedRatio(BigInt(actual.quantityBase) * BigInt(actual.unitPriceCents), BigInt(baseline.costScale));
  const actualUnitPriceCents = netUnitPrice(actual.unitPriceCents, discountBps);
  const priceBasis: InvoicePriceBasis = baseline.agreement ? "AGREEMENT" : baseline.order ? "ORDER" : "RECEIPT";
  const expectedUnitPriceCents = baseline.agreement
    ? roundedRatio(BigInt(baseline.agreement.priceCents) * BigInt(baseline.costScale), BigInt(baseline.agreement.contentQty))
    : baseline.order
      ? netUnitPrice(baseline.order.unitPriceCents, baseline.order.discountBps)
      : netUnitPrice(baseline.receipt.unitPriceCents, baseline.receipt.discountBps);
  const expectedVatRate = baseline.order?.vatRate ?? baseline.receipt.vatRate;
  const discrepancies: InvoiceLineDiscrepancy[] = [];

  if (actual.quantityBase !== baseline.receivedQuantityBase) discrepancies.push({
    basis: "ACCOUNTING", kind: "QUANTITY_MISMATCH",
    expectedQuantityBase: baseline.receivedQuantityBase, actualQuantityBase: actual.quantityBase,
    expectedUnitPriceCents: null, actualUnitPriceCents: null, expectedVatRate: null, actualVatRate: null,
    reason: "Η ποσότητα τιμολογίου διαφέρει από την ποσότητα της συγκεκριμένης παραλαβής.",
  });
  if (actualUnitPriceCents !== expectedUnitPriceCents) discrepancies.push({
    basis: priceBasis, kind: "PRICE_MISMATCH",
    expectedQuantityBase: null, actualQuantityBase: null,
    expectedUnitPriceCents, actualUnitPriceCents, expectedVatRate: null, actualVatRate: null,
    reason: `Η καθαρή τιμή τιμολογίου διαφέρει από ${priceBasis === "AGREEMENT" ? "την έγκυρη ειδική συμφωνία" : priceBasis === "ORDER" ? "την παραγγελία" : "την παραλαβή"}.`,
  });
  if (actual.vatRate !== expectedVatRate) discrepancies.push({
    basis: "ACCOUNTING", kind: "VAT_MISMATCH",
    expectedQuantityBase: null, actualQuantityBase: null, expectedUnitPriceCents: null, actualUnitPriceCents: null,
    expectedVatRate, actualVatRate: actual.vatRate,
    reason: "Ο συντελεστής ΦΠΑ τιμολογίου διαφέρει από τη γραμμή παραγγελίας/παραλαβής και απαιτεί λογιστικό έλεγχο.",
  });

  return { grossCents, actualUnitPriceCents, expectedUnitPriceCents, priceBasis, discrepancies };
}
