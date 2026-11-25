// Viva Cloud Terminal API (σχήμα ISV). Πηγή: developer.viva.com/downloads/eft-pos-api.yml
// Το ταμείο στέλνει αίτημα πώλησης στο τερματικό και μετά ρωτά για το αποτέλεσμα με το sessionId.
// ΔΕΝ έχει δοκιμαστεί ακόμα απέναντι στο demo της Viva (χρειάζονται ISV κλειδιά).
import { toVivaJson } from "./fiscal.ts";
import {
  searchVivaDevices,
  type VivaDeviceSearch,
  type VivaTerminalMetadata,
} from "./device-discovery.ts";

export type { VivaDeviceSearch, VivaTerminalMetadata } from "./device-discovery.ts";

// Χωρίς όριο, μια Viva που δεν απαντά κρατά το αίτημα του ταμείου ανοιχτό επ' αόριστον.
export const VIVA_TIMEOUT_MS = 15_000;

/**
 * Το αίτημα χρέωσης ή επιστροφής έφυγε αλλά δεν ήρθε απάντηση (timeout ή δίκτυο): μπορεί να έφτασε στη Viva.
 * Ο καλών ΔΕΝ το σημειώνει αποτυχημένο και ΔΕΝ ξαναστέλνει· το αφήνει σε αναμονή και ρωτά με το ίδιο sessionId.
 */
