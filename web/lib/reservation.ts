// Κανόνες κρατήσεων χωρίς βάση: επικάλυψη, κατάσταση στη λίστα του ταμείου, πληρότητα ανά ώρα, απόκρυψη τηλεφώνου.
// Ίδιοι κανόνες (απλοποιημένοι) και στο mobile/till.ts για τη φόρμα νέας κράτησης.

export type ReservationStatus = "BOOKED" | "SEATED" | "DONE" | "NO_SHOW" | "CANCELLED";
export type Booking = { id: string; tableId: string | null; startsAt: Date; durationMin: number; guests: number; status: ReservationStatus };
/** Τι δείχνει το ταμείο: «αργεί», «σε 15′», «αργότερα», «κάθισαν», «έφυγαν», «δεν ήρθαν», «ακυρώθηκε». */
export type Phase = "late" | "soon" | "later" | "seated" | "done" | "no_show" | "cancelled";

export const LATE_AFTER_MIN = 10; // μετά από τόσα λεπτά η κράτηση «αργεί»
export const SOON_MIN = 60; // μέσα σε τόσα λεπτά η κράτηση φαίνεται πάνω στο τραπέζι
const MIN = 60_000;

/** Πιάνει το τραπέζι: κλεισμένη ή καθισμένη. */
export const isActive = (s: ReservationStatus) => s === "BOOKED" || s === "SEATED";

export const overlaps = (aStart: Date, aMin: number, bStart: Date, bMin: number) =>
  aStart.getTime() < bStart.getTime() + bMin * MIN && bStart.getTime() < aStart.getTime() + aMin * MIN;

/** Η πρώτη ενεργή κράτηση του τραπεζιού που πέφτει πάνω στο διάστημα (εκτός από την ίδια, όταν αλλάζει). */
export const tableClash = (all: Booking[], tableId: string, startsAt: Date, durationMin: number, exceptId?: string) =>
  all.find((r) => r.id !== exceptId && r.tableId === tableId && isActive(r.status) && overlaps(r.startsAt, r.durationMin, startsAt, durationMin)) ?? null;

/**
 * Κατάσταση για την οθόνη. Καθισμένη με κλειστό λογαριασμό = «έφυγαν» (ο λογαριασμός κλείνει στο ταμείο,
 * δεν χρειάζεται δεύτερο κουμπί).
 */
export function phase(r: Pick<Booking, "startsAt" | "status">, now: Date, billOpen = false): Phase {
  if (r.status === "SEATED") return billOpen ? "seated" : "done";
  if (r.status === "DONE") return "done";
  if (r.status === "NO_SHOW") return "no_show";
  if (r.status === "CANCELLED") return "cancelled";
  const mins = (r.startsAt.getTime() - now.getTime()) / MIN;
  if (mins < -LATE_AFTER_MIN) return "late";
  return mins <= SOON_MIN ? "soon" : "later";
}

/** Πληρότητα ανά ώρα της ημέρας (0–23): άτομα σε ενεργές κρατήσεις που πιάνουν την ώρα / θέσεις του καταστήματος, σε %. */
export function hourlyLoad(all: Booking[], dayStart: Date, seats: number): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    const hour = new Date(dayStart.getTime() + h * 60 * MIN);
    const guests = all.filter((r) => isActive(r.status) && overlaps(r.startsAt, r.durationMin, hour, 60)).reduce((s, r) => s + r.guests, 0);
    return seats > 0 ? Math.round((guests / seats) * 100) : 0;
  });
}

/** Το τηλέφωνο στη λίστα: φαίνονται τα 2 πρώτα και τα 3 τελευταία ψηφία. */
export function maskPhone(phone: string | null): string | null {
  const d = phone?.replace(/\D/g, "") ?? "";
  if (d.length < 6) return d ? "•••" : null;
  return `${d.slice(0, 2)}•• ••• ${d.slice(-3)}`;
}

/** Τηλέφωνο για αποθήκευση και αναζήτηση: μόνο ψηφία, χωρίς το +30 της Ελλάδας. */
export const normalizePhone = (phone: string) => phone.replace(/\D/g, "").replace(/^0030|^30(?=\d{10}$)/, "");
