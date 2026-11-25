// Μήνυμα μετά από ενέργεια (toast). Δύο πηγές, μία εμφάνιση:
//  1. τα ?saved= / ?error= που ήδη γράφουν οι server actions στο redirect → διαβάζονται κεντρικά στο layout του (app)
//  2. το cookie gs.flash για ενέργειες που δεν κάνουν redirect (lib/flash-server.ts)
// Καθαρό TypeScript, για node --test.
import type { ToastInput } from "./feedback-events";

export const FLASH_COOKIE = "gs.flash";
const GENERIC_SAVED = "Η αλλαγή αποθηκεύτηκε";

/**
 * Τι αποθηκεύτηκε, όταν το redirect γράφει μόνο κλειδί (?saved=1, ?saved=legal…): ανά διαδρομή, η πιο ειδική πρώτη.
 * Τα κείμενα είναι αυτά που έδειχναν οι σελίδες στα πράσινα πλαίσιά τους.
 */
const SAVED: [route: RegExp, messages: Record<string, string>][] = [
  [/^\/haccp\/records\/[^/]+$/, { "*": "Η καταχώριση HACCP αποθηκεύτηκε" }],
  [/^\/purchases(\/[^/]+)?$/, { ocr: "Το τιμολόγιο διαβάστηκε. Έλεγξε το πρόχειρο πριν το καταχωρήσεις", "*": "Το τιμολόγιο αγοράς αποθηκεύτηκε" }],
  [/^\/products$/, { "*": "Ο κατάλογος προϊόντων ενημερώθηκε" }],
  [/^\/my-data$/, { "*": "Η επιλογή σου αποθηκεύτηκε" }],
  [/^\/recipes(\/[^/]+)?$/, { "*": "Η συνταγή αποθηκεύτηκε" }],
  [/^\/inventory\/alerts$/, { "*": "Το ελάχιστο απόθεμα αποθηκεύτηκε" }],
  [/^\/traceability\/lot\/[^/]+$/, { "*": "Η διόρθωση της παρτίδας καταχωρήθηκε" }],
  [/^\/items(\/.*)?$/, { "*": "Το είδος αποθηκεύτηκε" }],
  [/^\/parties(\/.*)?$/, { address: "Η διεύθυνση αποθηκεύτηκε", "*": "Τα στοιχεία του συναλλασσομένου αποθηκεύτηκαν" }],
  [/^\/users$/, { "*": "Οι αλλαγές στους χρήστες αποθηκεύτηκαν" }],
  [/^\/account$/, { password: "Ο κωδικός σου άλλαξε", "*": "Τα στοιχεία σου αποθηκεύτηκαν" }],
  [/^\/company$/, { "*": "Τα στοιχεία της επιχείρησης αποθηκεύτηκαν" }],
  [/^\/devices$/, { "*": "Η συσκευή αποθηκεύτηκε" }],
  [/^\/billing$/, { paused: "Το κατάστημα μπήκε σε εποχιακή παύση", resumed: "Το κατάστημα άνοιξε ξανά", "*": "Η συνδρομή ενημερώθηκε" }],
  [/^\/gdpr$/, { "*": "Η αλλαγή στα προσωπικά δεδομένα καταχωρήθηκε" }],
  [/^\/counts(\/.*)?$/, { "*": "Η απογραφή αποθηκεύτηκε" }],
  [/^\/inventory(\/.*)?$/, { "*": "Η αποθήκη ενημερώθηκε" }],
  [/^\/support(\/.*)?$/, { "*": "Το αίτημα ενημερώθηκε" }],
  [/^\/platform\/settings$/, { legal: "Τα νομικά κείμενα αποθηκεύτηκαν", "*": "Οι ρυθμίσεις της πλατφόρμας αποθηκεύτηκαν" }],
  [/^\/platform\/currencies$/, { "*": "Τα νομίσματα ενημερώθηκαν" }],
  [/^\/platform\/plans$/, { "*": "Τα πακέτα ενημερώθηκαν. Οι νέες τιμές ισχύουν από την επόμενη χρέωση" }],
  [/^\/platform\/vat-rates$/, { "*": "Οι συντελεστές ΦΠΑ ενημερώθηκαν" }],
  [/^\/platform\/catalog\/duplicates$/, { "*": "Τα διπλά είδη συγχωνεύτηκαν" }],
  [/^\/platform\/catalog(\/.*)?$/, { "*": "Ο κεντρικός κατάλογος ενημερώθηκε" }],
  [/^\/platform\/usage$/, { "*": "Οι υπηρεσίες ενημερώθηκαν" }],
  [/^\/platform\/refs$/, { "*": "Η λίστα ενημερώθηκε" }],
  [/^\/platform\/payment-methods$/, { "*": "Οι τρόποι πληρωμής ενημερώθηκαν" }],
  [/^\/platform\/document-types$/, { "*": "Οι τύποι παραστατικών ενημερώθηκαν" }],
  [/^\/platform\/staff$/, { "*": "Το προσωπικό της πλατφόρμας ενημερώθηκε" }],
  [/^\/platform\/kb(\/.*)?$/, { "*": "Το άρθρο βοήθειας αποθηκεύτηκε" }],
  [/^\/platform\/support(\/.*)?$/, { "*": "Το αίτημα ενημερώθηκε" }],
  [/^\/platform$/, { deleted: "Η επιχείρηση και τα αρχεία της διαγράφηκαν οριστικά", "*": "Η αλλαγή αποθηκεύτηκε" }],
  [/^\/platform\/[^/]+$/, { lifecycle: "Η κατάσταση της επιχείρησης άλλαξε", paused: "Το κατάστημα μπήκε σε εποχιακή παύση", resumed: "Το κατάστημα άνοιξε ξανά", bank: "Ο τραπεζικός λογαριασμός αποθηκεύτηκε", "*": "Τα στοιχεία της επιχείρησης αποθηκεύτηκαν" }],
];

