// Καθαρή λογική του ταμείου (χωρίς React), κοινή για την εφαρμογή Android και το ταμείο του browser (/pos). Ελέγχεται με `npm test` του mobile.
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

/** «Ίσα σε N»: μερίδια που αθροίζουν ακριβώς στο ποσό· τα πρώτα παίρνουν το λεπτό που περισσεύει. */
export const equalSplit = (cents: number, n: number) => Array.from({ length: n }, (_, i) => Math.floor(cents / n) + (i < cents % n ? 1 : 0));

/** Αναμονή πριν από τον επόμενο αυτόματο έλεγχο μιας άγνωστης πληρωμής: 5, 10, 20, 40 και μετά ανά 60 δευτ. */
export const retryDelayMs = (attempt: number) => Math.min(5000 * 2 ** attempt, 60_000);

// ---- Επιλογές προϊόντος (γεύσεις, έξτρα, «χωρίς») ----
// Ίδιοι κανόνες με τον server (web/lib/pos-modifiers.ts)· ο server ξαναελέγχει και τιμολογεί πάντα μόνος του.

export type Group = { id: string; name: string; kind: "REQUIRED" | "EXTRA" | "REMOVE"; pick: number; options: { id: string; name: string; priceCents: number }[] };

/** Πάτημα επιλογής. chosen = όλες οι επιλογές της γραμμής με τη σειρά που πατήθηκαν (η ίδια γεύση μπορεί δύο φορές).
 *  Υποχρεωτική ομάδα: προσθέτει· όταν είναι γεμάτη, βγαίνει η παλαιότερη. Έξτρα / «χωρίς»: ανάβει ή σβήνει. */
export function tapOption(chosen: readonly string[], group: Group, id: string): string[] {
  if (group.kind !== "REQUIRED") return chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
  const mine = new Set(group.options.map((o) => o.id));
  const oldest = chosen.findIndex((x) => mine.has(x));
  const full = chosen.filter((x) => mine.has(x)).length >= group.pick;
  return full ? [...chosen.slice(0, oldest), ...chosen.slice(oldest + 1), id] : [...chosen, id];
}

/** Βγάζει μία φορά την επιλογή (την τελευταία που μπήκε). */
export function dropOption(chosen: readonly string[], id: string): string[] {
  const i = chosen.lastIndexOf(id);
  return i < 0 ? [...chosen] : [...chosen.slice(0, i), ...chosen.slice(i + 1)];
}

/** Πόσες λείπουν από κάθε υποχρεωτική ομάδα (0 = έτοιμη). */
export const missingIn = (group: Group, chosen: readonly string[]) =>
  group.kind === "REQUIRED" ? Math.max(0, group.pick - chosen.filter((x) => group.options.some((o) => o.id === x)).length) : 0;

/** Τιμή μονάδας με τις επιλογές· το «χωρίς» δεν χρεώνεται ποτέ. */
export function unitPrice(baseCents: number, groups: readonly Group[], chosen: readonly string[]) {
  let cents = baseCents;
  for (const id of chosen) for (const g of groups) {
    const o = g.options.find((x) => x.id === id);
    if (o && g.kind !== "REMOVE") cents += o.priceCents;
  }
  return cents;
}
