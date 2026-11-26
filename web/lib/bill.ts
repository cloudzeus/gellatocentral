// Ανοιχτός λογαριασμός («κουβάς»): τι πληρώθηκε, τι μένει. Καθαρή λογική, χωρίς βάση.
// Μια γραμμή πληρώνεται από μία ή περισσότερες αποδείξεις (SaleLine.billLineId). Μετράνε οι ολοκληρωμένες, και
// δεσμεύονται όσες περιμένουν πληρωμή: αλλιώς δύο συσκευές θα χρέωναν την ίδια γραμμή ταυτόχρονα.

export type SaleState = "DRAFT" | "AWAITING_PAYMENT" | "COMPLETED" | "CANCELLED";
export type BillLineState = {
  id: string;
  quantity: number;
  unitPriceCents: number;
  voidedAt: Date | null;
  saleLines: { quantity: number; sale: { status: SaleState } }[];
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const taken = (l: BillLineState, statuses: SaleState[]) => sum(l.saleLines.filter((s) => statuses.includes(s.sale.status)).map((s) => s.quantity));

/** Ποσότητα που μένει να πληρωθεί σε κάθε γραμμή (οι ακυρωμένες δεν χρωστάνε τίποτα). */
export function remaining(l: BillLineState) {
  if (l.voidedAt) return 0;
  return Math.max(0, l.quantity - taken(l, ["COMPLETED", "AWAITING_PAYMENT"]));
}

export function paidQuantity(l: BillLineState) {
  return taken(l, ["COMPLETED"]);
}

/** Σύνολα λογαριασμού σε λεπτά: ό,τι παραγγέλθηκε (χωρίς ακυρωμένα), ό,τι πληρώθηκε, ό,τι χρωστάει ακόμα. */
export function billTotals(lines: BillLineState[]) {
  const live = lines.filter((l) => !l.voidedAt);
  const totalCents = sum(live.map((l) => l.quantity * l.unitPriceCents));
  const paidCents = sum(live.map((l) => paidQuantity(l) * l.unitPriceCents));
  const dueCents = sum(live.map((l) => remaining(l) * l.unitPriceCents));
  return { totalCents, paidCents, dueCents, pendingCents: totalCents - paidCents - dueCents };
}

/** Ο λογαριασμός κλείνει όταν δεν χρωστάει τίποτα και καμία πληρωμή δεν είναι σε εξέλιξη. */
export function isSettled(lines: BillLineState[]) {
  return lines.every((l) => l.voidedAt || paidQuantity(l) >= l.quantity);
}

/** Μια γραμμή ακυρώνεται μόνο αν δεν έχει αγγίξει καμία απόδειξη (πληρωμένη ή σε εξέλιξη). */
export function canVoid(l: BillLineState) {
  return !l.voidedAt && taken(l, ["COMPLETED", "AWAITING_PAYMENT"]) === 0;
}

/** Μέρος του λογαριασμού που πληρώνει ένας πελάτης (μοίρασμα ανά είδη): γραμμή και πόσα τεμάχια της. */
export type BillPick = { lineId: string; quantity: number };

/**
 * Ό,τι διάλεξε ο ταμίας, απέναντι σε ό,τι μένει (due: γραμμή και υπόλοιπο). null όταν ζητά περισσότερα από όσα μένουν:
 * άλλη συσκευή πλήρωσε ή ακύρωσε στο μεταξύ. Η ίδια γραμμή δύο φορές μετράει μαζί.
 */
export function pickDue<L extends { id: string }>(due: { l: L; q: number }[], pick: BillPick[]) {
  const want = new Map<string, number>();
  for (const p of pick) want.set(p.lineId, (want.get(p.lineId) ?? 0) + p.quantity);
  for (const [id, q] of want) if (q > (due.find((d) => d.l.id === id)?.q ?? 0)) return null;
  return due.flatMap((d) => (want.get(d.l.id) ? [{ l: d.l, q: want.get(d.l.id)! }] : []));
}
