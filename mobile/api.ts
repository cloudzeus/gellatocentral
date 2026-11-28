import * as SecureStore from "expo-secure-store";
import type { Group } from "./till";
import type { OfflineCtx, OfflineSale } from "./offline";

export type Product = { id: string; name: string; code: string | null; priceCents: number; vatRate: number; groups: Group[] };
export type PaymentMethod = { id: string; code: string; name: string; payItemCase?: number | null };
export type Catalog = { device: { name: string; series: string }; store: string; hasTables?: boolean; categories: { id: string; name: string; color: number | null; products: Product[] }[]; frequent?: string[]; paymentMethods?: PaymentMethod[] ; offline?: OfflineCtx | null; soldOut?: string[] };
/** Γραμμή προς τον server: μόνο ids επιλογών· τιμές και κανόνες τα βγάζει εκείνος από τον κατάλογο. */
export type SaleLine = { productId: string; quantity: number; options: string[]; note?: string; seat?: number };
/** kind: τι συσκευή είναι στην κονσόλα (σύζευξη)· KITCHEN_DISPLAY ανοίγει την οθόνη κουζίνας αντί για το ταμείο. */
export type Session = { baseUrl: string; token: string; kind?: string };
/** Ό,τι χρειάζεται για να ανοίξει το Viva Terminal για μια πώληση. */
/** external: η χρέωση πάει σε POS άλλης συσκευής (ο server τη στέλνει)· η εφαρμογή δεν ανοίγει τη Viva, περιμένει. */
export type StartedSale = { saleId: string; amountCents: number; fiscalisationData: string; external?: boolean };
/** Πληρωμή που ξεκίνησε και δεν ξέρουμε ακόμα πώς τελείωσε. Μένει στη συσκευή μέχρι να μάθουμε. */
export type Pending = StartedSale & { offline?: OfflineSale; methodName: string; startedAt: string; items: number; callback?: string };

const KEY = "session";
const PENDING = "pending";
export const loadSession = async (): Promise<Session | null> => JSON.parse((await SecureStore.getItemAsync(KEY)) ?? "null");
export const saveSession = (s: Session) => SecureStore.setItemAsync(KEY, JSON.stringify(s));
export const clearSession = () => SecureStore.deleteItemAsync(KEY);
export const loadPending = async (): Promise<Pending | null> => JSON.parse((await SecureStore.getItemAsync(PENDING)) ?? "null");
export const savePending = (p: Pending) => SecureStore.setItemAsync(PENDING, JSON.stringify(p));
export const clearPending = () => SecureStore.deleteItemAsync(PENDING);

/** Απάντηση του server με σφάλμα. status 0 = δεν φτάσαμε καθόλου στον server (δίκτυο). */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly body: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function call<T>(s: Session, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  let res: Response;
  try {
    res = await fetch(`${s.baseUrl}/api/pos${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "Δεν υπάρχει σύνδεση");
  }
  // ο server απαντά πάντα JSON· ένα HTML σφάλμα proxy δεν πρέπει να ρίξει την εφαρμογή
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? res.status), String(data.message ?? ""), data);
  return { status: res.status, data: data as T };
}

/** Σύζευξη: ο κωδικός μίας χρήσης της κονσόλας ανταλλάσσεται με το μόνιμο κλειδί της συσκευής. */
/** androidId: σταθερή ταυτότητα της συσκευής (η MAC δεν διαβάζεται από Android 10+)· η κονσόλα τη δείχνει δίπλα στο ταμείο. */
export async function pair(baseUrl: string, code: string, androidId?: string | null): Promise<Session> {
  // Το κλειδί της συσκευής δεν ταξιδεύει ποτέ χωρίς κρυπτογράφηση.
  // εξαίρεση: http://localhost (ίδια συσκευή, π.χ. adb reverse στην ανάπτυξη)· δεν βγαίνει στο δίκτυο
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)) throw new Error("Η διεύθυνση πρέπει να αρχίζει με https://");
  const res = await fetch(`${baseUrl}/api/pos/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, ...(androidId ? { androidId } : {}) }) });
  if (!res.ok) throw new Error(res.status === 401 ? "Ο κωδικός είναι λάθος, έληξε ή η συσκευή δεν είναι στο σωστό δίκτυο." : `Σφάλμα ${res.status}`);
  const data = await res.json();
  return { baseUrl, token: data.token, kind: data.kind };
}

