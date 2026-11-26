// Παραγγελίες εκτός καταστήματος στο ταμείο: τύποι από τον server και κανόνες χωρίς UI (για tests).
import type { Group } from "./till";

export type OrderStatus = "NEW" | "ACCEPTED" | "READY" | "OUT" | "DELIVERED" | "REJECTED" | "CANCELLED";
export type OrderLine = { productId: string | null; name: string; quantity: number; unitPriceCents: number; options: { name: string; priceCents: number }[]; note: string | null };
export type Order = {
  id: string; source: "PHONE" | "WOLT" | "EFOOD"; externalId: string | null; name: string; phone: string | null; address: string | null; delivery: boolean;
  status: OrderStatus; payment: "DOOR_CASH" | "DOOR_CARD" | "PLATFORM" | "TILL"; totalCents: number; note: string | null; readyAt: string | null;
  rejectReason: string | null; createdAt: string; billId: string | null; paid: boolean; lines: OrderLine[];
};
export type Address = { id: string | null; label: string; street: string; meters: number | null; note: string | null };
export type Customer = {
  partyId: string | null; name: string; phone: string; note: string | null; addresses: Address[]; orders: Order[];
  months: { month: string; count: number }[]; facts: { orders: number; avgCents: number; reservations: number };
};
export type LiveCall = { id: string; phone: string; state: "RINGING" | "ANSWERED"; startedAt: string; customer: Customer | null };
/** Ό,τι ξέρουμε για την παραγγελία πριν μπουν τα είδη. */
export type OrderDraft = { name: string; phone?: string; partyId?: string; address?: string; delivery: boolean; callId?: string };

export const SOURCE = { PHONE: "Τηλέφωνο", WOLT: "Wolt", EFOOD: "efood" } as const;
export const PAYMENT = { DOOR_CASH: "Μετρητά στην πόρτα", DOOR_CARD: "Κάρτα στην πόρτα", PLATFORM: "Πληρωμένη online", TILL: "Στο ταμείο" } as const;
export const STATUS: Record<OrderStatus, string> = { NEW: "Νέα", ACCEPTED: "Σε ετοιμασία", READY: "Έτοιμη", OUT: "Στον δρόμο", DELIVERED: "Παραδόθηκε", REJECTED: "Απορρίφθηκε", CANCELLED: "Ακυρώθηκε" };

/** Τα βήματα της μπάρας προόδου· η παραλαβή δεν έχει «στον δρόμο». */
export const steps = (delivery: boolean): OrderStatus[] => (delivery ? ["NEW", "ACCEPTED", "READY", "OUT", "DELIVERED"] : ["NEW", "ACCEPTED", "READY", "DELIVERED"]);

/** Η επόμενη κίνηση για το μεγάλο κουμπί της λεπτομέρειας. */
export function nextMove(o: Pick<Order, "status" | "delivery">): { to: OrderStatus; label: string } | null {
  if (o.status === "ACCEPTED") return { to: "READY", label: "Έτοιμη" };
  if (o.status === "READY") return o.delivery ? { to: "OUT", label: "Στον διανομέα" } : { to: "DELIVERED", label: "Παραλήφθηκε" };
  if (o.status === "OUT") return { to: "DELIVERED", label: "Παραδόθηκε" };
  return null;
}

/** «σε 12′» / «καθυστερεί 4′» για την ώρα ετοιμασίας. */
export function readyText(readyAt: string | null, now: Date) {
  if (!readyAt) return null;
  const min = Math.round((new Date(readyAt).getTime() - now.getTime()) / 60_000);
  return min >= 0 ? { text: `σε ${min}′`, late: false } : { text: `καθυστερεί ${-min}′`, late: true };
}

/**
 * «Ξανά»: οι γραμμές μιας παλιάς παραγγελίας στο σημερινό καλάθι. Οι επιλογές ταιριάζουν με το όνομα·
 * ό,τι δεν υπάρχει πια στον κατάλογο μένει έξω και επιστρέφεται για να το πει η οθόνη.
 */
export function reorderLines(lines: OrderLine[], products: Map<string, { groups: Group[] }>) {
  const ok: { productId: string; options: string[]; note: string; quantity: number }[] = [];
  const missing: string[] = [];
  for (const l of lines) {
    const p = l.productId ? products.get(l.productId) : undefined;
    if (!p) { missing.push(l.name); continue; }
    const all = p.groups.flatMap((g) => g.options);
    const ids = l.options.map((o) => all.find((x) => x.name === o.name)?.id);
    if (ids.some((x) => !x)) { missing.push(l.name); continue; }
    ok.push({ productId: l.productId!, options: ids as string[], note: l.note ?? "", quantity: l.quantity });
  }
  return { ok, missing };
}

export const km = (m: number | null) => (m == null ? null : m < 1000 ? `${m} μ.` : `${(m / 1000).toFixed(1).replace(".", ",")} χλμ`);
