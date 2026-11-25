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
  [/^\/purchases(\/[^/]+)?$/, { ocr: "Το τιμολόγιο διαβάστηκε και το πρωτότυπο συνδέθηκε. Έλεγξε όλα τα πεδία πριν το καταχωρήσεις", "*": "Το τιμολόγιο αγοράς αποθηκεύτηκε" }],
  [/^\/products$/, { "*": "Ο κατάλογος προϊόντων ενημερώθηκε" }],
  [/^\/my-data$/, { "*": "Η επιλογή σου αποθηκεύτηκε" }],
  [/^\/recipes(\/[^/]+)?$/, { "*": "Η συνταγή αποθηκεύτηκε" }],
  [/^\/inventory\/alerts$/, { "*": "Το ελάχιστο απόθεμα αποθηκεύτηκε" }],
  [/^\/traceability\/lot\/[^/]+$/, { "*": "Η διόρθωση της παρτίδας καταχωρήθηκε" }],
  [/^\/items\/[^/]+\/composition$/, { "*": "Η σύσταση του είδους αποθηκεύτηκε" }],
  [/^\/items\/[^/]+$/, { "*": "Οι συνδέσεις του είδους ενημερώθηκαν" }],
  [/^\/items$/, { "*": "Τα είδη ενημερώθηκαν" }],
  [/^\/(platform\/)?parties(\/.*)?$/, { address: "Οι διευθύνσεις ενημερώθηκαν", contact: "Οι επαφές ενημερώθηκαν", channel: "Τα τηλέφωνα και τα email ενημερώθηκαν", bank: "Οι τραπεζικοί λογαριασμοί ενημερώθηκαν", located: "Η έδρα βρέθηκε στον χάρτη από τη διεύθυνσή της. Έλεγξε ότι η πινέζα είναι στο σωστό σημείο", consent: "Η συναίνεση καταγράφηκε", erasure: "Το αίτημα διαγραφής καταχωρίστηκε. Απάντηση μέσα σε 30 ημέρες", "*": "Τα στοιχεία του συναλλασσομένου αποθηκεύτηκαν" }],
  [/^\/users$/, { invited: "Η πρόσκληση στάλθηκε με email", member: "Ο χρήστης ενημερώθηκε", removed: "Η πρόσβαση του χρήστη αφαιρέθηκε", disabled: "Ο χρήστης απενεργοποιήθηκε και αποσυνδέθηκε από παντού", enabled: "Ο χρήστης ενεργοποιήθηκε ξανά", reset: "Στάλθηκε email για ορισμό κωδικού", role: "Οι ρόλοι ενημερώθηκαν", group: "Οι ομάδες ενημερώθηκαν", "*": "Οι αλλαγές στους χρήστες αποθηκεύτηκαν" }],
  [/^\/account$/, { name: "Το όνομά σου άλλαξε", password: "Ο κωδικός σου άλλαξε. Οι άλλες συσκευές αποσυνδέθηκαν", sessions: "Οι άλλες συσκευές αποσυνδέθηκαν", "*": "Τα στοιχεία σου αποθηκεύτηκαν" }],
  [/^\/company$/, { "*": "Τα στοιχεία της επιχείρησης αποθηκεύτηκαν" }],
  [/^\/devices$/, { "*": "Η συσκευή αποθηκεύτηκε" }],
  [/^\/billing$/, { paused: "Το κατάστημα μπήκε σε εποχιακή παύση. Το ταμείο του έκλεισε", resumed: "Το κατάστημα άνοιξε ξανά και δουλεύει κανονικά", "*": "Η συνδρομή ενημερώθηκε" }],
  [/^\/gdpr$/, { "*": "Η αλλαγή στα προσωπικά δεδομένα καταχωρήθηκε" }],
  [/^\/counts(\/.*)?$/, { measurements: "Οι μετρήσεις της απογραφής αποθηκεύτηκαν", line: "Η γραμμή προστέθηκε με αναμενόμενη ποσότητα μηδέν", lot: "Η νέα παρτίδα και η γραμμή της προστέθηκαν", "*": "Η απογραφή αποθηκεύτηκε" }],
  [/^\/production\/[^/]+$/, { "*": "Η παρτίδα έκλεισε. Τα υλικά αφαιρέθηκαν από την αποθήκη, πρώτα όσα λήγουν νωρίτερα" }],
  [/^\/orders\/mrp$/, { "*": "Οι προτάσεις παραγγελίας αποθηκεύτηκαν" }],
  [/^\/orders\/rfqs\/[^/]+$/, { "*": "Η ανάθεση αποθηκεύτηκε" }],
  [/^\/inventory(\/.*)?$/, { "*": "Η αποθήκη ενημερώθηκε" }],
  [/^\/support(\/.*)?$/, { new: "Το αίτημα στάλθηκε. Θα σε ειδοποιήσουμε με email όταν απαντήσουμε", reply: "Το μήνυμά σου στάλθηκε", resolved: "Το αίτημα σημειώθηκε ως λυμένο", rated: "Ευχαριστούμε για τη βαθμολογία", "*": "Το αίτημα ενημερώθηκε" }],
  [/^\/platform\/settings$/, { legal: "Τα νομικά κείμενα αποθηκεύτηκαν", "*": "Οι ρυθμίσεις της πλατφόρμας αποθηκεύτηκαν" }],
  [/^\/platform\/currencies$/, { "*": "Τα νομίσματα ενημερώθηκαν" }],
  [/^\/platform\/plans$/, { "*": "Τα πακέτα ενημερώθηκαν. Οι νέες τιμές ισχύουν από την επόμενη χρέωση" }],
  [/^\/platform\/vat-rates$/, { "*": "Οι συντελεστές ΦΠΑ ενημερώθηκαν" }],
  [/^\/platform\/catalog\/duplicates$/, { "*": "Συγχωνεύτηκαν {n} κατασκευαστές, μαζί με τα brands και τα προϊόντα τους" }],
  [/^\/platform\/catalog(\/.*)?$/, { "*": "Ο κεντρικός κατάλογος ενημερώθηκε" }],
  [/^\/platform\/usage$/, { "*": "Οι υπηρεσίες ενημερώθηκαν" }],
  [/^\/platform\/refs$/, { "*": "Η λίστα ενημερώθηκε" }],
  [/^\/platform\/payment-methods$/, { "*": "Οι τρόποι πληρωμής ενημερώθηκαν" }],
  [/^\/platform\/document-types$/, { "*": "Οι τύποι παραστατικών ενημερώθηκαν" }],
  [/^\/platform\/staff$/, { "*": "Το προσωπικό της πλατφόρμας ενημερώθηκε" }],
  [/^\/platform\/kb(\/.*)?$/, { review: "Το άρθρο αποθηκεύτηκε και περιμένει έγκριση: μέχρι τότε οι πελάτες δεν το βλέπουν", fromticket: "Έγινε πρόχειρο άρθρο από το αίτημα", draft: "Το άρθρο γύρισε σε πρόχειρο", published: "Το άρθρο δημοσιεύτηκε", retired: "Το άρθρο αποσύρθηκε", "*": "Το άρθρο βοήθειας αποθηκεύτηκε" }],
  [/^\/platform\/support(\/.*)?$/, { draft: "Το προσχέδιο απάντησης είναι έτοιμο. Διάβασέ το πριν το στείλεις", rejected: "Το προσχέδιο απορρίφθηκε", reply: "Το μήνυμα καταχωρίστηκε", resolved: "Το αίτημα σημειώθηκε ως λυμένο", assigned: "Το αίτημα ανατέθηκε σε σένα", priority: "Η προτεραιότητα του αιτήματος άλλαξε", "*": "Το αίτημα ενημερώθηκε" }],
  [/^\/platform\/continuity$/, { "*": "Ο έλεγχος καταγράφηκε" }],
  [/^\/platform\/gdpr$/, { "*": "Η αλλαγή στα προσωπικά δεδομένα καταχωρήθηκε" }],
  [/^\/platform$/, { deleted: "Η επιχείρηση και τα αρχεία της διαγράφηκαν οριστικά", "*": "Η αλλαγή αποθηκεύτηκε" }],
  [/^\/platform\/[^/]+$/, { lifecycle: "Η κατάσταση της επιχείρησης άλλαξε", paused: "Το κατάστημα μπήκε σε εποχιακή παύση", resumed: "Το κατάστημα άνοιξε ξανά", bank: "Ο τραπεζικός λογαριασμός αποθηκεύτηκε", "*": "Τα στοιχεία της επιχείρησης αποθηκεύτηκαν" }],
];