/** Πώληση που έγινε χωρίς σύνδεση (offline.ts). done = καταγράφηκε, pending = η Viva δεν απάντησε ακόμα, rejected = θέλει τον υπεύθυνο. */
export async function syncOffline(s: Session, sale: OfflineSale): Promise<"done" | "pending" | { rejected: string }> {
  try {
    const { status } = await call(s, "/sales/offline", sale);
    return status === 202 ? "pending" : "done";
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return { rejected: String(e.body.reason ?? "rejected") };
    // 502: η Viva δεν έχει ακόμα τη συναλλαγή (το τερματικό ήταν κι αυτό χωρίς internet)· ξανά αργότερα
    if (e instanceof ApiError && e.status >= 500) return "pending";
    throw e;
  }
}

export const getCatalog = async (s: Session) => (await call<Catalog>(s, "/catalog")).data;
export const createSale = async (s: Session, methodId: string, lines: SaleLine[]) =>
  (await call<StartedSale>(s, "/sales", { methodId, lines })).data;

/** unknown.noPaymentYet: ο server ρώτησε τη Viva και εκείνη απάντησε ότι δεν έχει (ακόμα) πληρωμή για την πώληση. */
export type Outcome = { state: "paid"; series: string | null; aa: number | null } | { state: "failed" } | { state: "unknown"; noPaymentYet: boolean };

/** Αναφέρει στον server το callback του Viva Terminal. Ο server το διασταυρώνει με τη Viva πριν πει «πληρώθηκε». */
export async function reportResult(s: Session, saleId: string, r: { success: boolean; transactionId?: string; callback: string }): Promise<Outcome> {
  const { status, data } = await call<{ ok?: true; pending?: true; series?: string | null; aa?: number | null }>(s, `/sales/${saleId}/result`, r);
  // 202: η Viva δεν έχει απαντήσει ακόμα. ΔΕΝ είναι επιτυχία.
  if (status === 202 || data.pending) return { state: "unknown", noPaymentYet: true };
  // Ο server επιστρέφει αριθμό απόδειξης μόνο όταν η Viva βεβαίωσε την πληρωμή, ακόμη κι αν η συσκευή είπε «απέτυχε».
  if (r.success || data.aa != null) return { state: "paid", series: data.series ?? null, aa: data.aa ?? null };
  return { state: "failed" };
}

/** «Έλεγξε αν πληρώθηκε», χωρίς callback: για πληρωμή που έμεινε στη μέση. */
export async function checkResult(s: Session, saleId: string): Promise<Outcome> {
  const { data } = await call<{ status: string; series?: string | null; aa?: number | null }>(s, `/sales/${saleId}/result`);
  if (data.status === "completed") return { state: "paid", series: data.series ?? null, aa: data.aa ?? null };
  return data.status === "failed" ? { state: "failed" } : { state: "unknown", noPaymentYet: data.status === "pending" };
}

// ---- Ανοιχτοί λογαριασμοί (τραπέζια) ----

