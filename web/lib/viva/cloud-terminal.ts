// Viva Cloud Terminal API (σχήμα ISV). Πηγή: developer.viva.com/downloads/eft-pos-api.yml
// Το ταμείο στέλνει αίτημα πώλησης στο τερματικό και μετά ρωτά για το αποτέλεσμα με το sessionId.
// ΔΕΝ έχει δοκιμαστεί ακόμα απέναντι στο demo της Viva (χρειάζονται ISV κλειδιά).
import { toVivaJson } from "./fiscal";

const demo = process.env.VIVA_ENV !== "production";
const ACCOUNTS = demo ? "https://demo-accounts.vivapayments.com" : "https://accounts.vivapayments.com";
const API = demo ? "https://demo-api.vivapayments.com" : "https://api.vivapayments.com";

export const vivaConfigured = () => Boolean(process.env.VIVA_ISV_CLIENT_ID && process.env.VIVA_ISV_CLIENT_SECRET);

let token: { value: string; expiresAt: number } | undefined;

async function bearer(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(`${process.env.VIVA_ISV_CLIENT_ID}:${process.env.VIVA_ISV_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${ACCOUNTS}/connect/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Viva token: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
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
  const res = await fetch(`${API}/ecr/isv/v1/transactions:sale`, {
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
  const res = await fetch(`${API}/ecr/isv/v1/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${await bearer()}` },
    cache: "no-store",
  });
  if (res.status === 202) return null;
  if (!res.ok) throw new Error(`Viva session: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Δοκιμή των κλειδιών ISV: ζητά token από τη Viva. Επιστρέφει null αν όλα καλά, αλλιώς το σφάλμα. */
export async function testIsvCredentials(): Promise<string | null> {
  if (!vivaConfigured()) return "Δεν έχουν οριστεί VIVA_ISV_CLIENT_ID / VIVA_ISV_CLIENT_SECRET";
  token = undefined;
  return bearer().then(() => null, (e: Error) => e.message);
}
export const vivaEnv = () => (demo ? "demo" : "production");
