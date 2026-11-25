import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  verifySaleSession,
  type VivaSaleForVerification,
  type VivaTerminalForVerification,
} from "../lib/viva/cloud-terminal.ts";

const DEMO_ACCOUNTS = "https://demo-accounts.vivapayments.com";
const DEMO_API = "https://demo-api.vivapayments.com";
const CONFIRMATION = "RUN_DEMO_SALE";
const CASH_REGISTER_ID = "gelato-sandbox-contract";

const requiredEnv = [
  "VIVA_DEMO_ISV_CLIENT_ID",
  "VIVA_DEMO_ISV_CLIENT_SECRET",
  "VIVA_DEMO_TERMINAL_ID",
  "VIVA_DEMO_TERMINAL_MERCHANT_ID",
] as const;

export type SandboxConfig = {
  clientId: string;
  clientSecret: string;
  terminalId: string;
  terminalMerchantId: string;
  amountCents: number;
  httpTimeoutMs: number;
  totalTimeoutMs: number;
  pollIntervalMs: number;
};

type SandboxFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type SandboxDeps = {
  fetch: SandboxFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  uuid?: () => string;
  onPending?: (count: number) => void;
};

export type SandboxSummary = {
  success: boolean | null;
  amount: number | null;
  currencyCode: string | null;
  eventId: number | null;
  transactionEventId: number | null;
  hasTransactionId: boolean;
  message: string | null;
};

export type SandboxRunResult = {
  status: "passed" | "provider_failure" | "contract_failure" | "timeout";
  sessionId: string;
  pendingPolls: number;
  mismatchGuard: boolean;
  reason?: string;
  summary?: SandboxSummary;
};

export type SandboxEnvResult =
  | { status: "not_run"; reason: string }
  | SandboxRunResult;

