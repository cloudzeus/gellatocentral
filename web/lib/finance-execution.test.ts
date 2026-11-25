import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewBankStatementRows } from "./finance-reconciliation.ts";
import { genericHttpsPayrollProvider, payrollProviderAvailability, resolvePayrollPaymentProvider, type PayrollProviderRequest } from "./payroll-payment-providers.ts";
import { assertPayrollExecutionConfirmation, payrollConfirmationPhrase } from "./payroll-payments.ts";

const config = { url: "https://payments.example.test/payroll", token: "test-token-with-enough-length", timeoutMs: 1000 };
const request: PayrollProviderRequest = {
  executionId: "execution-a",
  batchId: "batch-a",
  from: "2026-11-01",
  to: "2026-11-30",
  amountCents: 100000,
  payments: [{ employeeId: "employee-a", employeeName: "Εργαζόμενος Α", storeId: "store-a", iban: "GR1601101250000000012300695", amountCents: 100000 }],
};
const publicDns = async () => ["93.184.216.34"];

test("payroll confirmation: ακριβές batch και ποσό σε λεπτά", () => {
  const batchId = "a".repeat(64);
  assert.equal(payrollConfirmationPhrase(batchId), `PAYROLL:${batchId}`);
  assert.doesNotThrow(() => assertPayrollExecutionConfirmation({ batchId, confirmation: payrollConfirmationPhrase(batchId), amountCents: 1000, confirmedAmountCents: 1000 }));
  assert.throws(() => assertPayrollExecutionConfirmation({ batchId, confirmation: "yes", amountCents: 1000, confirmedAmountCents: 1000 }), /επιβεβαίωσης/);
  assert.throws(() => assertPayrollExecutionConfirmation({ batchId, confirmation: payrollConfirmationPhrase(batchId), amountCents: 1000, confirmedAmountCents: 999 }), /ποσό/);
});

test("payroll provider: default DISABLED και μόνο ρητό GENERIC_HTTPS", () => {
  assert.deepEqual(payrollProviderAvailability({}), { enabled: false, kind: null });
  assert.throws(() => resolvePayrollPaymentProvider({}), /απενεργοποιημένη/);
  assert.throws(() => resolvePayrollPaymentProvider({ PAYROLL_PAYMENTS_PROVIDER: "BANK" }), /Μη υποστηριζόμενος/);
  assert.throws(() => resolvePayrollPaymentProvider({ PAYROLL_PAYMENTS_PROVIDER: "GENERIC_HTTPS", PAYROLL_PAYMENTS_PROVIDER_URL: "http://example.test" }), /HTTPS/);
  const provider = resolvePayrollPaymentProvider({ PAYROLL_PAYMENTS_PROVIDER: "GENERIC_HTTPS", PAYROLL_PAYMENTS_PROVIDER_URL: config.url, PAYROLL_PAYMENTS_PROVIDER_TOKEN: config.token, PAYROLL_PAYMENTS_PROVIDER_TIMEOUT_MS: "1000" });
  assert.equal(provider.name, "GENERIC_HTTPS");
  assert.deepEqual(payrollProviderAvailability({ PAYROLL_PAYMENTS_PROVIDER: "GENERIC_HTTPS" }), { enabled: true, kind: "GENERIC_HTTPS" });
});

test("generic HTTPS: σταθερό idempotency, scoped payload και validated success", async () => {
  let calls = 0;
  const provider = genericHttpsPayrollProvider(config, {
    resolveAddresses: publicDns,
    fetch: async (input, init) => {
      calls += 1;
      assert.equal(String(input), config.url);
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "manual");
      assert.ok(init?.signal);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Idempotency-Key"), "execution-a");
      assert.equal(headers.get("Authorization"), `Bearer ${config.token}`);
      const body = JSON.parse(String(init?.body)) as { idempotencyKey: string; amountCents: number; currency: string; payments: unknown[] };
      assert.equal(body.idempotencyKey, "execution-a");
      assert.equal(body.amountCents, 100000);
      assert.equal(body.currency, "EUR");
      assert.equal(body.payments.length, 1);
      return new Response(JSON.stringify({ status: "SUCCEEDED", reference: "provider-ref-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await provider.execute(request);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.status === "SUCCEEDED" ? result.reference : null, "provider-ref-1");
  assert.equal(calls, 1);
});

test("generic HTTPS: οριστική rejection δεν γίνεται success", async () => {
  const provider = genericHttpsPayrollProvider(config, { resolveAddresses: publicDns, fetch: async () => new Response(JSON.stringify({ status: "FAILED", code: "REJECTED" }), { status: 200, headers: { "Content-Type": "application/json" } }) });
  assert.deepEqual(await provider.execute(request), { status: "FAILED", code: "REJECTED" });
});

test("generic HTTPS: άγνωστο schema, HTTP σφάλμα και timeout παραμένουν UNCERTAIN", async () => {
  const responses = [
    new Response(JSON.stringify({ status: "SUCCEEDED", reference: "ref", rawIban: "secret" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    new Response("server error", { status: 500 }),
    new Response(JSON.stringify({ status: "SUCCEEDED", reference: "ref" }), { status: 200, headers: { "Content-Type": "text/plain" } }),
  ];
  for (const response of responses) {
    const provider = genericHttpsPayrollProvider(config, { resolveAddresses: publicDns, fetch: async () => response });
    assert.deepEqual(await provider.execute(request), { status: "UNCERTAIN", code: "PROVIDER_UNCERTAIN" });
  }
  const timeout = genericHttpsPayrollProvider(config, { resolveAddresses: publicDns, fetch: async () => { throw new Error(`timeout ${request.payments[0].iban}`); } });
  assert.deepEqual(await timeout.execute(request), { status: "UNCERTAIN", code: "PROVIDER_UNCERTAIN" });
});

test("generic HTTPS: private DNS αποκλείεται πριν από οποιοδήποτε request", async () => {
  let called = false;
  const provider = genericHttpsPayrollProvider(config, { resolveAddresses: async () => ["192.168.1.10"], fetch: async () => { called = true; return new Response(); } });
  assert.deepEqual(await provider.execute(request), { status: "UNCERTAIN", code: "PROVIDER_UNCERTAIN" });
  assert.equal(called, false);
});

test("statement reviewId: deterministic και store-scoped", () => {
  const base = { orgId: "org-a", accountId: "account-a", from: "2026-11-01", to: "2026-11-30", statement: [], ledger: [] };
  assert.equal(reviewBankStatementRows({ ...base, storeId: "store-a" }).reviewId, reviewBankStatementRows({ ...base, storeId: "store-a" }).reviewId);
  assert.notEqual(reviewBankStatementRows({ ...base, storeId: "store-a" }).reviewId, reviewBankStatementRows({ ...base, storeId: "store-b" }).reviewId);
});
