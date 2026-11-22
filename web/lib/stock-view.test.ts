import assert from "node:assert/strict";
import { test } from "node:test";
import { daysUntil, isExpired } from "./production.ts";
import { expiryStatus, safeStockNumber, stockUnitCostHundredths, stockValueHundredths } from "./stock-view.ts";

const d = (value: string) => new Date(value);

test("αποτίμηση: ποσότητα βάσης × κόστος βάσης και σωστή μονάδα εμφάνισης", () => {
  // 2 kg = 2.000.000 mg · 5 εκατοστά λεπτού/mg = 1.000 € συνολικά.
  assert.equal(stockValueHundredths(2_000_000, 5), 10_000_000);
  // 5 εκατοστά λεπτού/mg = 5.000 εκατοστά λεπτού/g = 0,50 €/g.
  assert.equal(stockUnitCostHundredths(5, 1_000), 5_000);
  assert.equal(stockValueHundredths(0, 5), 0);
});

test("αποτίμηση: ακυρα δεδομένα και υπέρβαση safe integer απορρίπτονται", () => {
  assert.throws(() => stockValueHundredths(Number.MAX_SAFE_INTEGER, 2));
  assert.throws(() => stockValueHundredths(1.5, 2));
  assert.throws(() => stockValueHundredths(1, -2));
  assert.throws(() => stockUnitCostHundredths(5, 0));
  assert.throws(() => safeStockNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n));
});

test("λήξη: χειμερινά μεσάνυχτα Europe/Athens και όχι κυλιόμενο 24ωρο", () => {
  const expiry = d("2026-11-22T00:00:00Z");
  const beforeMidnight = d("2026-11-22T21:59:00Z"); // 23:59 στην Αθήνα
  const atMidnight = d("2026-11-22T22:00:00Z"); // 00:00 στις 23/11
  assert.equal(daysUntil(expiry, beforeMidnight), 0);
  assert.equal(isExpired(expiry, beforeMidnight), false);
  assert.deepEqual(expiryStatus(expiry, beforeMidnight), { status: "today", days: 0 });
  assert.equal(daysUntil(expiry, atMidnight), -1);
  assert.equal(isExpired(expiry, atMidnight), true);
  assert.equal(expiryStatus(expiry, atMidnight).status, "expired");
});

test("λήξη: θερινά μεσάνυχτα Europe/Athens και expiry buckets", () => {
  const expiry = d("2026-06-30T00:00:00Z");
  assert.equal(daysUntil(expiry, d("2026-06-30T20:59:00Z")), 0);
  assert.equal(daysUntil(expiry, d("2026-06-30T21:00:00Z")), -1);
  assert.equal(expiryStatus(null).status, "none");
  assert.equal(expiryStatus(d("2026-11-29T00:00:00Z"), d("2026-11-22T12:00:00Z")).status, "urgent");
  assert.equal(expiryStatus(d("2026-12-07T00:00:00Z"), d("2026-11-22T12:00:00Z")).status, "valid");
});
