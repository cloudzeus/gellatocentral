import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  syncBrowserPayment,
  type BrowserPaymentSale,
} from "./browser-payment.ts";
import type { VivaTerminalForVerification } from "./cloud-terminal.ts";

const sale = (status: BrowserPaymentSale["status"] = "AWAITING_PAYMENT"): BrowserPaymentSale => ({
  id: "sale-1",
  orgId: "org-1",
  storeId: "store-1",
  deviceId: "device-1",
  status,
  totalCents: 1250,
  payment: { amountCents: 1250, vivaSessionId: "session-1" },
});

const terminal: VivaTerminalForVerification = {
  orgId: "org-1",
  storeId: "store-1",
  deviceId: "device-1",
  terminalId: "terminal-1",
};

const successfulSession = (): Record<string, unknown> => ({
  success: true,
  sessionId: "session-1",
  merchantReference: "sale-1",
  cashRegisterId: "device-1",
  terminalId: "terminal-1",
  amount: 1250,
  transactionId: "transaction-1",
});

const unsuccessfulSession = (): Record<string, unknown> => ({
  success: false,
  sessionId: "session-1",
  merchantReference: "sale-1",
  cashRegisterId: "device-1",
  terminalId: "terminal-1",
  amount: 1250,
  eventId: 9,
});

function mutationLog() {
  const completed: { raw: Prisma.InputJsonObject; transactionId: string }[] = [];
  const failed: { reason: string; raw: Prisma.InputJsonObject }[] = [];
  return {
    completed,
    failed,
    mutations: {
      complete: async (raw: Prisma.InputJsonObject, transactionId: string) => { completed.push({ raw, transactionId }); },
      fail: async (reason: string, raw: Prisma.InputJsonObject) => { failed.push({ reason, raw }); },
    },
  };
}

test("browser verified success: ολοκληρώνει με provider raw και verified transaction id", async () => {
  const raw = successfulSession();
  const log = mutationLog();
  let requestedSession = "";
  const result = await syncBrowserPayment(sale(), terminal, log.mutations, async (sessionId) => {
    requestedSession = sessionId;
    return raw;
  });
  assert.equal(requestedSession, "session-1");
  assert.deepEqual(result, { status: "completed" });
  assert.deepEqual(log.completed, [{ raw: raw as Prisma.InputJsonObject, transactionId: "transaction-1" }]);
  assert.equal(log.failed.length, 0);
});

test("browser completed replay: επαληθεύει ξανά και αξιοποιεί το idempotent complete", async () => {
  const log = mutationLog();
  const result = await syncBrowserPayment(sale("COMPLETED"), terminal, log.mutations, async () => successfulSession());
  assert.deepEqual(result, { status: "completed" });
  assert.equal(log.completed.length, 1);
  assert.equal(log.failed.length, 0);
});

test("browser pending: καμία mutation", async () => {
  const log = mutationLog();
  const result = await syncBrowserPayment(sale(), terminal, log.mutations, async () => null);
  assert.deepEqual(result, { status: "pending" });
  assert.equal(log.completed.length, 0);
  assert.equal(log.failed.length, 0);
});

test("browser provider/network error: controlled result και καμία mutation", async () => {
  const log = mutationLog();
  const result = await syncBrowserPayment(sale(), terminal, log.mutations, async () => { throw new Error("offline"); });
  assert.deepEqual(result, { status: "error", error: "viva_unavailable" });
  assert.equal(log.completed.length, 0);
  assert.equal(log.failed.length, 0);
});

test("browser mismatch: controlled rejection χωρίς complete ή fail", async () => {
  const log = mutationLog();
  const result = await syncBrowserPayment(sale(), terminal, log.mutations, async () => ({
    ...successfulSession(),
    merchantReference: "other-sale",
  }));
  assert.deepEqual(result, { status: "rejected", reason: "session" });
  assert.equal(log.completed.length, 0);
  assert.equal(log.failed.length, 0);
});

test("browser τελικό provider failure: failSale μόνο για AWAITING_PAYMENT με provider raw", async () => {
  const raw = unsuccessfulSession();
  const log = mutationLog();
  const result = await syncBrowserPayment(sale(), terminal, log.mutations, async () => raw);
  assert.deepEqual(result, { status: "failed" });
  assert.equal(log.completed.length, 0);
  assert.deepEqual(log.failed, [{
    reason: "Η πληρωμή δεν ολοκληρώθηκε (eventId 9)",
    raw: raw as Prisma.InputJsonObject,
  }]);
});

test("browser unsuccessful ή mismatched replay/failure: δεν γυρίζει την πώληση σε πρόχειρο", async (t) => {
  const cases = [
    { name: "COMPLETED replay", current: sale("COMPLETED"), response: unsuccessfulSession(), reason: "unsuccessful" },
    { name: "mismatched failure", current: sale(), response: { ...unsuccessfulSession(), terminalId: "other-terminal" }, reason: "session" },
    { name: "ασαφής απάντηση", current: sale(), response: { ...unsuccessfulSession(), success: undefined }, reason: "unsuccessful" },
    { name: "failure με λάθος ποσό", current: sale(), response: { ...unsuccessfulSession(), amount: 1251 }, reason: "amount" },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    const log = mutationLog();
    const result = await syncBrowserPayment(c.current, terminal, log.mutations, async () => c.response);
    assert.deepEqual(result, { status: "rejected", reason: c.reason });
    assert.equal(log.completed.length, 0);
    assert.equal(log.failed.length, 0);
  });
});
