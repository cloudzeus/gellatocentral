// Καθαρή λογική του «Έλεγχος με την ΑΑΔΕ» για τις αποδείξεις του ταμείου (χωρίς βάση), για node --test.
// Mockup: docs/analysis/mockups/mydata-reconcile.html, ενότητα Β.

/** Αποδείξεις λιανικής και τα πιστωτικά τους. */
export const RECEIPT_TYPES = ["11.1", "11.2", "11.3", "11.4", "11.5"] as const;
/** Πόσες ημέρες πίσω ελέγχουμε κάθε βράδυ. */
export const WINDOW_DAYS = 14;
const DAY = 86_400_000;

const athens = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" });
/** Η ημερομηνία (YYYY-MM-DD) στην ώρα Ελλάδας, όπως τη γράφει η απόδειξη. */
export const athensDay = (d: Date) => athens.format(d);

/** Οι ημέρες που ελέγχουμε: από WINDOW_DAYS πίσω ως χθες (το σήμερα δεν έχει κλείσει). */
export function checkDays(now: Date): string[] {
  return Array.from({ length: WINDOW_DAYS }, (_, i) => athensDay(new Date(now.getTime() - (WINDOW_DAYS - i) * DAY)));
}

/** Μία απόδειξη, δική μας ή της ΑΑΔΕ. */
export type Receipt = { mark: string; day: string; invType: string; cents: number; label: string };
/** Απόδειξη που δεν ταιριάζει. `aadeCents` μόνο όταν βρέθηκε και στις δύο πλευρές με άλλο ποσό. */
export type Gap = { kind: "OURS_ONLY" | "AADE_ONLY" | "AMOUNT"; mark: string; day: string; invType: string; label: string; cents: number; aadeCents?: number };

/**
 * Αντιστοιχίζει τις αποδείξεις μία-μία με το MARK, σε όλο το παράθυρο μαζί: η ΑΑΔΕ μπορεί να γράψει άλλη ημερομηνία
 * από τη δική μας γύρω στα μεσάνυχτα, οπότε η ημέρα δεν μπαίνει στο κλειδί. Ποσό με ανοχή 1 λεπτού.
 */
export function matchReceipts(ours: Receipt[], aade: Receipt[]): Gap[] {
  const theirs = new Map(aade.map((r) => [r.mark, r]));
  const mine = new Set(ours.map((r) => r.mark));
  const gaps: Gap[] = [];
  for (const r of ours) {
    const a = theirs.get(r.mark);
    if (!a) gaps.push({ kind: "OURS_ONLY", ...r });
    else if (Math.abs(a.cents - r.cents) > 1) gaps.push({ kind: "AMOUNT", ...r, aadeCents: a.cents });
  }
  for (const a of aade) if (!mine.has(a.mark)) gaps.push({ kind: "AADE_ONLY", ...a });
  return gaps;
}
