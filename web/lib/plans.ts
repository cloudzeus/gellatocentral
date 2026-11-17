// Υπολογισμός συνδρομής από το πακέτο: τιμή ανά κατάστημα + τιμή ανά είδος συσκευής, και έκπτωση εποχιακής παύσης.
// Καθαρές συναρτήσεις, χωρίς βάση. Ποσά σε λεπτά του ευρώ, προ ΦΠΑ.
//
// Κανόνες παύσης:
//  - Μια παύση δίνει έκπτωση μόνο αν κρατήσει τουλάχιστον MIN_PAUSE_DAYS ημέρες. Τότε μετρά από την πρώτη της ημέρα.
//  - Η έκπτωση είναι αναλογική ανά ημέρα: (100 − pausePercent)% της ημερήσιας τιμής του καταστήματος.
//  - Κάθε παύση δικαιούται το πολύ maxDays ημέρες έκπτωσης (όριο πακέτου ανά 12μηνο).
//  - Οι χρεώσεις βγαίνουν προκαταβολικά. Όση έκπτωση δεν είχε δοθεί ακόμα (ή δόθηκε και το κατάστημα άνοιξε νωρίτερα)
//    τακτοποιείται στην επόμενη χρέωση· το `settledThrough` κάθε παύσης θυμάται ως πού έχει δοθεί.

export const MIN_PAUSE_DAYS = 30;
const DAY = 864e5;
/** Ολόκληρες ημέρες από a έως b (ποτέ αρνητικές). */
export const daysBetween = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / DAY));

export type PlanPricing = { storeCents: number; devicePrices: Record<string, number>; pausePercent: number };
export type PauseSpan = { id: string; startedAt: Date; endedAt: Date | null; settledThrough: Date | null; maxDays: number };
export type StoreInput = { id: string; name: string; deviceKinds: string[]; pauses: PauseSpan[] };

/** Μηνιαία τιμή ενός καταστήματος με τις ενεργές συσκευές του. Είδος χωρίς τιμή στο πακέτο = δωρεάν. */
export function storeMonthly(plan: PlanPricing, deviceKinds: readonly string[]) {
  const devicesCents = deviceKinds.reduce((sum, k) => sum + (plan.devicePrices[k] ?? 0), 0);
  return { storeCents: plan.storeCents, devicesCents, fullCents: plan.storeCents + devicesCents };
}
/** Η τιμή του καταστήματος όσο είναι σε παύση. */
export const pausedMonthly = (plan: PlanPricing, fullCents: number) => Math.round((fullCents * plan.pausePercent) / 100);

/**
 * Πόσες ημέρες έκπτωσης πρέπει να δοθούν (ή να παρθούν πίσω, αν αρνητικό) για μια παύση σε αυτή τη χρέωση.
 * `asOf` = η στιγμή έκδοσης, `periodEnd` = το τέλος της περιόδου που χρεώνεται προκαταβολικά,
 * `billedFrom` = από πότε χρεώνεται η επιχείρηση: ημέρες πριν από αυτό (π.χ. δωρεάν δοκιμή) δεν πληρώθηκαν, άρα δεν εκπίπτουν.
 */
export function pauseSettlement(p: PauseSpan, asOf: Date, periodEnd: Date, billedFrom: Date = p.startedAt): { deltaDays: number; through: Date | null } {
  const lasted = daysBetween(p.startedAt, p.endedAt ?? asOf);
  const from = billedFrom > p.startedAt ? billedFrom : p.startedAt;
  const already = p.settledThrough ? daysBetween(from, p.settledThrough) : 0;
  // δεν έφτασε τις 30 ημέρες: καμία έκπτωση· αν είχε δοθεί (δεν θα έπρεπε), παίρνεται πίσω
  if (lasted < MIN_PAUSE_DAYS) return { deltaDays: already ? -already : 0, through: null };
  // παύση που συνεχίζεται: η έκπτωση δίνεται προκαταβολικά ως το τέλος της περιόδου
  const target = Math.min(daysBetween(from, p.endedAt ?? periodEnd), Math.max(0, p.maxDays));
  return { deltaDays: target - already, through: new Date(from.getTime() + target * DAY) };
}

export type ChargeLine = { storeId: string; name: string; storeCents: number; devicesCents: number; devices: number; fullCents: number; pauseDays: number; discountCents: number; cents: number };
/** Η χρέωση ενός μήνα: πλήρης τιμή κάθε καταστήματος μείον την έκπτωση για τις ημέρες παύσης που τακτοποιούνται τώρα. */
export function chargeFor(plan: PlanPricing, stores: readonly StoreInput[], asOf: Date, periodEnd: Date, billedFrom?: Date, creditCents = 0) {
  const settled: { pauseId: string; through: Date | null }[] = [];
  const lines: ChargeLine[] = stores.map((s) => {
    const m = storeMonthly(plan, s.deviceKinds);
    const daily = ((m.fullCents * 12) / 365) * ((100 - plan.pausePercent) / 100);
    let pauseDays = 0;
    for (const p of s.pauses) {
      const r = pauseSettlement(p, asOf, periodEnd, billedFrom);
      if (r.deltaDays !== 0 || (r.through?.getTime() ?? null) !== (p.settledThrough?.getTime() ?? null)) settled.push({ pauseId: p.id, through: r.through });
      pauseDays += r.deltaDays;
    }
    const discountCents = Math.round(daily * pauseDays);
    return { storeId: s.id, name: s.name, ...m, devices: s.deviceKinds.length, pauseDays, discountCents, cents: m.fullCents - discountCents };
  });
  // η έκπτωση μπορεί να ξεπεράσει τη χρέωση του μήνα (π.χ. αναδρομικά 45 ημέρες): το υπόλοιπο μένει πιστωτικό για την επόμενη
  const gross = lines.reduce((sum, l) => sum + l.cents, 0) - Math.max(0, creditCents);
  return { lines, usedCreditCents: Math.max(0, creditCents), totalCents: Math.max(0, gross), carryCents: Math.max(0, -gross), settled };
}

/** Η τρέχουσα μηνιαία εικόνα (χωρίς τακτοποιήσεις): τι πληρώνει κάθε κατάστημα όπως είναι σήμερα. */
export function monthlyPreview(plan: PlanPricing, stores: readonly { id: string; name: string; deviceKinds: string[]; paused: boolean }[]) {
  const lines = stores.map((s) => { const m = storeMonthly(plan, s.deviceKinds); return { ...s, ...m, cents: s.paused ? pausedMonthly(plan, m.fullCents) : m.fullCents }; });
  return { lines, totalCents: lines.reduce((sum, l) => sum + l.cents, 0), fullCents: lines.reduce((sum, l) => sum + l.fullCents, 0) };
}

/** Πόσες ημέρες έκπτωσης μένουν σε ένα κατάστημα: όριο πακέτου μείον όσες ημέρες παύσης είχε το τελευταίο 12μηνο. */
export function pauseDaysLeft(maxPerYear: number, pauses: readonly { startedAt: Date; endedAt: Date | null }[], now: Date) {
  const from = new Date(now.getTime() - 365 * DAY);
  const used = pauses.reduce((sum, p) => sum + daysBetween(p.startedAt > from ? p.startedAt : from, p.endedAt ?? now), 0);
  return Math.max(0, maxPerYear - used);
}
