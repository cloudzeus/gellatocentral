// Viva Cloud Terminal API (σχήμα ISV). Πηγή: developer.viva.com/downloads/eft-pos-api.yml
// Το ταμείο στέλνει αίτημα πώλησης στο τερματικό και μετά ρωτά για το αποτέλεσμα με το sessionId.
// ΔΕΝ έχει δοκιμαστεί ακόμα απέναντι στο demo της Viva (χρειάζονται ISV κλειδιά).
import { settings } from "../config";
import { toVivaJson } from "./fiscal";

/** Κλειδιά και διευθύνσεις για το περιβάλλον που έχει οριστεί στις Ρυθμίσεις. */
async function isv() {
  const c = await settings("VIVA_ENV", "VIVA_ISV_CLIENT_ID", "VIVA_ISV_CLIENT_SECRET");
  const demo = c.VIVA_ENV !== "production";
  return { demo, id: c.VIVA_ISV_CLIENT_ID, secret: c.VIVA_ISV_CLIENT_SECRET, accounts: demo ? "https://demo-accounts.vivapayments.com" : "https://accounts.vivapayments.com", api: demo ? "https://demo-api.vivapayments.com" : "https://api.vivapayments.com" };
}
export const vivaConfigured = async () => { const c = await isv(); return Boolean(c.id && c.secret); };

// το token ισχύει για συγκεκριμένα κλειδιά: αν αλλάξουν από τις Ρυθμίσεις, ζητείται νέο
let token: { value: string; expiresAt: number; for: string } | undefined;

async function bearer(): Promise<string> {
  const c = await isv();
  if (token && token.for === `${c.accounts}|${c.id}|${c.secret}` && token.expiresAt > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(`${c.id}:${c.secret}`).toString("base64");
  const res = await fetch(`${c.accounts}/connect/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Viva token: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000, for: `${c.accounts}|${c.id}|${c.secret}` };
  return token.value;
}

export async function startSale(input: {
  sessionId: string;
  terminalId: string;
  cashRegisterId: string;
  amountCents: number;
  merchantReference: string;
  terminalMerchantId: string;
  fiscalisationData: unknown;
}) {
  const res = await fetch(`${(await isv()).api}/ecr/isv/v1/transactions:sale`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json" },
    body: toVivaJson({
      sessionId: input.sessionId,
      terminalId: input.terminalId,
      cashRegisterId: input.cashRegisterId,
      amount: input.amountCents,
      currencyCode: "978",
      merchantReference: input.merchantReference,
      tipAmount: 0,
      showTransactionResult: true,
      showReceipt: false, // την απόδειξη την τυπώνουμε εμείς, με τα στοιχεία σήμανσης
      isvDetails: { terminalMerchantId: input.terminalMerchantId },
      fiscalisationData: input.fiscalisationData,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Viva sale: HTTP ${res.status} ${await res.text()}`);
}

/** null = το τερματικό δεν έχει τελειώσει ακόμα (HTTP 202). */
export async function getSession(sessionId: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${(await isv()).api}/ecr/isv/v1/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${await bearer()}` },
    cache: "no-store",
  });
  if (res.status === 202) return null;
  if (!res.ok) throw new Error(`Viva session: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Επιστροφή χρημάτων στο τερματικό (refund). Το fiscalisationData είναι το πιστωτικό (11.4)
 * με αρνητικά ποσά· στο αίτημα το ποσό πηγαίνει θετικό. ΔΕΝ έχει δοκιμαστεί ακόμα στο demo.
 */
export async function startRefund(input: {
  sessionId: string;
  terminalId: string;
  cashRegisterId: string;
  amountCents: number;
  merchantReference: string;
  terminalMerchantId: string;
  fiscalisationData: unknown;
}) {
  const res = await fetch(`${(await isv()).api}/ecr/isv/v1/transactions:refund`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json" },
    body: toVivaJson({
      sessionId: input.sessionId,
      terminalId: input.terminalId,
      cashRegisterId: input.cashRegisterId,
      amount: Math.abs(input.amountCents),
      currencyCode: "978",
      merchantReference: input.merchantReference,
      showTransactionResult: true,
      isvDetails: { terminalMerchantId: input.terminalMerchantId },
      fiscalisationData: input.fiscalisationData,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Viva refund: HTTP ${res.status} ${await res.text()}`);
}

/** Δοκιμή των κλειδιών ISV: ζητά token από τη Viva. Επιστρέφει null αν όλα καλά, αλλιώς το σφάλμα. */
export async function testIsvCredentials(): Promise<string | null> {
  if (!(await vivaConfigured())) return "Δεν έχουν οριστεί τα κλειδιά ISV στις Ρυθμίσεις";
  token = undefined;
  return bearer().then(() => null, (e: Error) => e.message);
}
export const vivaEnv = async () => ((await isv()).demo ? "demo" : "production");
