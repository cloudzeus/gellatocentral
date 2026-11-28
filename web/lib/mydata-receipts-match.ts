// Καθαρή λογική του «Έλεγχος με την ΑΑΔΕ» για τις αποδείξεις του ταμείου (χωρίς βάση), για node --test.
// Mockup: docs/analysis/mockups/mydata-reconcile.html, ενότητα Β.

/** Αποδείξεις λιανικής και τα πιστωτικά τους. */
export const RECEIPT_TYPES = ["11.1", "11.2", "11.3", "11.4", "11.5"] as const;
/** Πόσες ημέρες πίσω ελέγχουμε κάθε βράδυ. */
export const WINDOW_DAYS = 14;
/** Πόσα βράδια μπορεί να διαφέρει μια ημέρα πριν γίνει κόκκινη: η ΑΑΔΕ ενημερώνει τα σύνολα με καθυστέρηση. */
export const GRACE_NIGHTS = 3;
const DAY = 86_400_000;

const athens = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" });
/** Η ημερομηνία (YYYY-MM-DD) στην ώρα Ελλάδας, όπως τη γράφει η απόδειξη. */
export const athensDay = (d: Date) => athens.format(d);

/** Οι ημέρες που ελέγχουμε: από WINDOW_DAYS πίσω ως χθες (το σήμερα δεν έχει κλείσει). */
export function checkDays(now: Date): string[] {
  return Array.from({ length: WINDOW_DAYS }, (_, i) => athensDay(new Date(now.getTime() - (WINDOW_DAYS - i) * DAY)));
}

export type DaySide = { count: number; cents: number };
export type DayStatus = "MATCH" | "WAITING" | "DIFF";

/**
 * Συμφωνεί η ημέρα; Ίδιο πλήθος και σύνολο με ανοχή 1 λεπτού. Αν διαφέρει, μένει WAITING ως GRACE_NIGHTS βράδια από την
 * πρώτη φορά που τη βρήκαμε διαφορετική, και μετά γίνεται DIFF.
 */
export function dayStatus(ours: DaySide, aade: DaySide | null, firstDiffAt: Date | null, now: Date): { status: DayStatus; firstDiffAt: Date | null } {
  const same = (aade?.count ?? 0) === ours.count && Math.abs((aade?.cents ?? 0) - ours.cents) <= 1;
  if (same) return { status: "MATCH", firstDiffAt: null };
  const since = firstDiffAt ?? now;
  return { status: now.getTime() - since.getTime() >= (GRACE_NIGHTS - 1) * DAY ? "DIFF" : "WAITING", firstDiffAt: since };
}
