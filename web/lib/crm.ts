// CRM συναλλασσομένων: είδη ενεργειών, κανάλια επικοινωνίας και χρονολόγιο. Καθαρή λογική, χωρίς βάση.
export const ACTIVITY_KINDS = {
  note: { label: "Σημείωση", verb: "Σημείωση" },
  call: { label: "Κλήση", verb: "Καταγραφή κλήσης" },
  email: { label: "Email", verb: "Καταγραφή email" },
  meeting: { label: "Συνάντηση", verb: "Καταγραφή συνάντησης" },
  task: { label: "Εργασία", verb: "Νέα εργασία" },
} as const;
export type ActivityKind = keyof typeof ACTIVITY_KINDS;
export const isActivityKind = (v: unknown): v is ActivityKind => typeof v === "string" && v in ACTIVITY_KINDS;
/** Τα είδη που μετράνε ως «επικοινωνία» (όχι σημειώσεις και εργασίες). */
export const CONTACT_KINDS: readonly string[] = ["call", "email", "meeting"];

export const CHANNEL_KINDS = { phone: "Τηλέφωνο", email: "Email" } as const;
export type ChannelKind = keyof typeof CHANNEL_KINDS;
export const isChannelKind = (v: unknown): v is ChannelKind => v === "phone" || v === "email";
export const CHANNEL_LABELS = ["Κέντρο", "Κινητό", "Γραφείο", "Λογιστήριο", "Τιμολόγια", "Παραγγελίες", "Προσωπικό"];

/** Τηλέφωνο ως «+302101234567» ή «2101234567» (6–15 ψηφία), email με πεζά. null αν δεν είναι έγκυρο. */
export function cleanChannel(kind: ChannelKind, input: string): string | null {
  const v = input.trim();
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 160 ? v.toLowerCase() : null;
  const digits = v.replace(/^00/, "+").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return /^\+?\d{6,15}$/.test(digits) ? digits : null;
}
/** «210 123 4567», «694 123 4567»: ελληνικά δεκαψήφια σε τριάδες, τα υπόλοιπα όπως είναι. */
export const showPhone = (v: string) => (/^[26]\d{9}$/.test(v) ? `${v.slice(0, 3)} ${v.slice(3, 6)} ${v.slice(6)}` : v);
export const channelHref = (kind: string, value: string) => (kind === "email" ? `mailto:${value}` : `tel:${value.replace(/[^\d+]/g, "")}`);

const DAY = 86_400_000;
const athensDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" }); // yyyy-mm-dd
/** Ημέρες από το a ως το b, μετρημένες σε ημερολογιακές ημέρες Ελλάδας. */
export const daysBetween = (a: Date, b: Date) => Math.round((Date.parse(athensDay(b)) - Date.parse(athensDay(a))) / DAY);

/** «σήμερα», «χθες», «πριν 12 ημέρες», «πριν 3 μήνες». */
export function ago(at: Date, now: Date) {
  const d = daysBetween(at, now);
  return d <= 0 ? "σήμερα" : d === 1 ? "χθες" : d < 60 ? `πριν ${d} ημέρες` : d < 730 ? `πριν ${Math.round(d / 30)} μήνες` : `πριν ${Math.round(d / 365)} χρόνια`;
}
/** Πόσο «κρύα» είναι η σχέση: καμία επικοινωνία ή πάνω από 60 ημέρες θέλει ενέργεια. */
export const contactTone = (last: Date | null, now: Date): "success" | "neutral" | "warning" => (!last ? "warning" : daysBetween(last, now) <= 14 ? "success" : daysBetween(last, now) <= 60 ? "neutral" : "warning");

export type TaskState = "done" | "overdue" | "today" | "upcoming" | "open";
export function taskState(t: { dueAt: Date | null; doneAt: Date | null }, now: Date): TaskState {
  if (t.doneAt) return "done";
  if (!t.dueAt) return "open";
  const d = daysBetween(now, t.dueAt);
  return d < 0 ? "overdue" : d === 0 ? "today" : "upcoming";
}
export function dueText(dueAt: Date | null, now: Date) {
  if (!dueAt) return "χωρίς προθεσμία";
  const d = daysBetween(now, dueAt);
  return d < -1 ? `άργησε ${-d} ημέρες` : d === -1 ? "ήταν για χθες" : d === 0 ? "σήμερα" : d === 1 ? "αύριο" : `σε ${d} ημέρες`;
}
/** Ημερομηνία φόρμας (yyyy-mm-dd) ως μεσημέρι UTC: η ίδια ημέρα σε κάθε ζώνη ώρας. */
export const formDate = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(`${v}T12:00:00Z`) : null);

// Το χρονολόγιο ενώνει όσα έγραψε άνθρωπος (ενέργειες) με όσα έγιναν μόνα τους (αρχεία, αιτήματα, χρεώσεις, παύσεις).
export type TimelineItem = { id: string; at: Date; kind: string; title: string; text?: string | null; who?: string | null; person?: string | null; href?: string; tone?: "success" | "warning" | "danger" | "neutral"; auto?: boolean; pinned?: boolean; direction?: string | null; task?: { dueAt: Date | null; doneAt: Date | null }; source?: string };
export const TIMELINE_FILTERS = { all: "Όλα", contact: "Επικοινωνίες", note: "Σημειώσεις", task: "Εργασίες", auto: "Αυτόματα" } as const;
export type TimelineFilter = keyof typeof TIMELINE_FILTERS;
const matches = (i: TimelineItem, f: TimelineFilter) => f === "all" || (f === "auto" ? !!i.auto : f === "contact" ? CONTACT_KINDS.includes(i.kind) : i.kind === f);
/** Καρφιτσωμένα πρώτα, μετά τα πιο πρόσφατα. */
export function mergeTimeline(lists: TimelineItem[][], filter: TimelineFilter = "all") {
  return lists.flat().filter((i) => matches(i, filter)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at.getTime() - a.at.getTime());
}

/** Πλήθος ανά μήνα για τους τελευταίους `months` μήνες (ο τρέχων τελευταίος). */
export function monthBuckets(dates: Date[], now: Date, months = 6) {
  const key = (d: Date) => athensDay(d).slice(0, 7);
  const [y, m] = key(now).split("-").map(Number);
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (months - 1 - i), 15));
    const k = d.toISOString().slice(0, 7);
    return { key: k, label: d.toLocaleDateString("el-GR", { month: "short", timeZone: "UTC" }), count: dates.filter((x) => key(x) === k).length };
  });
}
export const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
