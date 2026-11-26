// Σύνολα βάρδιας ταμείου από τις κινήσεις χρημάτων (χωρίς βάση, για να ελέγχεται μόνο του).

const athensHour = (d: Date) => Number(d.toLocaleString("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", hourCycle: "h23" }));

/** Μία κίνηση χρημάτων: είσπραξη (θετική) ή επιστροφή (αρνητική). */
export type Movement = { at: Date; cents: number; cash: boolean; refund?: boolean };
export type Figures = {
  incomeCents: number; cardCents: number; cashCents: number; receipts: number;
  refunds: number; refundCents: number; refundCashCents: number;
  hours: { h: number; card: number; cash: number }[];
};

/** Σύνολα και ωριαίο γράφημα από τις κινήσεις. receipts: πόσες αποδείξεις κόπηκαν (μετριούνται χωριστά). */
export function sumMovements(moves: Movement[], receipts: number): Figures {
  const f: Figures = { incomeCents: 0, cardCents: 0, cashCents: 0, receipts, refunds: 0, refundCents: 0, refundCashCents: 0, hours: [] };
  const byHour = new Map<number, { card: number; cash: number }>();
  for (const m of moves) {
    if (m.refund) {
      f.refunds += 1; f.refundCents += m.cents;
      if (m.cash) f.refundCashCents += m.cents;
      continue;
    }
    f.incomeCents += m.cents;
    if (m.cash) f.cashCents += m.cents; else f.cardCents += m.cents;
    const h = athensHour(m.at);
    const b = byHour.get(h) ?? { card: 0, cash: 0 };
    if (m.cash) b.cash += m.cents; else b.card += m.cents;
    byHour.set(h, b);
  }
  const hs = [...byHour.keys()];
  if (hs.length) for (let h = Math.min(...hs); h <= Math.max(...hs); h++) f.hours.push({ h, ...(byHour.get(h) ?? { card: 0, cash: 0 }) });
  return f;
}

/** Πόσα πρέπει να έχει το συρτάρι: έναρξη + μετρητά που μπήκαν − μετρητά που επιστράφηκαν. */
export const expectedCash = (openingCents: number, f: Figures) => openingCents + f.cashCents - f.refundCashCents;
