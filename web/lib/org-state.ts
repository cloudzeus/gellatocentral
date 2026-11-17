// Η κατάσταση μιας επιχείρησης απέναντι στην πλατφόρμα και τι της επιτρέπει. Καθαρές συναρτήσεις, χωρίς βάση.
//  ok         όλα ανοιχτά
//  grace      η συνδρομή έληξε πριν από λίγες ημέρες: όλα ανοιχτά, με προειδοποίηση
//  unpaid     πέρασε και η περίοδος χάριτος (ή η συνδρομή ακυρώθηκε): περιορισμένη λειτουργία
//  suspended  αναστολή από την πλατφόρμα: περιορισμένη λειτουργία
//  closing    η επιχείρηση κλείνει: περιορισμένη λειτουργία και εξαγωγή δεδομένων μέχρι τη διαγραφή
// Περιορισμένη λειτουργία = κλειστό ταμείο και ενότητες· μένουν οι αποδείξεις που έχουν εκδοθεί (φορολογικό αρχείο),
// η συνδρομή για να πληρώσει, οι χρήστες, το GDPR και η υποστήριξη.
export const GRACE_DAYS = 7;
export const CLOSING_DAYS = 30;
export const RESTRICTED_MODULES = ["receipts"] as const;
const DAY = 864e5;

export type OrgStateInput = { suspendedAt: Date | null; closingAt: Date | null; deleteAfter: Date | null; subscription: { status: string; currentPeriodEnd: Date } | null };
export type OrgState = { kind: "ok" | "grace" | "unpaid" | "suspended" | "closing"; restricted: boolean; daysLeft: number | null };

export function orgState(o: OrgStateInput, now: Date): OrgState {
  const left = (until: Date) => Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY));
  if (o.closingAt) return { kind: "closing", restricted: true, daysLeft: o.deleteAfter ? left(o.deleteAfter) : null };
  if (o.suspendedAt) return { kind: "suspended", restricted: true, daysLeft: null };
  const sub = o.subscription;
  if (!sub) return { kind: "ok", restricted: false, daysLeft: null }; // δεν έχει στηθεί ακόμα συνδρομή
  if (sub.status === "CANCELLED") return { kind: "unpaid", restricted: true, daysLeft: null };
  if (sub.currentPeriodEnd >= now) return { kind: "ok", restricted: false, daysLeft: null };
  const graceEnds = new Date(sub.currentPeriodEnd.getTime() + GRACE_DAYS * DAY);
  return graceEnds > now ? { kind: "grace", restricted: false, daysLeft: left(graceEnds) } : { kind: "unpaid", restricted: true, daysLeft: null };
}

/** Η οριστική διαγραφή επιτρέπεται μόνο σε επιχείρηση που κλείνει και αφού περάσει η προθεσμία εξαγωγής. */
export const canDelete = (o: { closingAt: Date | null; deleteAfter: Date | null }, now: Date) => !!o.closingAt && !!o.deleteAfter && o.deleteAfter <= now;
