// Τα σήματα του browser για την «πορεία εργασίας»: toast, απασχολημένος server, «ρώτα ξανά για εργασίες».
// Απλά DOM events, ώστε κάθε client component να τα στέλνει χωρίς context/provider.

export type ToastInput = { kind: "success" | "error"; title: string; /** δεύτερη γραμμή */ detail?: string; /** προαιρετικό link στη δεύτερη γραμμή, π.χ. «Δες το» */ href?: string; linkText?: string };

export const BUSY_EVENT = "gs:busy";
export const NAV_EVENT = "gs:nav-start";
export const TASKS_EVENT = "gs:tasks-poke";

// Τα toasts δεν είναι DOM event: όποιο σταλεί πριν στηθεί ο Toaster (π.χ. στο πρώτο render) περιμένει στην ουρά.
let sink: ((input: ToastInput) => void) | null = null;
const queue: ToastInput[] = [];
/** Πότε βγήκε το τελευταίο toast: το παράθυρο «Εργασίες» δεν λέει δεύτερη φορά ό,τι μόλις είπε η ίδια η ενέργεια. */
export let lastToastAt = 0;
/** Σύντομο μήνυμα κάτω δεξιά. Επιτυχία: φεύγει μόνη της σε 4 δευτ. Αποτυχία: μένει μέχρι να κλείσει. */
export function toast(input: ToastInput) {
  lastToastAt = Date.now();
  if (sink) sink(input); else queue.push(input);
}
/** Ο Toaster δηλώνει ότι ακούει· παίρνει και όσα περίμεναν. */
export function onToast(listener: (input: ToastInput) => void) {
  sink = listener;
  for (const input of queue.splice(0)) listener(input);
  return () => { if (sink === listener) sink = null; };
}
/** +1 όταν ξεκινά κάτι στον server, -1 όταν τελειώνει: η γραμμή φόρτωσης φαίνεται όσο το άθροισμα είναι > 0. */
export const busy = (delta: 1 | -1) => window.dispatchEvent(new CustomEvent<number>(BUSY_EVENT, { detail: delta }));
/** Κάτι μόλις ξεκίνησε ή τελείωσε: το παράθυρο «Εργασίες» ρωτά τον server τώρα. */
export const pokeTasks = () => window.dispatchEvent(new Event(TASKS_EVENT));