/** Διαβάζει μόνο ρητά demo secrets· δεν ακουμπά app settings, .env ή βάση. */
export function readSandboxConfig(env: Readonly<Record<string, string | undefined>>):
  | { status: "ready"; config: SandboxConfig }
  | { status: "not_run"; reason: string } {
  if (env.VIVA_SANDBOX_CONFIRM !== CONFIRMATION)
    return { status: "not_run", reason: `απαιτείται ${"VIVA_SANDBOX_CONFIRM"}=${CONFIRMATION}` };

  const missing = requiredEnv.filter((name) => !env[name]?.trim());
  if (missing.length > 0) return { status: "not_run", reason: `λείπουν: ${missing.join(", ")}` };

  return {
    status: "ready",
    config: {
      clientId: env.VIVA_DEMO_ISV_CLIENT_ID!,
      clientSecret: env.VIVA_DEMO_ISV_CLIENT_SECRET!,
      terminalId: env.VIVA_DEMO_TERMINAL_ID!,
      terminalMerchantId: env.VIVA_DEMO_TERMINAL_MERCHANT_ID!,
      amountCents: boundedInteger(env.VIVA_DEMO_AMOUNT_CENTS, 30, 30, 1000, "VIVA_DEMO_AMOUNT_CENTS"),
      httpTimeoutMs: boundedInteger(env.VIVA_DEMO_HTTP_TIMEOUT_MS, 10_000, 1_000, 30_000, "VIVA_DEMO_HTTP_TIMEOUT_MS"),
      totalTimeoutMs: boundedInteger(env.VIVA_DEMO_TOTAL_TIMEOUT_MS, 120_000, 5_000, 300_000, "VIVA_DEMO_TOTAL_TIMEOUT_MS"),
      pollIntervalMs: boundedInteger(env.VIVA_DEMO_POLL_INTERVAL_MS, 2_000, 250, 10_000, "VIVA_DEMO_POLL_INTERVAL_MS"),
    },
  };
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name}: απαιτείται ακέραιος`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`${name}: επιτρεπόμενο εύρος ${min}..${max}`);
  return value;
}

/** Αφαιρεί γνωστά secrets και τυπικά credentials από τυχόν error text. */
export function redactSandboxText(text: string, secrets: string[]): string {
  let redacted = text
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/("(?:access_token|client_secret|client_id|authorization)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
  for (const secret of secrets) if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted;
}

function primitive(value: unknown): string | number | boolean | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

/** Επιτρέπει μόνο ακίνδυνα metadata· ποτέ raw response, PAN, token ή merchant credentials. */
export function sandboxSummary(session: Record<string, unknown>): SandboxSummary {
  const success = primitive(session.success);
  const amount = primitive(session.amount);
  const currencyCode = primitive(session.currencyCode);
  const eventId = primitive(session.eventId);
  const transactionEventId = primitive(session.transactionEventId);
  const message = primitive(session.message);
  return {
    success: typeof success === "boolean" ? success : null,
    amount: typeof amount === "number" ? amount : null,
    currencyCode: typeof currencyCode === "string" ? currencyCode : null,
    eventId: typeof eventId === "number" ? eventId : null,
    transactionEventId: typeof transactionEventId === "number" ? transactionEventId : null,
    hasTransactionId: typeof session.transactionId === "string" && session.transactionId.length > 0,
    message: typeof message === "string" ? message : null,
  };
}

async function request(
  config: SandboxConfig,
  deps: SandboxDeps,
  operation: string,
  url: string,
  init: RequestInit,
  json: boolean,
): Promise<{ response: Response; body?: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.httpTimeoutMs);
  try {
    const response = await deps.fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    // Το 202 μπορεί να έχει κενό body· είναι έγκυρο pending και δεν χρειάζεται JSON parsing.
    return { response, body: json && response.status !== 202 ? await response.json() : undefined };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Viva demo ${operation}: timeout μετά από ${config.httpTimeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function record(body: unknown, operation: string): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`Viva demo ${operation}: μη έγκυρο JSON object`);
  return body as Record<string, unknown>;
}

function httpError(operation: string, status: number): Error {
  // Το response body δεν καταγράφεται: μπορεί να περιέχει provider internals ή ευαίσθητα δεδομένα.
  return new Error(`Viva demo ${operation}: HTTP ${status}`);
}

/**
 * Πραγματική demo sale μόνο μετά το opt-in gate. Το PASS προέρχεται αποκλειστικά από verifySaleSession.
 * Δεν υπάρχει mocked/fallback success και δεν δημιουργείται κανένα DB record.
 */
export async function runSandboxContract(config: SandboxConfig, deps: SandboxDeps): Promise<SandboxRunResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms)));
  const uuid = deps.uuid ?? randomUUID;

  const tokenRequest = await request(config, deps, "token", `${DEMO_ACCOUNTS}/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  }, true);
  if (!tokenRequest.response.ok) throw httpError("token", tokenRequest.response.status);
  const accessToken = record(tokenRequest.body, "token").access_token;
  if (typeof accessToken !== "string" || !accessToken) throw new Error("Viva demo token: λείπει το access_token");

  const sessionId = uuid();
  const merchantReference = `gelato-sandbox:${sessionId}`;
  const authorization = `Bearer ${accessToken}`;
  const saleRequest = await request(config, deps, "sale", `${DEMO_API}/ecr/isv/v1/transactions:sale`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      terminalId: config.terminalId,
      cashRegisterId: CASH_REGISTER_ID,
      amount: config.amountCents,
      currencyCode: "978",
      merchantReference,
      tipAmount: 0,
      showTransactionResult: true,
      showReceipt: false,
      // Ίδιο ISV envelope με το startSale, για να ελεγχθούν και τα τρέχοντα request assumptions.
      isvDetails: { terminalMerchantId: config.terminalMerchantId },
    }),
  }, false);
  if (!saleRequest.response.ok) throw httpError("sale", saleRequest.response.status);

  const sale: VivaSaleForVerification = {
    id: merchantReference,
    orgId: "sandbox-org",
    storeId: "sandbox-store",
    deviceId: CASH_REGISTER_ID,
    totalCents: config.amountCents,
    payment: { amountCents: config.amountCents, vivaSessionId: sessionId },
  };
  const terminal: VivaTerminalForVerification = {
    orgId: "sandbox-org",
    storeId: "sandbox-store",
    deviceId: CASH_REGISTER_ID,
    terminalId: config.terminalId,
  };

  const startedAt = now();
  let pendingPolls = 0;
  for (;;) {
    if (now() - startedAt >= config.totalTimeoutMs)
      return { status: "timeout", sessionId, pendingPolls, mismatchGuard: false };
    let providerSession: Record<string, unknown> | null = null;
    const verification = await verifySaleSession(sale, terminal, undefined, async (storedSessionId) => {
      const sessionRequest = await request(
        config,
        deps,
        "session",
        `${DEMO_API}/ecr/isv/v1/sessions/${encodeURIComponent(storedSessionId)}`,
        { headers: { Authorization: authorization } },
        true,
      );
      if (sessionRequest.response.status === 202) return null;
      if (!sessionRequest.response.ok) throw httpError("session", sessionRequest.response.status);
      providerSession = record(sessionRequest.body, "session");
      return providerSession;
    });

    if (verification.status === "pending") {
      pendingPolls += 1;
      deps.onPending?.(pendingPolls);
      const remaining = config.totalTimeoutMs - (now() - startedAt);
      if (remaining <= 0) return { status: "timeout", sessionId, pendingPolls, mismatchGuard: false };
      await sleep(Math.min(config.pollIntervalMs, remaining));
      continue;
    }

    // Το mismatch test είναι τοπικό replay της ίδιας απάντησης· δεν στέλνεται δεύτερη sale ή provider request.
    const mismatch = await verifySaleSession(sale, { ...terminal, terminalId: `mismatch-${config.terminalId}` }, undefined, async () => providerSession);
    const mismatchGuard = mismatch.status === "rejected" && mismatch.reason === "session";
    const summary = providerSession ? sandboxSummary(providerSession) : undefined;

    if (!mismatchGuard) return { status: "contract_failure", reason: "mismatch_guard", sessionId, pendingPolls, mismatchGuard, summary };
    if (verification.status === "verified")
      return { status: "passed", sessionId, pendingPolls, mismatchGuard, summary };
    if (verification.reason === "unsuccessful" && verification.raw.success === false)
      return { status: "provider_failure", reason: "unsuccessful", sessionId, pendingPolls, mismatchGuard, summary };
    return { status: "contract_failure", reason: verification.reason, sessionId, pendingPolls, mismatchGuard, summary };
  }
}

