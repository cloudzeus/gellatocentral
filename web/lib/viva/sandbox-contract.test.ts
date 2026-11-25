import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSandboxResult,
  readSandboxConfig,
  redactSandboxText,
  runSandboxContract,
  runSandboxFromEnv,
  type SandboxConfig,
} from "../../scripts/viva-sandbox-contract.ts";

const sessionId = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const cashRegisterId = "gelato-sandbox-contract";
const merchantReference = `gelato-sandbox:${sessionId}`;

const config = (): SandboxConfig => ({
  clientId: "demo-client",
  clientSecret: "demo-secret",
  terminalId: "demo-terminal",
  terminalMerchantId: "demo-merchant",
  amountCents: 30,
  httpTimeoutMs: 1000,
  totalTimeoutMs: 5000,
  pollIntervalMs: 1000,
});

const explicitEnv = () => ({
  VIVA_SANDBOX_CONFIRM: "RUN_DEMO_SALE",
  VIVA_DEMO_ISV_CLIENT_ID: "demo-client",
  VIVA_DEMO_ISV_CLIENT_SECRET: "demo-secret",
  VIVA_DEMO_TERMINAL_ID: "demo-terminal",
  VIVA_DEMO_TERMINAL_MERCHANT_ID: "demo-merchant",
});

const successfulSession = (): Record<string, unknown> => ({
  success: true,
  sessionId,
  merchantReference,
  cashRegisterId,
  terminalId: "demo-terminal",
  amount: 30,
  currencyCode: "978",
  transactionId: "demo-transaction",
});

const failedSession = (): Record<string, unknown> => ({
  success: false,
  sessionId,
  merchantReference,
  cashRegisterId,
  terminalId: "demo-terminal",
  amount: 30,
  currencyCode: "978",
  eventId: 1000,
  transactionEventId: 1000,
});

function providerMock(sessions: Response[] | "pending") {
  const calls: { url: string; init?: RequestInit }[] = [];
  const remaining = Array.isArray(sessions) ? [...sessions] : [];
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://demo-accounts.vivapayments.com/connect/token")
      return Response.json({ access_token: "demo-access-token", expires_in: 3600 });
    if (url === "https://demo-api.vivapayments.com/ecr/isv/v1/transactions:sale")
      return new Response(null, { status: 200 });
    if (url === `https://demo-api.vivapayments.com/ecr/isv/v1/sessions/${sessionId}`)
      return sessions === "pending" ? new Response(null, { status: 202 }) : remaining.shift()!;
    throw new Error(`unexpected URL ${url}`);
  };
  return { calls, fetch };
}

test("χωρίς ρητό confirmation/credentials: NOT RUN και μηδέν network calls", async (t) => {
  const cases = [
    { name: "κενό environment", env: {} },
    { name: "credentials χωρίς confirmation", env: { ...explicitEnv(), VIVA_SANDBOX_CONFIRM: "" } },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    let calls = 0;
    const result = await runSandboxFromEnv(c.env, { fetch: async () => { calls += 1; throw new Error("network"); } });
    assert.equal(result.status, "not_run");
    assert.equal(calls, 0);
  });
});

test("pending και μετά verified success: PASS μόνο από την πραγματική mocked provider απάντηση", async () => {
  const provider = providerMock([
    new Response(null, { status: 202 }),
    Response.json(successfulSession()),
  ]);
  let elapsed = 0;
  const result = await runSandboxContract(config(), {
    fetch: provider.fetch,
    uuid: () => sessionId,
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms; },
  });
  assert.equal(result.status, "passed");
  assert.equal(result.pendingPolls, 1);
  assert.equal(result.mismatchGuard, true);
  assert.equal(result.summary?.success, true);
  assert.equal(result.summary?.hasTransactionId, true);
  assert.equal(provider.calls.length, 4); // token, sale, δύο session polls· το mismatch είναι τοπικό replay
  assert.ok(provider.calls.every((call) => call.url.startsWith("https://demo-")));

  const saleBody = JSON.parse(String(provider.calls[1].init?.body)) as Record<string, unknown>;
  assert.deepEqual(saleBody, {
    sessionId,
    terminalId: "demo-terminal",
    cashRegisterId,
    amount: 30,
    currencyCode: "978",
    merchantReference,
    tipAmount: 0,
    showTransactionResult: true,
    showReceipt: false,
    isvDetails: { terminalMerchantId: "demo-merchant" },
  });
  const output = formatSandboxResult(result);
  assert.ok(!output.includes("demo-secret"));
  assert.ok(!output.includes("demo-access-token"));
  assert.ok(!output.includes("demo-merchant"));
});

test("τελικό provider success=false: PROVIDER FAILURE, ποτέ PASS", async () => {
  const provider = providerMock([Response.json(failedSession())]);
  const result = await runSandboxContract(config(), { fetch: provider.fetch, uuid: () => sessionId });
  assert.equal(result.status, "provider_failure");
  assert.equal(result.reason, "unsuccessful");
  assert.equal(result.summary?.success, false);
  assert.equal(result.mismatchGuard, true);
  assert.ok(formatSandboxResult(result).startsWith("PROVIDER FAILURE:"));
});

test("λάθος terminal binding: CONTRACT FAILURE ακόμη και με success=true", async () => {
  const provider = providerMock([Response.json({ ...successfulSession(), terminalId: "other-terminal" })]);
  const result = await runSandboxContract(config(), { fetch: provider.fetch, uuid: () => sessionId });
  assert.equal(result.status, "contract_failure");
  assert.equal(result.reason, "session");
  assert.equal(result.summary?.success, true);
  assert.ok(!formatSandboxResult(result).startsWith("PASS:"));
});

test("παρατεταμένο pending: bounded TIMEOUT χωρίς fabricated success", async () => {
  const provider = providerMock("pending");
  let elapsed = 0;
  const current = { ...config(), totalTimeoutMs: 3000, pollIntervalMs: 1000 };
  const result = await runSandboxContract(current, {
    fetch: provider.fetch,
    uuid: () => sessionId,
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms; },
  });
  assert.equal(result.status, "timeout");
  assert.equal(result.pendingPolls, 3);
  assert.equal(elapsed, 3000);
  assert.ok(formatSandboxResult(result).startsWith("TIMEOUT:"));
});

test("κάθε HTTP request έχει timeout και καθαρίζει το controlled error", async () => {
  const current = { ...config(), httpTimeoutMs: 5 };
  await assert.rejects(runSandboxContract(current, {
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  }), /Viva demo token: timeout μετά από 5 ms/);
});

test("redaction καλύπτει secrets, bearer και token-like JSON", () => {
  const text = redactSandboxText(
    'demo-secret Bearer abc.def {"access_token":"token-value","client_id":"demo-client"}',
    ["demo-secret", "demo-client"],
  );
  assert.equal(text, '[REDACTED] Bearer [REDACTED] {"access_token":"[REDACTED]","client_id":"[REDACTED]"}');
});

test("το gate δέχεται μόνο πλήρες explicit demo configuration και bounded values", () => {
  const ready = readSandboxConfig(explicitEnv());
  assert.equal(ready.status, "ready");
  if (ready.status === "ready") assert.equal(ready.config.amountCents, 30);
  assert.throws(() => readSandboxConfig({ ...explicitEnv(), VIVA_DEMO_AMOUNT_CENTS: "29" }), /30\.\.1000/);
  assert.throws(() => readSandboxConfig({ ...explicitEnv(), VIVA_DEMO_HTTP_TIMEOUT_MS: "0" }), /1000\.\.30000/);
});
