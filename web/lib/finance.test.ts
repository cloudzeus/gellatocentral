import assert from "node:assert/strict";
import { test } from "node:test";
import { athensBusinessRange, expectedCashCents, paymentBucket, purchaseTotals } from "./finance.ts";

test("οικονομικά: σύνολο προμηθευτή με εκπτώσεις και έξοδα", () => {
  assert.deepEqual(purchaseTotals({ shippingCostCents: 100, otherExpensesCents: 50, expensesVatRate: 24 }, [{ quantity: 2, unitPriceCents: 1000, discountBps: 1000, vatRate: 24 }]), { netCents: 1950, vatCents: 468, totalCents: 2418 });
});

test("οικονομικά: expected cash χωρίς κάρτες, platforms ή transfers", () => {
  assert.equal(expectedCashCents(10000, 5000, 1200), 13800);
  assert.equal(paymentBucket({ code: "cash", ledgerKind: "CASH" }), "cash");
  assert.equal(paymentBucket({ code: "wolt", ledgerKind: "BANK" }), "platform");
  assert.equal(paymentBucket({ code: "credit", ledgerKind: "CREDIT" }), "credit");
});

test("οικονομικά: επιχειρησιακή ημέρα Athens και DST", () => {
  const winter = athensBusinessRange(new Date("2026-11-24T00:00:00.000Z"));
  assert.equal(winter.fromAt.toISOString(), "2026-11-23T22:00:00.000Z");
  assert.equal(winter.toAt.toISOString(), "2026-11-24T22:00:00.000Z");
  const summer = athensBusinessRange(new Date("2026-07-01T00:00:00.000Z"));
  assert.equal(summer.fromAt.toISOString(), "2026-06-30T21:00:00.000Z");
  assert.equal(summer.toAt.toISOString(), "2026-07-01T21:00:00.000Z");
});