export async function runSandboxFromEnv(env: Readonly<Record<string, string | undefined>>, deps: SandboxDeps): Promise<SandboxEnvResult> {
  const gate = readSandboxConfig(env);
  return gate.status === "not_run" ? gate : runSandboxContract(gate.config, deps);
}

export function formatSandboxResult(result: SandboxRunResult): string {
  const label = {
    passed: "PASS",
    provider_failure: "PROVIDER FAILURE",
    contract_failure: "CONTRACT FAILURE",
    timeout: "TIMEOUT",
  }[result.status];
  return `${label}: ${JSON.stringify(result)}`;
}

async function main(): Promise<number> {
  let gate: ReturnType<typeof readSandboxConfig>;
  try {
    gate = readSandboxConfig(process.env);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (gate.status === "not_run") {
    console.log(`NOT RUN: ${gate.reason}`);
    return 0;
  }

  const config = gate.config;
  console.log("RUNNING: αποκλειστικά Viva demo endpoints, χωρίς σύνδεση σε βάση.");
  try {
    const result = await runSandboxContract(config, {
      fetch,
      onPending: (count) => console.log(`PENDING: poll ${count}`),
    });
    console.log(formatSandboxResult(result));
    return result.status === "passed" ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${redactSandboxText(message, [config.clientId, config.clientSecret, config.terminalMerchantId])}`);
    return 1;
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) void main().then((code) => { process.exitCode = code; });
