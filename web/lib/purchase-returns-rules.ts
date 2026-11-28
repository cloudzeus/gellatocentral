// Καθαροί κανόνες επιστροφών/πιστωτικών προμηθευτή (δοκιμάζονται με node --test χωρίς βάση).
import { PurchaseError } from "./purchases.ts";

export type LineQty = { lineId: string; quantity: number };

/** Pure: πόσα μένουν να επιστραφούν ανά γραμμή τιμολογίου (παραλήφθηκαν μείον όσα ήδη επιστράφηκαν). */
export function returnable(invoiceLines: readonly { id: string; quantity: number }[], prior: readonly { sourceLineId: string | null; quantity: number }[]) {
  const used = new Map<string, number>();
  for (const p of prior) if (p.sourceLineId) used.set(p.sourceLineId, (used.get(p.sourceLineId) ?? 0) + p.quantity);
  return new Map(invoiceLines.map((l) => [l.id, Math.max(0, l.quantity - (used.get(l.id) ?? 0))]));
}

/** Pure: οι ποσότητες της φόρμας μέσα στα όρια· κρατά μόνο τις θετικές. */
export function checkQuantities(requested: readonly LineQty[], left: ReadonlyMap<string, number>, names: ReadonlyMap<string, string>) {
  const picked = requested.filter((r) => r.quantity > 0);
  if (!picked.length) throw new PurchaseError("Γράψε ποσότητα σε τουλάχιστον μία γραμμή");
  for (const r of picked) {
    if (!Number.isInteger(r.quantity)) throw new PurchaseError("Οι ποσότητες είναι ακέραιες");
    const max = left.get(r.lineId);
    if (max === undefined) throw new PurchaseError("Η γραμμή δεν ανήκει στο τιμολόγιο");
    if (r.quantity > max) throw new PurchaseError(`«${names.get(r.lineId)}»: μπορείς να επιστρέψεις έως ${max}`);
  }
  return picked;
}

/** Pure: τι μένει να πιστωθεί για μια επιστροφή (για «Περιμένει πιστωτικό»). */
export const awaitingCredit = (returnTotal: number, credited: number) => Math.max(0, returnTotal - credited);
