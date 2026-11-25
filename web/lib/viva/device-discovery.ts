// Read-only ISV device discovery. Πηγή: developer.viva.com/downloads/eft-pos-api.yml

const HOSTS = {
  demo: {
    accounts: "https://demo-accounts.vivapayments.com",
    api: "https://demo-api.vivapayments.com",
  },
  production: {
    accounts: "https://accounts.vivapayments.com",
    api: "https://api.vivapayments.com",
  },
} as const;

export type VivaDeviceStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type VivaDeviceSearch = {
  merchantId: string;
  statusId?: VivaDeviceStatus;
  sourceCode?: string;
};

export type VivaDeviceDiscoveryConfig = {
  environment: keyof typeof HOSTS;
  clientId: string;
  clientSecret: string;
  httpTimeoutMs?: number;
};

export type VivaTerminalMetadata = {
  merchantId: string;
  terminalId: string;
  statusId: VivaDeviceStatus;
  sourceCode: string | null;
  virtualTerminalId: string | null;
};

type VivaFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type VivaDeviceDiscoveryDeps = {
  fetch?: VivaFetch;
};

class VivaDiscoveryError extends Error {}

/** Δεν αναπαράγει credentials ή tokens ακόμη κι αν εμφανιστούν σε provider/network error. */
export function redactVivaDiscoveryText(text: string, secrets: string[] = []): string {
  let redacted = text
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]")
    .replace(/("(?:access_token|client_secret|client_id|authorization)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
  for (const secret of secrets) if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted;
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new VivaDiscoveryError(`Viva devices: κενό ${name}`);
  return normalized;
}

function timeoutValue(value: number | undefined): number {
  const timeout = value ?? 10_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000)
    throw new VivaDiscoveryError("Viva devices: μη έγκυρο HTTP timeout");
  return timeout;
}

async function requestJson(
  fetchImpl: VivaFetch,
  timeoutMs: number,
  operation: "token" | "search",
  url: string,
  init: RequestInit,
  secrets: string[],
): Promise<{ response: Response; body?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store" });
    if (!response.ok) return { response };
    try {
      return { response, body: await response.json() as unknown };
    } catch {
      // Το parse error μπορεί να περιέχει απόσπασμα του body· κρατάμε μόνο σταθερό μήνυμα.
      throw new VivaDiscoveryError(`Viva devices ${operation}: μη έγκυρο JSON`);
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw new VivaDiscoveryError(`Viva devices ${operation}: timeout μετά από ${timeoutMs} ms`);
    if (error instanceof VivaDiscoveryError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new VivaDiscoveryError(`Viva devices ${operation}: ${redactVivaDiscoveryText(detail, secrets)}`);
  } finally {
    clearTimeout(timer);
  }
}

function httpError(operation: "token" | "search", status: number): Error {
  // Το error body δεν διαβάζεται καν, ώστε να μην διαρρεύσουν provider internals ή credentials.
  return new VivaDiscoveryError(`Viva devices ${operation}: HTTP ${status}`);
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new VivaDiscoveryError("Viva devices token: μη έγκυρο JSON object");
  return body as Record<string, unknown>;
}

function optionalMetadata(value: unknown, field: "sourceCode" | "virtualTerminalId"): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new VivaDiscoveryError(`Viva devices search: μη έγκυρο ${field}`);
  return value;
}

/** Επιστρέφει μόνο τα πέντε τεκμηριωμένα metadata· άγνωστα πεδία δεν διατηρούνται. */
export function parseVivaDevices(body: unknown, merchantId: string): VivaTerminalMetadata[] {
  if (!Array.isArray(body)) throw new VivaDiscoveryError("Viva devices search: αναμενόταν array");
  return body.map((value, index): VivaTerminalMetadata => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new VivaDiscoveryError(`Viva devices search: μη έγκυρο device στη θέση ${index}`);
    const device = value as Record<string, unknown>;
    if (typeof device.merchantId !== "string" || !device.merchantId.trim() || device.merchantId !== merchantId)
      throw new VivaDiscoveryError(`Viva devices search: merchant mismatch στη θέση ${index}`);
    if (typeof device.terminalId !== "string" || !device.terminalId.trim())
      throw new VivaDiscoveryError(`Viva devices search: μη έγκυρο terminalId στη θέση ${index}`);
    if (!Number.isInteger(device.statusId) || (device.statusId as number) < 0 || (device.statusId as number) > 7)
      throw new VivaDiscoveryError(`Viva devices search: μη έγκυρο statusId στη θέση ${index}`);
    return {
      merchantId: device.merchantId,
      terminalId: device.terminalId,
      statusId: device.statusId as VivaDeviceStatus,
      sourceCode: optionalMetadata(device.sourceCode, "sourceCode"),
      virtualTerminalId: optionalMetadata(device.virtualTerminalId, "virtualTerminalId"),
    };
  });
}

/**
 * Κάνει μόνο OAuth token και devices:search. Δεν δέχεται session, ποσό ή transaction callback.
 * Το token παραμένει τοπικό και δεν εμφανίζεται στο αποτέλεσμα ή στα σφάλματα.
 */
export async function searchVivaDevices(
  config: VivaDeviceDiscoveryConfig,
  input: VivaDeviceSearch,
  deps: VivaDeviceDiscoveryDeps = {},
): Promise<VivaTerminalMetadata[]> {
  requiredText(config.clientId, "clientId");
  requiredText(config.clientSecret, "clientSecret");
  const merchantId = requiredText(input.merchantId, "merchantId");
  const sourceCode = input.sourceCode === undefined ? undefined : requiredText(input.sourceCode, "sourceCode");
  if (input.statusId !== undefined && (!Number.isInteger(input.statusId) || input.statusId < 0 || input.statusId > 7))
    throw new VivaDiscoveryError("Viva devices: μη έγκυρο statusId");
  const timeoutMs = timeoutValue(config.httpTimeoutMs);
  const hosts = HOSTS[config.environment];
  const fetchImpl = deps.fetch ?? fetch;
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const secrets = [config.clientId, config.clientSecret, basic];

  const tokenRequest = await requestJson(fetchImpl, timeoutMs, "token", `${hosts.accounts}/connect/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }, secrets);
  if (!tokenRequest.response.ok) throw httpError("token", tokenRequest.response.status);
  const accessToken = objectBody(tokenRequest.body).access_token;
  if (typeof accessToken !== "string" || !accessToken.trim())
    throw new VivaDiscoveryError("Viva devices token: λείπει το access_token");

  const searchRequest = await requestJson(fetchImpl, timeoutMs, "search", `${hosts.api}/ecr/isv/v1/devices:search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ merchantId, ...(input.statusId === undefined ? {} : { statusId: input.statusId }), ...(sourceCode === undefined ? {} : { sourceCode }) }),
  }, [...secrets, accessToken]);
  if (!searchRequest.response.ok) throw httpError("search", searchRequest.response.status);
  return parseVivaDevices(searchRequest.body, merchantId);
}
