// Κανόνες του support desk χωρίς βάση (για tests): κατηγορίες, προτεραιότητα, χρόνοι απάντησης, μεταβάσεις κατάστασης.

export const CATEGORIES = {
  pos: "Ταμείο και αποδείξεις",
  devices: "Συσκευές (ταμεία, εκτυπωτές, ψυγεία)",
  billing: "Συνδρομή και πληρωμές",
  usage: "Πώς κάνω κάτι στην εφαρμογή",
  idea: "Πρόταση βελτίωσης",
} as const;
export type Category = keyof typeof CATEGORIES;
export const isCategory = (v: unknown): v is Category => typeof v === "string" && v in CATEGORIES;

export type Priority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
export type Status = "NEW" | "OPEN" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
export const PRIORITY: Record<Priority, { label: string; tone: "danger" | "warning" | "neutral"; firstResponseMinutes: number }> = {
  CRITICAL: { label: "Κρίσιμο", tone: "danger", firstResponseMinutes: 15 },
  HIGH: { label: "Υψηλό", tone: "warning", firstResponseMinutes: 60 },
  NORMAL: { label: "Κανονικό", tone: "neutral", firstResponseMinutes: 240 },
  LOW: { label: "Χαμηλό", tone: "neutral", firstResponseMinutes: 24 * 60 },
};
export const STATUS: Record<Status, { label: string; customer: string; tone: "danger" | "warning" | "neutral" | "success" }> = {
  NEW: { label: "Νέο", customer: "Το λάβαμε", tone: "warning" },
  OPEN: { label: "Σε εξέλιξη", customer: "Σε εξέλιξη", tone: "neutral" },
  WAITING_CUSTOMER: { label: "Περιμένει τον πελάτη", customer: "Απαντήθηκε: περιμένει εσένα", tone: "warning" },
  RESOLVED: { label: "Λύθηκε", customer: "Λύθηκε", tone: "success" },
  CLOSED: { label: "Κλειστό", customer: "Κλειστό", tone: "neutral" },
};
export const ACTIVE: Status[] = ["NEW", "OPEN", "WAITING_CUSTOMER"];

/** Πόσο επείγει, όπως το λέει ο πελάτης. Οι προτάσεις βελτίωσης είναι πάντα χαμηλής προτεραιότητας. */
export const URGENCY = { calm: "Δεν επείγει", hard: "Με δυσκολεύει", blocked: "Δεν μπορώ να δουλέψω" } as const;
export type Urgency = keyof typeof URGENCY;
export const priorityFor = (category: Category, urgency: Urgency): Priority => (category === "idea" ? "LOW" : urgency === "blocked" ? "CRITICAL" : urgency === "hard" ? "HIGH" : "NORMAL");

/** Η νέα κατάσταση μετά από μήνυμα. Εσωτερική σημείωση δεν αλλάζει τίποτα· απάντηση πελάτη ξανανοίγει ό,τι είχε λυθεί. */
export function afterMessage(status: Status, by: "customer" | "support", internal: boolean): Status {
  if (internal) return status;
  if (by === "support") return status === "CLOSED" ? "CLOSED" : "WAITING_CUSTOMER";
  return "OPEN";
}

export const DAYS_TO_CLOSE = 5;

/** Ο χρόνος πρώτης απάντησης, σε λόγια για την ουρά. Μετρά όλο το 24ωρο. */
export function responseClock(t: { priority: Priority; status: Status; createdAt: Date; firstResponseAt: Date | null }, now = new Date()): { text: string; tone: "danger" | "warning" | "success" | "neutral"; minutesLeft: number | null } {
  const limit = PRIORITY[t.priority].firstResponseMinutes;
  if (t.firstResponseAt) {
    const took = Math.round((t.firstResponseAt.getTime() - t.createdAt.getTime()) / 60000);
    return took <= limit ? { text: `Απαντήθηκε σε ${span(took)}`, tone: "success", minutesLeft: null } : { text: `Απαντήθηκε σε ${span(took)} (στόχος ${span(limit)})`, tone: "warning", minutesLeft: null };
  }
  if (!ACTIVE.includes(t.status)) return { text: "—", tone: "neutral", minutesLeft: null };
  const left = limit - Math.floor((now.getTime() - t.createdAt.getTime()) / 60000);
  if (left < 0) return { text: `Εκπρόθεσμο κατά ${span(-left)}`, tone: "danger", minutesLeft: left };
  return { text: `Απάντηση σε ${span(left)}`, tone: left <= Math.max(10, limit / 4) ? "warning" : "neutral", minutesLeft: left };
}
export const span = (minutes: number) => (minutes < 1 ? "λιγότερο από 1′" : minutes < 60 ? `${minutes}′` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} ώρ.` : `${Math.round(minutes / 1440)} ημ.`);
