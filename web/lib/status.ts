// Ένα σημείο για το «τι σημαίνει» κάθε κατάσταση: λέξη σε απλά ελληνικά + τόνος. Το εικονίδιο βγαίνει από τον τόνο,
// ώστε το ίδιο χρώμα να λέει παντού το ίδιο πράγμα:
//   danger  + TriangleAlert → θέλει ενέργεια τώρα      warning + Clock → πλησιάζει ή περιμένει κάποιον
//   success + Check         → τελείωσε καλά             neutral, χωρίς εικονίδιο → πρόχειρο, ακυρωμένο, αρχείο
// Καθαρό TypeScript (χωρίς JSX), για να ελέγχεται με node --test· το <StatusBadge> είναι στο components/status-badge.tsx.

export type Tone = "neutral" | "success" | "warning" | "danger";
export type StatusIcon = "TriangleAlert" | "Clock" | "Check" | null;
export type StatusLook = { tone: Tone; text: string; icon: StatusIcon };

const ICON: Record<Tone, StatusIcon> = { danger: "TriangleAlert", warning: "Clock", success: "Check", neutral: null };
export const look = (tone: Tone, text: string): StatusLook => ({ tone, text, icon: ICON[tone] });

type Entry = readonly [tone: Tone, text: string];
const STATUS = {
  // Απόδειξη λιανικής και διαβίβασή της
  sale: { DRAFT: ["neutral", "Πρόχειρη"], AWAITING_PAYMENT: ["warning", "Περιμένει πληρωμή"], COMPLETED: ["success", "Ολοκληρώθηκε"], CANCELLED: ["neutral", "Ακυρώθηκε"] },
  fiscal: { SIGNED: ["success", "Διαβιβάστηκε στην ΑΑΔΕ"], PENDING: ["warning", "Σε εξέλιξη"], NOT_SENT: ["warning", "Δοκιμαστική — δεν διαβιβάστηκε"], FAILED: ["danger", "Απέτυχε — θέλει ενέργεια"] },
  // Αγορές
  purchaseOrder: { DRAFT: ["neutral", "Πρόχειρη"], SENT: ["warning", "Στάλθηκε — περιμένει παραλαβή"], PARTIAL: ["warning", "Μερική παραλαβή"], RECEIVED: ["success", "Παραλήφθηκε"], CANCELLED: ["neutral", "Ακυρώθηκε"] },
  purchase: { DRAFT: ["neutral", "Πρόχειρο"], POSTED: ["success", "Καταχωρήθηκε"], CANCELLED: ["neutral", "Ακυρώθηκε"] },
  rfq: { OPEN: ["warning", "Περιμένει προσφορές"], CLOSED: ["neutral", "Έκλεισε"] },
  // Χονδρική
  wholesaleOrder: { DRAFT: ["neutral", "Πρόχειρη"], CONFIRMED: ["warning", "Επιβεβαιώθηκε — περιμένει παράδοση"], DELIVERED: ["success", "Παραδόθηκε"], INVOICED: ["success", "Τιμολογήθηκε"], CANCELLED: ["neutral", "Ακυρώθηκε"] },
  wholesaleQuote: { DRAFT: ["neutral", "Πρόχειρη"], SENT: ["warning", "Στάλθηκε — περιμένει τον πελάτη"], ACCEPTED: ["success", "Έγινε αποδεκτή"], REJECTED: ["danger", "Απορρίφθηκε"], EXPIRED: ["neutral", "Έληξε"] },
  salesDocument: { ISSUED: ["success", "Εκδόθηκε"], CANCELLED: ["neutral", "Ακυρώθηκε"] },
  deliveryRoute: { PLANNED: ["warning", "Προγραμματισμένο"], COMPLETED: ["success", "Ολοκληρώθηκε"] },
  // Αποθήκη και παραγωγή
  stockCount: { DRAFT: ["neutral", "Προσχέδιο"], FINALIZED: ["success", "Οριστικοποιήθηκε"] },
  stockHold: { AVAILABLE: ["success", "Διαθέσιμη"], HELD: ["danger", "Σε δέσμευση"], RELEASED: ["success", "Αποδεσμεύτηκε"], REJECTED: ["danger", "Απορρίφθηκε"] },
  productionPlan: { PLANNED: ["warning", "Προγραμματισμένη"], IN_PROGRESS: ["warning", "Σε εξέλιξη"], COMPLETED: ["success", "Ολοκληρώθηκε"], CANCELLED: ["neutral", "Ακυρώθηκε"] },
  productionClose: { RUNNING: ["warning", "Σε εξέλιξη"], COMPLETED: ["success", "Ολοκληρώθηκε"] },
  // HACCP
  haccpRecord: { DRAFT: ["neutral", "Πρόχειρη"], COMPLETED: ["success", "Ολοκληρώθηκε"] },
  haccpResult: { CONFORMING: ["success", "Συμμορφώνεται"], DEVIATION: ["danger", "Απόκλιση"], NA: ["neutral", "Δεν εφαρμόζεται"] },
  haccpSeverity: { HIGH: ["danger", "Κρίσιμο"], MEDIUM: ["warning", "Προσοχή"], LOW: ["neutral", "Παρατήρηση"] },
  sourceCheck: { OK: ["success", "Χωρίς αλλαγή"], CHANGED: ["warning", "Άλλαξε — δες τι"], REVIEW: ["warning", "Πρώτος έλεγχος"], ERROR: ["danger", "Δεν ελέγχθηκε — σφάλμα"], NOT_CHECKED: ["neutral", "Δεν έχει ελεγχθεί"] },
  // Οικονομικά και μισθοδοσία
  cashClosing: { CLOSED: ["success", "Κλειστό"], REOPENED: ["warning", "Άνοιξε ξανά για διόρθωση"] },
  statementRow: { MATCHED: ["success", "Ταίριαξε"], UNMATCHED: ["warning", "Χωρίς αντιστοίχιση"], AMBIGUOUS: ["warning", "Θέλει επιλογή"], CONFLICT: ["danger", "Σύγκρουση"] },
  payrollBatch: { PREPARED: ["warning", "Έτοιμη — περιμένει εκτέλεση"], PROCESSING: ["warning", "Σε εξέλιξη"], SUCCEEDED: ["success", "Πληρώθηκε"], FAILED: ["danger", "Απέτυχε οριστικά"], UNCERTAIN: ["danger", "Θέλει συμψηφισμό"] },
  payrollExecution: { NOT_EXECUTED: ["neutral", "Προετοιμασμένη"], PROCESSING: ["warning", "Σε εξέλιξη"], SUCCEEDED: ["success", "Επιβεβαιώθηκε"], FAILED: ["danger", "Απέτυχε οριστικά"], UNCERTAIN: ["danger", "Θέλει συμψηφισμό"] },
  // Συνδρομή, πλατφόρμα, υποστήριξη
  subscription: { TRIALING: ["warning", "Δοκιμαστική"], ACTIVE: ["success", "Ενεργή"], PAST_DUE: ["danger", "Ληξιπρόθεσμη"], CANCELLED: ["neutral", "Ακυρώθηκε"] },
  email: { SENT: ["success", "Στάλθηκε"], FAILED: ["danger", "Απέτυχε"], SKIPPED: ["danger", "Δεν στάλθηκε"] },
  erasure: { PENDING: ["warning", "Ανοιχτό"], COMPLETED: ["success", "Ολοκληρώθηκε"], REJECTED: ["neutral", "Απορρίφθηκε"] },
  ticket: { NEW: ["warning", "Νέο"], OPEN: ["warning", "Σε εξέλιξη"], WAITING_CUSTOMER: ["warning", "Περιμένει τον πελάτη"], RESOLVED: ["success", "Λύθηκε"], CLOSED: ["neutral", "Κλειστό"] },
  ticketCustomer: { NEW: ["warning", "Το λάβαμε"], OPEN: ["warning", "Σε εξέλιξη"], WAITING_CUSTOMER: ["warning", "Απαντήθηκε: περιμένει εσένα"], RESOLVED: ["success", "Λύθηκε"], CLOSED: ["neutral", "Κλειστό"] },
  ticketPriority: { CRITICAL: ["danger", "Κρίσιμο"], HIGH: ["warning", "Υψηλό"], NORMAL: ["neutral", "Κανονικό"], LOW: ["neutral", "Χαμηλό"] },
  kb: { DRAFT: ["neutral", "Πρόχειρο"], REVIEW: ["warning", "Προς έγκριση"], PUBLISHED: ["success", "Δημοσιευμένο"], RETIRED: ["neutral", "Αποσυρμένο"] },
  enrichment: { pending: ["neutral", "Δεν έχει εμπλουτιστεί"], enriched: ["success", "Εμπλουτίστηκε"], review: ["warning", "Θέλει έλεγχο"], error: ["danger", "Απέτυχε ο εμπλουτισμός"] },
  migrationRun: { DRY_RUN: ["neutral", "Δοκιμή"], IMPORTED: ["success", "Πέρασε"], ROLLED_BACK: ["neutral", "Αναιρέθηκε"] },
  migrationCutover: { PREPARING: ["warning", "Σε προετοιμασία"], FROZEN: ["warning", "Παγωμένο το παλιό σύστημα"], DELTA_IMPORTED: ["warning", "Πέρασαν οι τελευταίες αλλαγές"], READY: ["warning", "Έτοιμο για ενεργοποίηση"], ACTIVE: ["success", "Ενεργό"], ROLLED_BACK: ["neutral", "Αναιρέθηκε"] },
  account: { active: ["success", "Ενεργός"], pending: ["warning", "Εκκρεμεί η πρόσκληση"], disabled: ["neutral", "Απενεργοποιημένος"] },
  // Εργασίες του παραθύρου «Εργασίες» (lib/tasks.ts)
  task: { RUNNING: ["warning", "Τρέχει"], DONE: ["success", "Έγινε"], PARTIAL: ["warning", "Έγινε εν μέρει"], FAILED: ["danger", "Απέτυχε"] },
} as const satisfies Record<string, Record<string, Entry>>;