/** Ένα κείμενο είναι «πρόταση» (το δείχνουμε ως έχει) όταν έχει ελληνικά· αλλιώς είναι κλειδί (1, legal, ocr…). */
const isSentence = (value: string) => /[Α-Ωα-ωά-ώ]/.test(value);
const clean = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 240);

export function savedMessage(pathname: string, value: string): string {
  if (isSentence(value)) return clean(value);
  const messages = SAVED.find(([route]) => route.test(pathname))?.[1];
  return messages?.[value] ?? messages?.["*"] ?? GENERIC_SAVED;
}

/** Το toast για τα ?saved= / ?error= μιας διεύθυνσης, ή null αν δεν έχει κανένα. */
export function flashFromUrl(pathname: string, params: { get(name: string): string | null }): ToastInput | null {
  const error = params.get("error");
  if (error) {
    // κλειδί λάθους (?error=expired): το κείμενό του το ξέρει η σελίδα και το δείχνει δίπλα στη φόρμα
    if (!isSentence(error)) return { kind: "error", title: "Δεν έγινε", detail: "Δες το μήνυμα στη σελίδα και δοκίμασε ξανά." };
    return { kind: "error", title: `Δεν έγινε: ${clean(error)}`, detail: "Διόρθωσέ το και δοκίμασε ξανά." };
  }
  const saved = params.get("saved");
  return saved ? { kind: "success", title: savedMessage(pathname, saved) } : null;
}

/** Η ίδια διεύθυνση χωρίς τα ?saved= / ?error=, ώστε μια ανανέωση να μην ξαναδείξει το μήνυμα. */
export function withoutFlash(pathname: string, search: string, hash = ""): string {
  const params = new URLSearchParams(search);
  params.delete("saved");
  params.delete("error");
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ""}${hash}`;
}

export type FlashCookie = ToastInput & { id: string };
export const encodeFlash = (flash: FlashCookie) => encodeURIComponent(JSON.stringify(flash));
/** Το cookie το γράφει ο server μας, αλλά ο browser μπορεί να το αλλάξει: δεχόμαστε μόνο το σχήμα που περιμένουμε. */
export function decodeFlash(raw: string | undefined | null): FlashCookie | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(decodeURIComponent(raw));
    if (!v || typeof v !== "object") return null;
    const f = v as Record<string, unknown>;
    if ((f.kind !== "success" && f.kind !== "error") || typeof f.title !== "string" || typeof f.id !== "string") return null;
    // link μόνο προς δική μας διαδρομή
    const href = typeof f.href === "string" && /^\/(?!\/)/.test(f.href) ? f.href : undefined;
    return { id: f.id.slice(0, 40), kind: f.kind, title: clean(f.title), detail: typeof f.detail === "string" ? clean(f.detail) : undefined, href, linkText: href && typeof f.linkText === "string" ? clean(f.linkText) : undefined };
  } catch { return null; }
}
