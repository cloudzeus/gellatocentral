// Generic HTTPS συμβόλαιο, όχι named τραπεζική ολοκλήρωση· χωρίς ρύθμιση η εκτέλεση παραμένει απενεργοποιημένη.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "./public-fetch.ts";

export type PayrollProviderPayment = { employeeId: string; employeeName: string; storeId: string | null; iban: string; amountCents: number };
export type PayrollProviderRequest = {
  executionId: string;
  batchId: string;
  from: string;
  to: string;
  amountCents: number;
  payments: readonly PayrollProviderPayment[];
};
export type PayrollProviderResult =
  | { status: "SUCCEEDED"; reference: string; confirmedAt: Date }
  | { status: "FAILED"; code: string }
  | { status: "UNCERTAIN"; code: "PROVIDER_UNCERTAIN" };
export type PayrollPaymentProvider = {
  name: "GENERIC_HTTPS";
  execute: (request: PayrollProviderRequest) => Promise<PayrollProviderResult>;
};
type ProviderDependencies = {
  fetch?: typeof fetch;
  resolveAddresses?: (hostname: string) => Promise<readonly string[]>;
};
type GenericConfig = { url: string; token: string; timeoutMs: number };

const MAX_RESPONSE_BYTES = 16_384;
const uncertain = (): PayrollProviderResult => ({ status: "UNCERTAIN", code: "PROVIDER_UNCERTAIN" });

function providerConfig(env: Record<string, string | undefined>): GenericConfig {
  const value = env.PAYROLL_PAYMENTS_PROVIDER_URL?.trim() ?? "";
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Λείπει ή είναι άκυρο το PAYROLL_PAYMENTS_PROVIDER_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Ο generic payroll provider απαιτεί HTTPS χωρίς credentials, query ή fragment");
  const token = env.PAYROLL_PAYMENTS_PROVIDER_TOKEN?.trim() ?? "";
  if (token.length < 16 || token.length > 500 || /[\r\n]/.test(token)) throw new Error("Λείπει ή είναι άκυρο το PAYROLL_PAYMENTS_PROVIDER_TOKEN");
  const rawTimeout = env.PAYROLL_PAYMENTS_PROVIDER_TIMEOUT_MS ?? "8000";
  if (!/^\d+$/.test(rawTimeout)) throw new Error("Άκυρο timeout generic payroll provider");
  const timeoutMs = Number(rawTimeout);
  if (timeoutMs < 1000 || timeoutMs > 15_000) throw new Error("Το timeout generic payroll provider πρέπει να είναι 1000–15000 ms");
  return { url: url.toString(), token, timeoutMs };
}

async function publicProviderUrl(value: string, resolveAddresses: (hostname: string) => Promise<readonly string[]>) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) throw new Error("Μη επιτρεπτή διεύθυνση generic payroll provider");
  return url;
}

async function responseJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES || !response.body) throw new Error("Μη έγκυρη απόκριση provider");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("Υπερβολικά μεγάλη απόκριση provider");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text) as unknown;
}

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

/** Μόνο ρητό, αυστηρά validated SUCCEEDED επιβεβαιώνει πληρωμή· timeout/5xx/άκυρο body παραμένουν UNCERTAIN. */
export function genericHttpsPayrollProvider(config: GenericConfig, dependencies: ProviderDependencies = {}): PayrollPaymentProvider {
  const fetcher = dependencies.fetch ?? fetch;
  const resolveAddresses = dependencies.resolveAddresses ?? (async (hostname: string) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address));
  return {
    name: "GENERIC_HTTPS",
    execute: async (request) => {
      try {
        const url = await publicProviderUrl(config.url, resolveAddresses);
        const response = await fetcher(url, {
          method: "POST",
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(config.timeoutMs),
          headers: {
            "Authorization": `Bearer ${config.token}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Idempotency-Key": request.executionId,
          },
          body: JSON.stringify({
            version: 1,
            idempotencyKey: request.executionId,
            batchId: request.batchId,
            period: { from: request.from, to: request.to },
            currency: "EUR",
            amountCents: request.amountCents,
            payments: request.payments,
          }),
        });
        if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
          await response.body?.cancel().catch(() => {});
          return uncertain();
        }
        const body = await responseJson(response);
        if (exactObject(body, ["status", "reference"]) && body.status === "SUCCEEDED" && typeof body.reference === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(body.reference)) {
          return { status: "SUCCEEDED", reference: body.reference, confirmedAt: new Date() };
        }
        if (exactObject(body, ["status", "code"]) && body.status === "FAILED" && typeof body.code === "string" && /^[A-Z][A-Z0-9_]{0,60}$/.test(body.code)) {
          return { status: "FAILED", code: body.code };
        }
        return uncertain();
      } catch {
        // Δεν κρατάμε raw σφάλμα/response: μπορεί να περιέχει IBAN ή credentials.
        return uncertain();
      }
    },
  };
}

export function resolvePayrollPaymentProvider(env: Record<string, string | undefined> = process.env): PayrollPaymentProvider {
  const kind = env.PAYROLL_PAYMENTS_PROVIDER?.trim() || "DISABLED";
  if (kind === "DISABLED") throw new Error("Η εκτέλεση payroll είναι απενεργοποιημένη· ρυθμίζεται ρητά μόνο από τον server");
  if (kind !== "GENERIC_HTTPS") throw new Error("Μη υποστηριζόμενος generic payroll provider");
  return genericHttpsPayrollProvider(providerConfig(env));
}

export function payrollProviderAvailability(env: Record<string, string | undefined> = process.env) {
  const kind = env.PAYROLL_PAYMENTS_PROVIDER?.trim() || "DISABLED";
  return { enabled: kind === "GENERIC_HTTPS", kind: kind === "GENERIC_HTTPS" ? "GENERIC_HTTPS" as const : null };
}
