import * as SecureStore from "expo-secure-store";

export type Product = { id: string; name: string; priceCents: number; vatRate: number };
export type Catalog = { device: { name: string; series: string }; store: string; categories: { id: string; name: string; products: Product[] }[] };
export type Session = { baseUrl: string; token: string };

const KEY = "session";
export const loadSession = async (): Promise<Session | null> => JSON.parse((await SecureStore.getItemAsync(KEY)) ?? "null");
export const saveSession = (s: Session) => SecureStore.setItemAsync(KEY, JSON.stringify(s));
export const clearSession = () => SecureStore.deleteItemAsync(KEY);

async function call<T>(s: Session, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${s.baseUrl}/api/pos${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(res.status === 401 ? "Το κλειδί της συσκευής δεν είναι έγκυρο." : res.status === 409 ? "Υπάρχει ήδη πληρωμή σε εξέλιξη." : `Σφάλμα ${res.status}`);
  return res.json();
}

/** Σύζευξη: ο κωδικός μίας χρήσης της κονσόλας ανταλλάσσεται με το μόνιμο κλειδί της συσκευής. */
export async function pair(baseUrl: string, code: string): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/pos/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  if (!res.ok) throw new Error(res.status === 401 ? "Ο κωδικός είναι λάθος, έληξε ή η συσκευή δεν είναι στο σωστό δίκτυο." : `Σφάλμα ${res.status}`);
  return { baseUrl, token: (await res.json()).token };
}

export const getCatalog = (s: Session) => call<Catalog>(s, "/catalog");
export const createSale = (s: Session, method: "CASH" | "CARD", lines: { productId: string; quantity: number }[]) =>
  call<{ saleId: string; amountCents: number; fiscalisationData: string }>(s, "/sales", { method, lines });
export const reportResult = (s: Session, saleId: string, r: { success: boolean; transactionId?: string; callback: string }) =>
  call<{ ok: true }>(s, `/sales/${saleId}/result`, r);