export type StatusKind = keyof typeof STATUS;
export const STATUS_KINDS = Object.keys(STATUS) as StatusKind[];

/** Η εμφάνιση μιας κατάστασης. Άγνωστη τιμή (νέο enum που δεν χαρτογραφήθηκε) δεν δείχνει ποτέ το αγγλικό της όνομα. */
export function statusOf(kind: StatusKind, value: string | null | undefined): StatusLook {
  const entry = (STATUS[kind] as Record<string, Entry>)[value ?? ""];
  return entry ? look(entry[0], entry[1]) : look("neutral", "Άγνωστη κατάσταση");
}

/** Οι επιλογές ενός φίλτρου κατάστασης, με τις ίδιες λέξεις που δείχνει η ετικέτα. */
export const statusOptions = (kind: StatusKind): [string, string][] => Object.entries(STATUS[kind] as Record<string, Entry>).map(([value, entry]) => [value, entry[1]]);
export const statusValues = <K extends StatusKind>(kind: K) => Object.keys(STATUS[kind]) as (keyof (typeof STATUS)[K] & string)[];

const DAY = 864e5;
/** Ημερολογιακές ημέρες (ώρα Αθήνας) από το `now` ως το `date`: αρνητικό = πέρασε. */
export function daysUntil(date: Date, now: Date): number {
  const day = (d: Date) => Date.parse(d.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" }) + "T00:00:00Z");
  return Math.round((day(date) - day(now)) / DAY);
}

/**
 * Ετικέτα πληρωμής που λέει το «πόσο»: «Άργησε 12 ημ.» (θέλει ενέργεια), «Λήγει σε 3 ημ.» (≤ 7 ημέρες: πλησιάζει),
 * «Πληρώθηκε». Χωρίς ημερομηνία λήξης: «Απλήρωτο».
 */
export function paymentStatus(input: { outstandingCents: number; dueAt?: Date | null; cancelled?: boolean }, now: Date): StatusLook {
  if (input.cancelled) return look("neutral", "Ακυρώθηκε");
  if (input.outstandingCents <= 0) return look("success", "Πληρώθηκε");
  if (!input.dueAt) return look("warning", "Απλήρωτο");
  const days = daysUntil(input.dueAt, now);
  if (days < 0) return look("danger", `Άργησε ${-days} ημ.`);
  if (days === 0) return look("warning", "Λήγει σήμερα");
  return look(days <= 7 ? "warning" : "neutral", `Λήγει σε ${days} ημ.`);
}

/** Προθεσμία χωρίς ποσό (απάντηση, παράδοση, ισχύς): ίδιος κανόνας με την πληρωμή. `done` = δεν εκκρεμεί πια. */
export function dueStatus(dueAt: Date | null | undefined, now: Date, done = false): StatusLook | null {
  if (done || !dueAt) return null;
  const days = daysUntil(dueAt, now);
  if (days < 0) return look("danger", `Άργησε ${-days} ημ.`);
  if (days === 0) return look("warning", "Λήγει σήμερα");
  return look(days <= 7 ? "warning" : "neutral", `Λήγει σε ${days} ημ.`);
}
