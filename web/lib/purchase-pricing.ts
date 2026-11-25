// Κανόνας ανάλυσης τιμής αγοράς (docs/analysis/PROCUREMENT-DESIGN.md §7).
// Οι τιμές είναι ιστορικό (μόνο προσθήκες)· η «τρέχουσα» για ποσότητα q συσκευασιών και ημερομηνία d:
// 1. κρατάμε τις γραμμές που ισχύουν (validFrom ≤ d ≤ validTo ή κενό, minPackQty ≤ q ή κενό),
// 2. κερδίζει η πιο «συγκεκριμένη»: συμφωνία με ποσότητα ΚΑΙ διάστημα > με ένα από τα δύο > χωρίς όρους,
//    σε ισοπαλία η νεότερη validFrom,
// 3. αν καμία δεν ισχύει: η τελευταία άνευ όρων· αν ούτε αυτή, «χωρίς τιμή» (undefined).

/** Το ελάχιστο που χρειάζεται από μια γραμμή SupplierItemPrice. */
export type PriceLine = {
  priceCents: number; // ανά συσκευασία TradeItem, προ ΦΠΑ, σε λεπτά
  minPackQty: number | null;
  validFrom: Date;
  validTo: Date | null;
};

/** Βαθμός ειδικότητας: ποσότητα και διάστημα = 2, ένα από τα δύο = 1, τιμοκατάλογος = 0. */
const specificity = (l: PriceLine): number => (l.minPackQty != null ? 1 : 0) + (l.validTo != null ? 1 : 0);

const inWindow = (l: PriceLine, at: Date): boolean => l.validFrom <= at && (l.validTo == null || at <= l.validTo);

/** Η τιμή που ισχύει για παραγγελία `packQty` συσκευασιών την ημερομηνία `at`. */
export function resolvePrice(lines: readonly PriceLine[], packQty: number, at: Date): PriceLine | undefined {
  const matching = lines
    .filter((l) => inWindow(l, at) && (l.minPackQty == null || l.minPackQty <= packQty))
    .sort((a, b) => specificity(b) - specificity(a) || b.validFrom.getTime() - a.validFrom.getTime());
  if (matching[0]) return matching[0];
  // fallback: η τελευταία τιμή τιμοκαταλόγου (χωρίς όρους) — μια συμφωνία που έληξε δεν «σέρνει» την τιμή της
  return lines
    .filter((l) => l.minPackQty == null && l.validTo == null && l.validFrom <= at)
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
}

// ---- Έλεγχος τιμολογίου έναντι συμφωνίας (§7γ): η γραμμή συμφωνεί με την ισχύουσα τιμή; ----

export type PriceCheck = {
  expectedCents: number | undefined; // η ισχύουσα τιμή ανά συσκευασία· undefined = άγνωστη (πρώτη αγορά)
  agreement: boolean; // η ισχύουσα τιμή είναι ειδική συμφωνία (όρος ποσότητας ή/και διάστημα)
  diffCents: number; // τιμολόγιο μείον αναμενόμενη (θετικό = χρεώθηκε ακριβότερα)
};

/** Σύγκριση της τιμολογιακής τιμής ανά συσκευασία με την ισχύουσα τιμή/συμφωνία του προμηθευτή. */
export function priceCheck(invoicePerPackCents: number, lines: readonly PriceLine[], packQtyTotal: number, at: Date): PriceCheck {
  const current = resolvePrice(lines, packQtyTotal, at);
  if (!current) return { expectedCents: undefined, agreement: false, diffCents: 0 };
  return {
    expectedCents: current.priceCents,
    agreement: current.minPackQty != null || current.validTo != null,
    diffCents: invoicePerPackCents - current.priceCents,
  };
}

