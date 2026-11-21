// Διόρθωση υπολοίπου παρτίδας (ανοικτές συσκευασίες, απογραφή, απώλειες): μετατροπή της
// καταχωρημένης ποσότητας σε προσημασμένη βασική μονάδα με ελέγχους. Pure — το γράψιμο
// (StockMovement με αιτιολογία και χρήστη) γίνεται στο app/(app)/traceability/actions.ts.

export type CorrectionInput = {
  direction: "in" | "out"; // in: βρέθηκε παραπάνω (πραγματικό περιεχόμενο)· out: απώλεια/μέτρηση
  amount: number; // στην εμφανιζόμενη μονάδα: g για μάζα, ml για όγκο, τεμ για τεμάχια
  dimension: string; // mass | volume | count (της βασικής μονάδας του είδους)
  remaining: number; // τρέχον υπόλοιπο της παρτίδας σε βασική μονάδα
};

/** Προσημασμένη ποσότητα σε βασική μονάδα (mg/ml/τεμ) — θετική είσοδος, αρνητική έξοδος. */
export function correctionBaseQty({ direction, amount, dimension, remaining }: CorrectionInput): number {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Η ποσότητα πρέπει να είναι θετικός ακέραιος");
  // μάζα: η φόρμα δέχεται γραμμάρια, η βασική μονάδα είναι mg — ml και τεμ είναι ήδη βασικές
  const base = dimension === "mass" ? amount * 1_000 : amount;
  if (direction === "out" && base > remaining) throw new Error("Η αφαίρεση ξεπερνά το υπόλοιπο της παρτίδας");
  return direction === "out" ? -base : base;
}
