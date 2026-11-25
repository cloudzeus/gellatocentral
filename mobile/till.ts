// Καθαρή λογική του ταμείου (χωρίς React Native), για να ελέγχεται με `npm test`.
// Τα ποσά εδώ είναι μόνο για την οθόνη: τιμές, ΦΠΑ και σύνολο της απόδειξης τα βγάζει πάντα ο server.

export type Line = { priceCents: number; vatRate: number; quantity: number };

/** Σύνολο με ΦΠΑ, και ανάλυση σε καθαρή αξία και ΦΠΑ ανά γραμμή (οι τιμές του καταλόγου είναι τελικές). */
export function totals(lines: readonly Line[]) {
  let totalCents = 0;
  let netCents = 0;
  for (const l of lines) {
    const gross = l.priceCents * l.quantity;
    totalCents += gross;
    netCents += Math.round((gross * 100) / (100 + l.vatRate));
  }
  return { totalCents, netCents, vatCents: totalCents - netCents };
}

const NOTES = [500, 1000, 2000, 5000, 10000, 20000];
/** Γρήγορα ποσά μετρητών: τα τρία επόμενα χαρτονομίσματα πάνω από το σύνολο («Ακριβώς» το βάζει η οθόνη). */
export const quickAmounts = (totalCents: number) => NOTES.filter((n) => n > totalCents).slice(0, 3);

/** Πληκτρολόγιο ποσού: ψηφία, ένα κόμμα, έως δύο δεκαδικά, «⌫» σβήνει. Κρατά κείμενο όπως το βλέπει ο ταμίας. */
export function typeAmount(current: string, key: string): string {
  if (key === "⌫") return current.slice(0, -1);
  if (key === ",") return current.includes(",") ? current : `${current || "0"},`;
  if (!/^\d$/.test(key)) return current;
  const [whole, decimals] = current.split(",");
  if (decimals !== undefined) return decimals.length >= 2 ? current : current + key;
  if (whole.length >= 5) return current; // έως 99.999 €: περισσότερα είναι λάθος πλήκτρο
  return whole === "0" ? key : current + key;
}
export function amountCents(text: string): number {
  const [whole, decimals = ""] = text.split(",");
  return Number(whole || 0) * 100 + Number(decimals.padEnd(2, "0").slice(0, 2));
}
export const amountText = (cents: number) => `${Math.floor(cents / 100)}${cents % 100 ? `,${String(cents % 100).padStart(2, "0")}` : ""}`;

/** Αναμονή πριν από τον επόμενο αυτόματο έλεγχο μιας άγνωστης πληρωμής: 5, 10, 20, 40 και μετά ανά 60 δευτ. */
export const retryDelayMs = (attempt: number) => Math.min(5000 * 2 ** attempt, 60_000);