/**
 * Από την αποδοχή τιμολογίου γράφουμε νέα τιμή τιμοκαταλόγου ΜΟΝΟ όταν:
 * δεν υπάρχει καθόλου τιμή (πρώτη αγορά) ή άλλαξε η τιμή τιμοκαταλόγου.
 * Αν ισχύει ειδική συμφωνία και το τιμολόγιο διαφέρει, η συμφωνία μένει ανέγγιχτη —
 * η διαφορά εμφανίζεται ως «εκτός συμφωνίας» και είναι διεκδίκηση προς τον προμηθευτή.
 */
export const shouldWritePrice = (check: PriceCheck): boolean =>
  check.expectedCents === undefined || (check.diffCents !== 0 && !check.agreement);

// ---- Έλεγχος παραλαβής πριν από τη σύνδεση χρηματοοικονομικού τιμολογίου ----

export type ActualReceiptPrice = {
  unitPriceCents: number; // ανά kg/l/1000 τεμ., πριν από την έκπτωση
  discountBps?: number;
};

export type AgreementReceiptPrice = {
  priceCents: number; // ανά συσκευασία TradeItem
  contentQty: number; // περιεχόμενο συσκευασίας στη βασική μονάδα
};

export type PreviousReceiptPrice = {
  unitPriceCents: number; // ανά μονάδα παραστατικού της προηγούμενης αγοράς
  packQty: number;
  contentQty: number;
  discountBps?: number;
};

export type ReceiptPriceReview = {
  basis: "AGREEMENT" | "PREVIOUS_PURCHASE" | "NO_BASELINE";
  kind: "AGREEMENT_MISMATCH" | "PRICE_INCREASE" | null;
  expectedPriceCents: number | null;
  actualPriceCents: number | null;
};

const roundedRatio = (numerator: bigint, denominator: bigint): number =>
  Number((numerator + denominator / 2n) / denominator);

/**
 * Κανονικοποιεί συσκευασία και έκπτωση χωρίς στρογγυλοποίηση πριν από τη σύγκριση.
 * Η αύξηση είναι discrepancy ΜΟΝΟ όταν newPrice * 100 > oldPrice * 105.
 */
export function reviewReceiptPrice(
  actual: ActualReceiptPrice,
  costScale: number,
  agreement?: AgreementReceiptPrice,
  previous?: PreviousReceiptPrice,
): ReceiptPriceReview {
  const actualFactor = 10_000 - (actual.discountBps ?? 0);
  if (agreement) {
    const actualNormalized = BigInt(actual.unitPriceCents) * BigInt(actualFactor) * BigInt(agreement.contentQty);
    const expectedNormalized = BigInt(agreement.priceCents) * 10_000n * BigInt(costScale);
    return {
      basis: "AGREEMENT",
      kind: actualNormalized === expectedNormalized ? null : "AGREEMENT_MISMATCH",
      expectedPriceCents: agreement.priceCents,
      actualPriceCents: roundedRatio(actualNormalized, 10_000n * BigInt(costScale)),
    };
  }
  if (!previous) return { basis: "NO_BASELINE", kind: null, expectedPriceCents: null, actualPriceCents: null };

  const previousFactor = 10_000 - (previous.discountBps ?? 0);
  // Κοινή ακέραια κλίμακα: η τιμή παραλαβής και η προηγούμενη γίνονται συγκρίσιμες ανά kg/l/1000 τεμ.
  const newPrice = BigInt(actual.unitPriceCents) * BigInt(actualFactor) * BigInt(previous.packQty) * BigInt(previous.contentQty);
  const oldPrice = BigInt(previous.unitPriceCents) * BigInt(previousFactor) * BigInt(costScale);
  return {
    basis: "PREVIOUS_PURCHASE",
    kind: newPrice * 100n > oldPrice * 105n ? "PRICE_INCREASE" : null,
    expectedPriceCents: roundedRatio(
      BigInt(previous.unitPriceCents) * BigInt(previousFactor) * BigInt(costScale),
      10_000n * BigInt(previous.packQty) * BigInt(previous.contentQty),
    ),
    actualPriceCents: roundedRatio(BigInt(actual.unitPriceCents) * BigInt(actualFactor), 10_000n),
  };
}
