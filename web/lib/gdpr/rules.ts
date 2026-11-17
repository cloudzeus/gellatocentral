// Κανόνες GDPR χωρίς βάση και δίκτυο (για να ελέγχονται με tests): σκοποί συναίνεσης, τρέχουσα κατάσταση,
// προθεσμίες, αποτυπώματα. Η εκτέλεση ζει στο lib/gdpr/index.ts.
import { createHash } from "node:crypto";

/**
 * Οι σκοποί για τους οποίους ζητείται συναίνεση. `audience`: σε ποιο είδος υποκειμένου απευθύνεται.
 * `required`: χωρίς αυτήν δεν χρησιμοποιείται η εφαρμογή (αποδοχή όρων)· οι υπόλοιπες δίνονται και ανακαλούνται ελεύθερα.
 * Νέος σκοπός = μία γραμμή εδώ.
 */
export const PURPOSES = {
  legal: { label: "Όροι χρήσης και πολιτική απορρήτου", audience: "user", required: true, version: null, hint: "Η έκδοση ορίζεται στις Ρυθμίσεις της πλατφόρμας" },
  marketing: { label: "Νέα και προσφορές της πλατφόρμας με email", audience: "user", required: false, version: "1", hint: "Ενημερώσεις για νέες λειτουργίες. Ανακαλείται όποτε θέλεις" },
  customer_marketing: { label: "Ενημερώσεις και προσφορές της επιχείρησης", audience: "customer", required: false, version: "1", hint: "Για τους πελάτες της επιχείρησης (email, SMS)" },
} as const satisfies Record<string, { label: string; audience: string; required: boolean; version: string | null; hint: string }>;
export type Purpose = keyof typeof PURPOSES;
export const isPurpose = (v: unknown): v is Purpose => typeof v === "string" && v in PURPOSES;

export const SUBJECT_TYPES = { user: "Χρήστης της εφαρμογής", customer: "Πελάτης", external: "Πρόσωπο εκτός εφαρμογής" } as const;
export type SubjectType = keyof typeof SUBJECT_TYPES;
export const isSubjectType = (v: unknown): v is SubjectType => typeof v === "string" && v in SUBJECT_TYPES;

export const EVENTS = {
  CONSENT_GRANTED: "Δόθηκε συναίνεση",
  CONSENT_WITHDRAWN: "Ανακλήθηκε συναίνεση",
  EXPORT: "Λήψη αντιγράφου δεδομένων",
  ERASURE_REQUESTED: "Αίτημα διαγραφής",
  ERASURE_REJECTED: "Απόρριψη αιτήματος διαγραφής",
  ERASURE_COMPLETED: "Διαγραφή δεδομένων",
} as const;
export type EventType = keyof typeof EVENTS;

type Row = { purpose: string; version: string; granted: boolean; at: Date };
/** Η τρέχουσα κατάσταση ανά σκοπό: μετρά η πιο πρόσφατη γραμμή. */
export function currentConsents<T extends Row>(rows: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of [...rows].sort((a, b) => a.at.getTime() - b.at.getTime())) out.set(r.purpose, r);
  return out;
}
/** Ισχύει συναίνεση για τον σκοπό στη ζητούμενη έκδοση; Παλαιότερη έκδοση ή ανάκληση = όχι. */
export const hasConsent = (rows: Row[], purpose: string, version: string) => {
  const c = currentConsents(rows).get(purpose);
  return !!c && c.granted && c.version === version;
};

/** Προθεσμία απάντησης: ένας μήνας από τη λήψη του αιτήματος (άρθρο 12 παρ. 3 ΓΚΠΔ). Εδώ: 30 ημέρες. */
export const DUE_DAYS = 30;
export const dueDate = (requestedAt: Date) => new Date(requestedAt.getTime() + DUE_DAYS * 864e5);
/** Ημέρες που απομένουν (αρνητικό = εκπρόθεσμο). */
export const daysLeft = (dueAt: Date, now = new Date()) => Math.ceil((dueAt.getTime() - now.getTime()) / 864e5);

/** Αποτύπωμα ενός email ή ονόματος: αναγνωρίζει το ίδιο υποκείμενο αργότερα χωρίς να κρατά το στοιχείο. */
export const subjectHash = (value: string) => createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

export const ERASED_NAME = "Διαγραμμένος χρήστης";
