import assert from "node:assert/strict";
import { test } from "node:test";
import {
  verifySaleSession,
  type VivaSaleForVerification,
  type VivaTerminalForVerification,
} from "./cloud-terminal.ts";

const sale = (): VivaSaleForVerification => ({
  id: "sale-1",
  orgId: "org-1",
  storeId: "store-1",
  deviceId: "device-1",
  totalCents: 1250,
  payment: { amountCents: 1250, vivaSessionId: "session-1" },
});

const terminal = (): VivaTerminalForVerification => ({
  orgId: "org-1",
  storeId: "store-1",
  deviceId: "device-1",
  terminalId: "terminal-1",
});

const successfulSession = (): Record<string, unknown> => ({
  success: true,
  sessionId: "session-1",
  merchantReference: "sale-1",
  cashRegisterId: "device-1",
  terminalId: "terminal-1",
  amount: 1250,
  transactionId: "transaction-1",
});

test("επιτυχία: χρησιμοποιεί το αποθηκευμένο session και επιστρέφει μόνο τα στοιχεία της Viva", async () => {
  const raw = successfulSession();
  let requestedSession = "";
  const result = await verifySaleSession(sale(), terminal(), "transaction-1", async (sessionId) => {
    requestedSession = sessionId;
    return raw;
  });
  assert.equal(requestedSession, "session-1");
  assert.deepEqual(result, { status: "verified", transactionId: "transaction-1", raw });
});

test("pending Viva session: ξεκάθαρη αναμονή χωρίς απόδειξη ολοκλήρωσης", async () => {
  const result = await verifySaleSession(sale(), terminal(), undefined, async () => null);
  assert.deepEqual(result, { status: "pending" });
});

test("λάθος session, sale, device, transaction ή ποσό απορρίπτονται fail-closed", async (t) => {
  const cases: { name: string; response: Record<string, unknown>; reason: string }[] = [
    { name: "sessionId", response: { ...successfulSession(), sessionId: "other-session" }, reason: "session" },
    { name: "merchantReference", response: { ...successfulSession(), merchantReference: "other-sale" }, reason: "session" },
    { name: "cashRegisterId", response: { ...successfulSession(), cashRegisterId: "other-device" }, reason: "session" },
    { name: "terminalId", response: { ...successfulSession(), terminalId: "other-terminal" }, reason: "session" },
    { name: "amount", response: { ...successfulSession(), amount: 1251 }, reason: "amount" },
    { name: "transactionId", response: { ...successfulSession(), transactionId: "other-transaction" }, reason: "transaction" },
    { name: "missing transactionId", response: { ...successfulSession(), transactionId: null }, reason: "transaction" },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    const result = await verifySaleSession(sale(), terminal(), "transaction-1", async () => c.response);
    assert.deepEqual(result, { status: "rejected", reason: c.reason });
  });
});

test("τελική αποτυχία επιστρέφει provider raw, αλλά mismatch παραμένει mismatch", async (t) => {
  const failure = { ...successfulSession(), success: false, eventId: 9 };
  const result = await verifySaleSession(sale(), terminal(), undefined, async () => failure);
  assert.deepEqual(result, { status: "rejected", reason: "unsuccessful", raw: failure });

  await t.test("λάθος terminal σε success=false", async () => {
    const mismatched = await verifySaleSession(sale(), terminal(), undefined, async () => ({ ...failure, terminalId: "other-terminal" }));
    assert.deepEqual(mismatched, { status: "rejected", reason: "session" });
  });
  await t.test("λάθος ποσό σε success=false", async () => {
    const mismatched = await verifySaleSession(sale(), terminal(), undefined, async () => ({ ...failure, amount: 1251 }));
    assert.deepEqual(mismatched, { status: "rejected", reason: "amount" });
  });
});

test("provider ή network failure διαφεύγει προς τον caller και δεν παράγει επιτυχία", async () => {
  await assert.rejects(
    verifySaleSession(sale(), terminal(), undefined, async () => { throw new Error("offline"); }),
    /offline/,
  );
});

test("tenant, store και device binding απορρίπτονται πριν από κλήση στον provider", async (t) => {
  const cases: { name: string; sale: VivaSaleForVerification; terminal: VivaTerminalForVerification }[] = [
    { name: "λάθος tenant", sale: { ...sale(), orgId: "other-org" }, terminal: terminal() },
    { name: "λάθος store", sale: { ...sale(), storeId: "other-store" }, terminal: terminal() },
    { name: "λάθος device", sale: { ...sale(), deviceId: "other-device" }, terminal: terminal() },
    { name: "χωρίς Viva terminal", sale: sale(), terminal: { ...terminal(), terminalId: null } },
    { name: "χωρίς αποθηκευμένο session", sale: { ...sale(), payment: { amountCents: 1250, vivaSessionId: null } }, terminal: terminal() },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    let providerCalls = 0;
    const result = await verifySaleSession(c.sale, c.terminal, undefined, async () => {
      providerCalls += 1;
      return successfulSession();
    });
    assert.deepEqual(result, { status: "rejected", reason: "binding" });
    assert.equal(providerCalls, 0);
  });
});

test("ασυνέπεια αποθηκευμένου ποσού πώλησης και πληρωμής δεν ερωτά τον provider", async () => {
  const current = sale();
  current.payment!.amountCents = 1200;
  let providerCalls = 0;
  const result = await verifySaleSession(current, terminal(), undefined, async () => {
    providerCalls += 1;
    return successfulSession();
  });
  assert.deepEqual(result, { status: "rejected", reason: "amount" });
  assert.equal(providerCalls, 0);
});

test("κίνηση χρημάτων: timeout ή δίκτυο = άγνωστο αποτέλεσμα, άρνηση της Viva = βέβαιη αποτυχία", async () => {
  const { sendTransaction, VivaUnknownOutcomeError } = await import("./cloud-terminal.ts");
  const dropped = (async () => { throw new DOMException("timeout", "TimeoutError"); }) as unknown as typeof fetch;
  await assert.rejects(sendTransaction("refund", "https://viva.test/refund", "token", "{}", dropped), VivaUnknownOutcomeError);
  const refused = (async () => new Response("bad terminal", { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(sendTransaction("refund", "https://viva.test/refund", "token", "{}", refused), (e: Error) => !(e instanceof VivaUnknownOutcomeError) && /HTTP 400/.test(e.message));
  const accepted = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  await sendTransaction("sale", "https://viva.test/sale", "token", "{}", accepted);
});