/**
 * Ενέργειες που λένε «έγινε» με άλλο param από το saved (?posted=1, ?deleted=1…). `replayed`: η ίδια ενέργεια είχε ήδη γίνει
 * (διπλό πάτημα) και δεν γράφτηκε δεύτερη φορά. Κείμενο null = η τιμή του param είναι ήδη η πρόταση (?ok=…).
 */
const DONE: [route: RegExp, param: string, text: string | null, replayed?: string][] = [
  [/^\/products$/, "deleted", "Το προϊόν διαγράφηκε οριστικά"],
  [/^\/products$/, "hidden", "Το προϊόν έχει πωλήσεις, οπότε κρύφτηκε αντί να διαγραφεί"],
  [/^\/my-data$/, "requested", "Το αίτημα διαγραφής καταχωρίστηκε. Θα έχεις απάντηση μέσα σε 30 ημέρες"],
  [/^\/purchases\/[^/]+$/, "posted", "Το τιμολόγιο καταχωρήθηκε: αποθέματα, παρτίδες και τιμές ενημερώθηκαν"],
  [/^\/inventory\/transfers$/, "posted", "Η μεταφορά ολοκληρώθηκε και καταγράφηκε στο ιστορικό", "Η μεταφορά είχε ήδη καταχωριστεί. Δεν δημιουργήθηκε διπλή εγγραφή"],
  [/^\/inventory\/alerts$/, "deleted", "Το ελάχιστο απόθεμα διαγράφηκε"],
  [/^\/production\/[^/]+$/, "corrected", "Η ποσότητα της παρτίδας διορθώθηκε. Η αρχική εγγραφή έμεινε στο ιστορικό"],
  [/^\/items\/[^/]+$/, "copied", "Η σύσταση αντιγράφηκε από τον κατάλογο"],
  [/^\/items\/[^/]+\/composition$/, "copied", "Η σύσταση αντιγράφηκε από τον κεντρικό κατάλογο. Μπορείς να την προσαρμόσεις"],
  [/^\/billing$/, "paid", "Η πληρωμή ολοκληρώθηκε. Ευχαριστούμε"],
  [/^\/counts\/[^/]+$/, "created", "Το προσχέδιο απογραφής δημιουργήθηκε με παγωμένο αναμενόμενο απόθεμα και κόστος", "Το προσχέδιο είχε ήδη δημιουργηθεί. Δεν προστέθηκε διπλή απογραφή"],
  [/^\/counts\/[^/]+$/, "finalized", "Η απογραφή οριστικοποιήθηκε και οι διαφορές καταγράφηκαν ως κινήσεις αποθέματος", "Η απογραφή είχε ήδη οριστικοποιηθεί. Δεν γράφτηκαν νέες κινήσεις"],
  [/^\/(platform\/)?gdpr$/, "ok", null],
];
const doneFor = (pathname: string, params: { get(name: string): string | null }) => DONE.find(([route, param]) => route.test(pathname) && params.get(param));