export class VivaUnknownOutcomeError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Viva ${what}: δεν ήρθε απάντηση, το αποτέλεσμα είναι άγνωστο`, { cause });
    this.name = "VivaUnknownOutcomeError";
  }
}

/** Στέλνει κίνηση που κινεί χρήματα. Ό,τι αποτύχει ΠΡΙΝ φύγει το αίτημα (ρυθμίσεις, token) είναι βέβαιη αποτυχία. */
export async function sendTransaction(what: "sale" | "refund", url: string, token: string, body: string, send: typeof fetch = fetch) {
  let res: Response;
  try {
    res = await send(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(VIVA_TIMEOUT_MS) });
  } catch (cause) {
    throw new VivaUnknownOutcomeError(what, cause);
  }
  // Η Viva απάντησε και αρνήθηκε: βέβαιη αποτυχία.
  if (!res.ok) throw new Error(`Viva ${what}: HTTP ${res.status} ${await res.text()}`);
}

/** Κλειδιά και διευθύνσεις για το περιβάλλον που έχει οριστεί στις Ρυθμίσεις. */
async function isv() {
  // Οι ρυθμίσεις/η βάση φορτώνονται μόνο σε πραγματική κλήση· η επαλήθευση δέχεται mocked session loader.
  const { settings } = await import("../config.ts");
  const c = await settings("VIVA_ENV", "VIVA_ISV_CLIENT_ID", "VIVA_ISV_CLIENT_SECRET");
  const demo = c.VIVA_ENV !== "production";
  return { demo, id: c.VIVA_ISV_CLIENT_ID, secret: c.VIVA_ISV_CLIENT_SECRET, accounts: demo ? "https://demo-accounts.vivapayments.com" : "https://accounts.vivapayments.com", api: demo ? "https://demo-api.vivapayments.com" : "https://api.vivapayments.com" };
}
export const vivaConfigured = async () => { const c = await isv(); return Boolean(c.id && c.secret); };

/** Read-only ανακάλυψη τερματικών στο demo/production που ορίζουν οι Ρυθμίσεις. */
export async function searchDevices(input: VivaDeviceSearch): Promise<VivaTerminalMetadata[]> {
  const c = await isv();
  if (!c.id || !c.secret) throw new Error("Viva devices: δεν έχουν οριστεί τα κλειδιά ISV στις Ρυθμίσεις");
  return searchVivaDevices({
    environment: c.demo ? "demo" : "production",
    clientId: c.id,
    clientSecret: c.secret,
  }, input);
}

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
    cache: "no-store", signal: AbortSignal.timeout(VIVA_TIMEOUT_MS),
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
  const api = (await isv()).api;
  await sendTransaction("sale", `${api}/ecr/isv/v1/transactions:sale`, await bearer(), toVivaJson({
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
    }));
}

/** null = το τερματικό δεν έχει τελειώσει ακόμα (HTTP 202). */
export async function getSession(sessionId: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${(await isv()).api}/ecr/isv/v1/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${await bearer()}` },
    cache: "no-store", signal: AbortSignal.timeout(VIVA_TIMEOUT_MS),
  });
  if (res.status === 202) return null;
  if (!res.ok) throw new Error(`Viva session: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export type VivaSaleForVerification = {
  id: string;
  orgId: string;
  storeId: string;
  deviceId: string;
  totalCents: number;
  payment: { amountCents: number; vivaSessionId: string | null } | null;
};

export type VivaTerminalForVerification = {
  orgId: string;
  storeId: string;
  deviceId: string;
  terminalId: string | null;
};

export type VivaSaleVerification =
  | { status: "verified"; transactionId: string; raw: Record<string, unknown> }
  | { status: "pending" }
  | { status: "rejected"; reason: "unsuccessful"; raw: Record<string, unknown> }
  | { status: "rejected"; reason: "binding" | "session" | "transaction" | "amount" };

type SessionLoader = (sessionId: string) => Promise<Record<string, unknown> | null>;

/**
 * Η επιτυχία αποδεικνύεται μόνο από την απάντηση της Viva, δεμένη με την αποθηκευμένη πώληση και συσκευή.
 * Το transactionId του client χρησιμοποιείται μόνο για έλεγχο διασταύρωσης, ποτέ ως αποθηκευόμενη απόδειξη.
 */
export async function verifySaleSession(
  sale: VivaSaleForVerification,
  terminal: VivaTerminalForVerification,
  clientTransactionId?: string,
  loadSession: SessionLoader = getSession,
): Promise<VivaSaleVerification> {
  const payment = sale.payment;
  const sessionId = payment?.vivaSessionId;
  if (
    !payment || !sessionId || !terminal.terminalId ||
    sale.orgId !== terminal.orgId || sale.storeId !== terminal.storeId || sale.deviceId !== terminal.deviceId
  ) return { status: "rejected", reason: "binding" };
  if (payment.amountCents !== sale.totalCents) return { status: "rejected", reason: "amount" };

  const session = await loadSession(sessionId);
  if (!session) return { status: "pending" };
  // Και η τελική αποτυχία πρέπει να ανήκει στη συγκεκριμένη πώληση/συσκευή· mismatch δεν είναι αποτυχία πληρωμής.
  if (
    session.sessionId !== sessionId || session.merchantReference !== sale.id ||
    session.cashRegisterId !== terminal.deviceId || session.terminalId !== terminal.terminalId
  ) return { status: "rejected", reason: "session" };
  if (session.amount !== undefined && session.amount !== payment.amountCents)
    return { status: "rejected", reason: "amount" };
  if (session.success !== true) return { status: "rejected", reason: "unsuccessful", raw: session };

  const transactionId = session.transactionId;
  if (typeof transactionId !== "string" || !transactionId || (clientTransactionId !== undefined && clientTransactionId !== transactionId))
    return { status: "rejected", reason: "transaction" };
  if (session.amount !== payment.amountCents) return { status: "rejected", reason: "amount" };
  return { status: "verified", transactionId, raw: session };
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
  const api = (await isv()).api;
  await sendTransaction("refund", `${api}/ecr/isv/v1/transactions:refund`, await bearer(), toVivaJson({
      sessionId: input.sessionId,
      terminalId: input.terminalId,
      cashRegisterId: input.cashRegisterId,
      amount: Math.abs(input.amountCents),
      currencyCode: "978",
      merchantReference: input.merchantReference,
      showTransactionResult: true,
      isvDetails: { terminalMerchantId: input.terminalMerchantId },
      fiscalisationData: input.fiscalisationData,
    }));
}

/** Δοκιμή των κλειδιών ISV: ζητά token από τη Viva. Επιστρέφει null αν όλα καλά, αλλιώς το σφάλμα. */
export async function testIsvCredentials(): Promise<string | null> {
  if (!(await vivaConfigured())) return "Δεν έχουν οριστεί τα κλειδιά ISV στις Ρυθμίσεις";
  token = undefined;
  return bearer().then(() => null, (e: Error) => e.message);
}
export const vivaEnv = async () => ((await isv()).demo ? "demo" : "production");
