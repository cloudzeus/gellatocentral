// Κρατήσεις τραπεζιών στο ταμείο: οι κανόνες της φόρμας (ποιες ώρες χωρούν, ποια τραπέζια είναι πιασμένα).
// Οι ίδιοι κανόνες ισχύουν και στον server (web/lib/reservation.ts), που έχει τον τελευταίο λόγο.

export type Phase = "late" | "soon" | "later" | "seated" | "done" | "no_show" | "cancelled";
export type Reservation = {
  id: string; tableId: string | null; tableName: string | null; startsAt: string; durationMin: number; guests: number;
  name: string; phone: string | null; note: string | null; status: "BOOKED" | "SEATED" | "DONE" | "NO_SHOW" | "CANCELLED"; billId: string | null; phase: Phase;
};
export type Day = { date: string; seats: number; load: number[]; reservations: Reservation[] };
export type Guest = {
  name: string; visits: number; noShows: number; lastNote: string | null;
  // παλιός server χωρίς τα πεδία: λείπουν
  usual?: { name: string; visits: number; of: number }[]; lastVisits?: { at: string; guests: number; table: string | null; totalCents: number }[]; favouriteTable?: string | null;
};
export type NewReservation = { tableId?: string | null; startsAt: string; guests: number; name: string; phone?: string; note?: string };

export const DURATION_MIN = 90;
const MIN = 60_000;
const active = (r: Pick<Reservation, "status">) => r.status === "BOOKED" || r.status === "SEATED";
const overlaps = (aStart: number, aMin: number, bStart: number, bMin: number) => aStart < bStart + bMin * MIN && bStart < aStart + aMin * MIN;

/** Ημερομηνία συσκευής ως YYYY-MM-DD (το ταμείο είναι στην ώρα Ελλάδας), μετατοπισμένη κατά `offset` ημέρες. */
export function isoDay(base: Date, offset = 0) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Οι ώρες που προσφέρει η φόρμα: ανά 30′ από 12:00 ως 23:30, χωρίς όσες πέρασαν (σήμερα). */
export function slots(date: string, now: Date): Date[] {
  const [y, m, d] = date.split("-").map(Number);
  return Array.from({ length: 24 }, (_, i) => new Date(y, m - 1, d, 12 + Math.floor(i / 2), (i % 2) * 30)).filter((s) => s.getTime() > now.getTime() - 15 * MIN);
}

/** Τα τραπέζια που έχουν ενεργή κράτηση πάνω στο διάστημα. */
export const busyTables = (all: Reservation[], at: Date, durationMin = DURATION_MIN) =>
  new Set(all.filter((r) => r.tableId && active(r) && overlaps(new Date(r.startsAt).getTime(), r.durationMin, at.getTime(), durationMin)).map((r) => r.tableId!));

/** Χωράει η παρέα εκείνη την ώρα; Άτομα σε ενεργές κρατήσεις που πέφτουν πάνω της + η παρέα ≤ θέσεις. */
export function fits(all: Reservation[], seats: number, at: Date, guests: number, durationMin = DURATION_MIN) {
  const booked = all.filter((r) => active(r) && overlaps(new Date(r.startsAt).getTime(), r.durationMin, at.getTime(), durationMin)).reduce((s, r) => s + r.guests, 0);
  return booked + guests <= seats;
}

/** Η επόμενη ενεργή κράτηση κάθε τραπεζιού (για την κάτοψη), όσο δεν έχει καθίσει. */
export function nextByTable(all: Reservation[]) {
  const next = new Map<string, Reservation>();
  for (const r of all) if (r.tableId && r.status === "BOOKED" && !next.has(r.tableId)) next.set(r.tableId, r); // η λίστα έρχεται ταξινομημένη κατά ώρα
  return next;
}

export const hhmm = (iso: string | Date) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
/** «σε 15′», «σε 1 ώ 20′», «αργεί 12′». */
export function untilText(iso: string, now: Date) {
  const m = Math.round((new Date(iso).getTime() - now.getTime()) / MIN);
  if (m < 0) return `αργεί ${-m}′`;
  return m < 60 ? `σε ${m}′` : `σε ${Math.floor(m / 60)} ώ ${String(m % 60).padStart(2, "0")}′`;
}
