// Καθαρή λογική του «Λείπουν από τις αγορές» (χωρίς βάση), για να ελέγχεται με node --test.
import { sameNumber, type MyIncomeDoc } from "./mydata-parse.ts";
/** Παλιό = τόσες ημέρες από την έκδοση χωρίς να το έχουμε· μπαίνει στις «Εργασίες». */
export const OLD_DAYS = 5;

/** Δελτία (8.x/9.x) δεν είναι έξοδα: η παραλαβή τα ελέγχει χωριστά (lib/mydata-check.ts). */
export const isExpense = (type: string | null) => !type || !/^(8|9)\./.test(type);

export type OurDoc = { id: string; mydataMark: string | null; checkedMark: string | null; supplierVat: string | null; number: string | null };

/** Ποιο δικό μας παραστατικό είναι αυτό του myDATA: ίδιο MARK (ή βρέθηκε έτσι στον έλεγχο), αλλιώς ίδιος ΑΦΜ και αριθμός. */
export function findOurs(d: Pick<MyIncomeDoc, "mark" | "supplierVat" | "series" | "number">, ours: readonly OurDoc[]): OurDoc | null {
  return ours.find((o) => o.mydataMark === d.mark || o.checkedMark === d.mark)
    ?? ours.find((o) => !o.mydataMark && o.supplierVat === d.supplierVat && !!o.number && sameNumber(o.number, d))
    ?? null;
}

/** Από 1η του προηγούμενου μήνα ως σήμερα: καλύπτει και το κλείσιμο του μήνα που πέρασε. */
export function syncWindow(now: Date) {
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), to: now };
}
