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
