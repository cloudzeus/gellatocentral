// Είσπραξη συνδρομών στον λογαριασμό Viva ΤΗΣ ΠΛΑΤΦΟΡΜΑΣ (Smart Checkout). Άλλα κλειδιά από του ISV:
// VIVA_PLATFORM_CLIENT_ID / VIVA_PLATFORM_CLIENT_SECRET (Smart Checkout credentials) και VIVA_PLATFORM_SOURCE_CODE.
// Πηγή: developer.viva.com/smart-checkout/smart-checkout-integration και /tutorials/payments/verify-a-payment
// ΔΕΝ έχει δοκιμαστεί ακόμα απέναντι στο demo της Viva (χρειάζονται τα κλειδιά).
const demo = process.env.VIVA_ENV !== "production";
const ACCOUNTS = demo ? "https://demo-accounts.vivapayments.com" : "https://accounts.vivapayments.com";
const API = demo ? "https://demo-api.vivapayments.com" : "https://api.vivapayments.com";
const CHECKOUT = demo ? "https://demo.vivapayments.com" : "https://www.vivapayments.com";

export const VAT_RATE = 24; // ΦΠΑ υπηρεσιών λογισμικού
/** Οι χρεώσεις τηρούνται προ ΦΠΑ· ο πελάτης πληρώνει με ΦΠΑ. */
export const withVat = (cents: number) => Math.round((cents * (100 + VAT_RATE)) / 100);
export const checkoutConfigured = () => Boolean(process.env.VIVA_PLATFORM_CLIENT_ID && process.env.VIVA_PLATFORM_CLIENT_SECRET);

async function bearer(): Promise<string> {
  const basic = Buffer.from(`${process.env.VIVA_PLATFORM_CLIENT_ID}:${process.env.VIVA_PLATFORM_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${ACCOUNTS}/connect/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store" });
  if (!res.ok) throw new Error(`Viva token: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Δημιουργεί εντολή πληρωμής και επιστρέφει τον κωδικό της και τη σελίδα όπου πληρώνει ο πελάτης. */
export async function createOrder(input: { amountCents: number; description: string; email: string; fullName: string; reference: string }) {
  const res = await fetch(`${API}/checkout/v2/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: input.amountCents,
      customerTrns: input.description,
      merchantTrns: input.reference,
      customer: { email: input.email, fullName: input.fullName, countryCode: "GR", requestLang: "el-GR" },
      ...(process.env.VIVA_PLATFORM_SOURCE_CODE ? { sourceCode: process.env.VIVA_PLATFORM_SOURCE_CODE } : {}),
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Viva order: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const orderCode = String(((await res.json()) as { orderCode: number | string }).orderCode);
  return { orderCode, url: `${CHECKOUT}/web/checkout?ref=${orderCode}` };
}

/** Ρωτά τη Viva για μια συναλλαγή. Η πληρωμή μετράει ΜΟΝΟ αν η Viva απαντήσει statusId "F" (ολοκληρωμένη). */
export async function getTransaction(transactionId: string) {
  const res = await fetch(`${API}/checkout/v2/transactions/${encodeURIComponent(transactionId)}`, { headers: { Authorization: `Bearer ${await bearer()}` }, cache: "no-store" });
  if (!res.ok) return null;
  const t = (await res.json()) as { statusId: string; orderCode: number | string; amount: number };
  return { paid: t.statusId === "F", orderCode: String(t.orderCode), amountCents: Math.round(t.amount * 100) };
}