/** Ένα κείμενο είναι «πρόταση» (το δείχνουμε ως έχει) όταν έχει ελληνικά· αλλιώς είναι κλειδί (1, legal, ocr…). */
const isSentence = (value: string) => /[Α-Ωα-ωά-ώ]/.test(value);
const clean = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 240);

export function savedMessage(pathname: string, value: string): string {
  if (isSentence(value)) return clean(value);
  const messages = SAVED.find(([route]) => route.test(pathname))?.[1];
  const text = messages?.[value] ?? messages?.["*"] ?? GENERIC_SAVED;
  // {n}: το redirect έγραψε πλήθος (?saved=3)
  return text.includes("{n}") ? (/^\d+$/.test(value) ? text.replace("{n}", value) : GENERIC_SAVED) : text;
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
  if (saved) return { kind: "success", title: savedMessage(pathname, saved) };
  const done = doneFor(pathname, params);
  if (!done) return null;
  const [, param, text, replayed] = done;
  const value = params.get(param)!;
  if (text === null) return isSentence(value) ? { kind: "success", title: clean(value) } : null;
  return { kind: "success", title: replayed && params.get("replayed") ? replayed : text };
}

/** Η ίδια διεύθυνση χωρίς τα ?saved= / ?error= (και το param «έγινε» της οθόνης), ώστε μια ανανέωση να μην ξαναδείξει το μήνυμα. */
export function withoutFlash(pathname: string, search: string, hash = ""): string {
  const params = new URLSearchParams(search);
  const done = doneFor(pathname, params);
  if (done) { params.delete(done[1]); params.delete("replayed"); }
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

/**
 * Διεύθυνση για redirect(): ό,τι δεν είναι ASCII (π.χ. ελληνικά σε ?saved=Το τμήμα αποθηκεύτηκε) κωδικοποιείται.
 * Χωρίς αυτό ο server απαντά 500 («Invalid character in header content»), γιατί το redirect μιας server action
 * ταξιδεύει σε κεφαλίδα HTTP. Ό,τι είναι ήδη κωδικοποιημένο (%CE%…) μένει ως έχει.
 */
export const redirectUrl = (url: string) => url.replace(/[^\x21-\x7e]/g, (char) => encodeURIComponent(char));
