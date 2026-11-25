import assert from "node:assert/strict";
import { test } from "node:test";
import { validAfm } from "./afm.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { setupSteps } from "./setup.ts";

test("ΑΦΜ", () => {
  assert.equal(validAfm("094014201"), true); // ΑΦΜ ΟΤΕ
  assert.equal(validAfm("094014202"), false);
  assert.equal(validAfm("12345"), false);
  assert.equal(validAfm("000000000"), false);
});

test("βήματα αρχικοποίησης", () => {
  const now = new Date("2026-11-16");
  const empty = setupSteps({ vivaMerchantId: null, subscription: null, stores: [] }, now);
  assert.equal(empty.filter((s) => s.done).length, 0);
  const ready = setupSteps({
    vivaMerchantId: "m",
    subscription: { status: "ACTIVE", currentPeriodEnd: new Date("2026-12-01") },
    stores: [{ active: true, warehouses: [{ active: true }], devices: [{ active: true, vivaTerminalId: "1", printerId: "p" }] }],
  }, now);
  assert.equal(ready.every((s) => s.done), true);
  // ληγμένη συνδρομή και ανενεργό ταμείο δεν μετράνε
  const stale = setupSteps({
    vivaMerchantId: "m",
    subscription: { status: "ACTIVE", currentPeriodEnd: new Date("2026-11-01") },
    stores: [{ active: true, warehouses: [], devices: [{ active: false, vivaTerminalId: "1", printerId: "p" }] }],
  }, now);
  assert.deepEqual(stale.map((s) => s.done), [false, true, true, false, false, false]);
});

test("κωδικοί", async () => {
  const h = hashPassword("σωστός-κωδικός-1");
  assert.equal(await verifyPassword("σωστός-κωδικός-1", h), true);
  assert.equal(await verifyPassword("λάθος", h), false);
  assert.equal(await verifyPassword("x", null), false);
  assert.notEqual(h, hashPassword("σωστός-κωδικός-1")); // διαφορετικό αλάτι κάθε φορά
});
