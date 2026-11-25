// Είσπραξη συνδρομών στον λογαριασμό Viva ΤΗΣ ΠΛΑΤΦΟΡΜΑΣ (Smart Checkout). Άλλα κλειδιά από του ISV:
// Smart Checkout credentials και κωδικός πηγής, από τις Ρυθμίσεις της πλατφόρμας.
// Πηγή: developer.viva.com/smart-checkout/smart-checkout-integration και /tutorials/payments/verify-a-payment
// ΔΕΝ έχει δοκιμαστεί ακόμα απέναντι στο demo της Viva (χρειάζονται τα κλειδιά).
import { settings } from "../config";

const VIVA_TIMEOUT_MS = 15_000; // όπως στο cloud-terminal: μια Viva που δεν απαντά δεν κρατά το αίτημα ανοιχτό

async function platform() {
  const c = await settings("VIVA_ENV", "VIVA_PLATFORM_CLIENT_ID", "VIVA_PLATFORM_CLIENT_SECRET", "VIVA_PLATFORM_SOURCE_CODE");
  const demo = c.VIVA_ENV !== "production";
  return { id: c.VIVA_PLATFORM_CLIENT_ID, secret: c.VIVA_PLATFORM_CLIENT_SECRET, source: c.VIVA_PLATFORM_SOURCE_CODE, accounts: demo ? "https://demo-accounts.vivapayments.com" : "https://accounts.vivapayments.com", api: demo ? "https://demo-api.vivapayments.com" : "https://api.vivapayments.com", checkout: demo ? "https://demo.vivapayments.com" : "https://www.vivapayments.com" };
}

export const checkoutConfigured = async () => { const c = await platform(); return Boolean(c.id && c.secret); };

async function bearer(): Promise<string> {
  const c = await platform();
  const basic = Buffer.from(`${c.id}:${c.secret}`).toString("base64");
  const res = await fetch(`${c.accounts}/connect/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store", signal: AbortSignal.timeout(VIVA_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Viva token: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Δημιουργεί εντολή πληρωμής και επιστρέφει τον κωδικό της και τη σελίδα όπου πληρώνει ο πελάτης. */
export async function createOrder(input: { amountCents: number; description: string; email: string; fullName: string; reference: string }) {
  const c = await platform();
  const res = await fetch(`${c.api}/checkout/v2/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: input.amountCents,
      customerTrns: input.description,
      merchantTrns: input.reference,
      customer: { email: input.email, fullName: input.fullName, countryCode: "GR", requestLang: "el-GR" },
      ...(c.source ? { sourceCode: c.source } : {}),
    }),
    cache: "no-store", signal: AbortSignal.timeout(VIVA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Viva order: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const orderCode = String(((await res.json()) as { orderCode: number | string }).orderCode);
  return { orderCode, url: `${c.checkout}/web/checkout?ref=${orderCode}` };
}

/** Ρωτά τη Viva για μια συναλλαγή. Η πληρωμή μετράει ΜΟΝΟ αν η Viva απαντήσει statusId "F" (ολοκληρωμένη). */
export async function getTransaction(transactionId: string) {
  const res = await fetch(`${(await platform()).api}/checkout/v2/transactions/${encodeURIComponent(transactionId)}`, { headers: { Authorization: `Bearer ${await bearer()}` }, cache: "no-store", signal: AbortSignal.timeout(VIVA_TIMEOUT_MS) });
  if (!res.ok) return null;
  const t = (await res.json()) as { statusId: string; orderCode: number | string; amount: number };
  return { paid: t.statusId === "F", orderCode: String(t.orderCode), amountCents: Math.round(t.amount * 100) };
}