export type DiningTable = { id: string; name: string; zone: string | null; seats: number };
// heldCents: μερίδια (μοίρασμα κατά ποσό) που εισπράχθηκαν και περιμένουν την απόδειξη του υπολοίπου· μένει να πληρωθούν dueCents − heldCents
type BillSums = { totalCents: number; paidCents: number; dueCents: number; pendingCents: number; heldCents: number; items: number };
/** stage: empty = τίποτα δεν στάλθηκε, ordered = περιμένουν κάτι, eating = όλα σερβιρίστηκαν, asked = ζήτησαν λογαριασμό. lastAt: τελευταία κίνηση. */
export type Stage = "empty" | "ordered" | "eating" | "asked";
export type BillSummary = BillSums & {
  id: string; tableId: string | null; label: string | null; guests: number | null; openedAt: string; openedByName: string | null;
  waiterId?: string | null; billAskedAt?: string | null; billAskedCash?: boolean; stage?: Stage; lastAt?: string; heldItems?: number; unserved?: number;
  /** οθόνη κουζίνας: είδη έτοιμα που δεν σερβιρίστηκαν, από πότε, και από πότε περιμένει κάτι στην κουζίνα/bar */
  readyIds?: string[]; readySince?: string | null; kitchenSince?: string | null;
};
export type BillLine = {
  id: string; roundId: string; productId: string; name: string; quantity: number; unitPriceCents: number; vatRate: number;
  options: { name: string; priceCents: number }[] | null; note: string | null; voidedAt: string | null; voidReason: string | null;
  remaining: number; paid: number; canVoid: boolean; seat?: number | null; servedAt?: string | null;
};
export type Bill = BillSums & {
  id: string; status: "OPEN" | "SETTLED" | "CANCELLED"; label: string | null; guests: number | null; openedAt: string; openedByName: string | null; closedAt: string | null;
  table: { id: string; name: string; zone: string | null; seats?: number } | null;
  billAskedAt?: string | null; billAskedCash?: boolean;
  rounds: { id: string; number: number; sentAt: string; sentByName: string | null; held?: boolean }[];
  lines: BillLine[];
  sales: { id: string; series: string | null; aa: number | null; totalCents: number; issuedAt: string | null }[]; // πληρωμένες αποδείξεις
  shares: { id: string; amountCents: number; status: "PENDING" | "PAID"; paidAt: string | null; method: string; cash: boolean }[];
};
/** Μοίρασμα ανά είδη: τι πληρώνει αυτή η απόδειξη. */
export type BillPick = { lineId: string; quantity: number };

export const getBills = async (s: Session) => (await call<{ tables: DiningTable[]; bills: BillSummary[]; soldOut?: string[] }>(s, "/bills")).data;
export const openBill = async (s: Session, b: { tableId?: string; label?: string; guests?: number }) => (await call<{ id: string; existing: boolean }>(s, "/bills", b)).data;
export const getBill = async (s: Session, id: string) => (await call<Bill>(s, `/bills/${id}`)).data;
/** held: «Μετά» (π.χ. τα γλυκά): γράφεται στον λογαριασμό αλλά δεν πάει σε κουζίνα/bar ως το «Βγάλ' το» (fireRound). */
export const sendRound = async (s: Session, id: string, lines: SaleLine[], held = false) => (await call<{ id: string; number: number }>(s, `/bills/${id}/rounds`, { lines, ...(held ? { held } : {}) })).data;
export const fireRound = (s: Session, id: string, roundId: string) => call(s, `/bills/${id}/rounds/${roundId}/fire`, {});
export const markServed = (s: Session, id: string, lineIds: string[], served: boolean) => call(s, `/bills/${id}/served`, { lineIds, served });
/** «Ζήτησε λογαριασμό»· cash: θα πληρώσει μετρητά στον ταμία. */
export const askBill = (s: Session, id: string, ask: boolean, cash = false) => call(s, `/bills/${id}/ask`, { ask, cash });
/** «Τελείωσε» / «Υπάρχει ξανά» για προϊόν ή γεύση· επιστρέφει όλα όσα έχουν τελειώσει. */
export const setSoldOut = async (s: Session, itemId: string, out: boolean) => (await call<{ soldOut: string[] }>(s, "/soldout", { itemId, out })).data.soldOut;
export const voidBillLine = (s: Session, id: string, lineId: string, reason: string) => call(s, `/bills/${id}/lines/${lineId}/void`, { reason });
export const cancelBill = (s: Session, id: string, reason: string) => call(s, `/bills/${id}/cancel`, { reason });
/** Πληρωμή ό,τι μένει στον λογαριασμό: από εδώ όπως η άμεση πώληση (Viva Terminal, reportResult). */
export const settleBill = async (s: Session, id: string, methodId: string, lines?: BillPick[]) => (await call<StartedSale>(s, `/bills/${id}/settle`, { methodId, lines })).data;
/** Μοίρασμα κατά ποσό: ένα μερίδιο πριν από την απόδειξη. Κάρτα → Viva Terminal όπως η πώληση· μετρητά → { paid: true }. */
export const shareBill = async (s: Session, id: string, methodId: string, amountCents: number) =>
  (await call<StartedSale | { paid: true; shareId: string }>(s, `/bills/${id}/shares`, { methodId, amountCents })).data;
