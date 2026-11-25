import * as SecureStore from "expo-secure-store";

export type Product = { id: string; name: string; priceCents: number; vatRate: number };
export type PaymentMethod = { id: string; code: string; name: string };
export type Catalog = { device: { name: string; series: string }; store: string; categories: { id: string; name: string; products: Product[] }[]; paymentMethods?: PaymentMethod[] };
export type Session = { baseUrl: string; token: string };
/** Ό,τι χρειάζεται για να ανοίξει το Viva Terminal για μια πώληση. */
export type StartedSale = { saleId: string; amountCents: number; fiscalisationData: string };
/** Πληρωμή που ξεκίνησε και δεν ξέρουμε ακόμα πώς τελείωσε. Μένει στη συσκευή μέχρι να μάθουμε. */
export type Pending = StartedSale & { methodName: string; startedAt: string; items: number; callback?: string };

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

async function call<T>(s: Session, path: string, body?: unknown): Promise<{ status: number; data: T }> {
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
export async function pair(baseUrl: string, code: string): Promise<Session> {
  // Το κλειδί της συσκευής δεν ταξιδεύει ποτέ χωρίς κρυπτογράφηση.
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("Η διεύθυνση πρέπει να αρχίζει με https://");
  const res = await fetch(`${baseUrl}/api/pos/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  if (!res.ok) throw new Error(res.status === 401 ? "Ο κωδικός είναι λάθος, έληξε ή η συσκευή δεν είναι στο σωστό δίκτυο." : `Σφάλμα ${res.status}`);
  return { baseUrl, token: (await res.json()).token };
}

export const getCatalog = async (s: Session) => (await call<Catalog>(s, "/catalog")).data;
export const createSale = async (s: Session, methodId: string, lines: { productId: string; quantity: number }[]) =>
  (await call<StartedSale>(s, "/sales", { methodId, lines })).data;

export type Outcome = { state: "paid"; series: string | null; aa: number | null } | { state: "failed" } | { state: "unknown" };

/** Αναφέρει στον server το callback του Viva Terminal. Ο server το διασταυρώνει με τη Viva πριν πει «πληρώθηκε». */
export async function reportResult(s: Session, saleId: string, r: { success: boolean; transactionId?: string; callback: string }): Promise<Outcome> {
  const { status, data } = await call<{ ok?: true; pending?: true; series?: string | null; aa?: number | null }>(s, `/sales/${saleId}/result`, r);
  // 202: η Viva δεν έχει απαντήσει ακόμα. ΔΕΝ είναι επιτυχία.
  if (status === 202 || data.pending) return { state: "unknown" };
  // Ο server επιστρέφει αριθμό απόδειξης μόνο όταν η Viva βεβαίωσε την πληρωμή, ακόμη κι αν η συσκευή είπε «απέτυχε».
  if (r.success || data.aa != null) return { state: "paid", series: data.series ?? null, aa: data.aa ?? null };
  return { state: "failed" };
}

/** «Έλεγξε αν πληρώθηκε», χωρίς callback: για πληρωμή που έμεινε στη μέση. */
export async function checkResult(s: Session, saleId: string): Promise<Outcome> {
  const { data } = await call<{ status: string; series?: string | null; aa?: number | null }>(s, `/sales/${saleId}/result`);
  if (data.status === "completed") return { state: "paid", series: data.series ?? null, aa: data.aa ?? null };
  return data.status === "failed" ? { state: "failed" } : { state: "unknown" };
}
