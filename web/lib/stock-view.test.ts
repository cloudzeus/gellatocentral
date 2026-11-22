import assert from "node:assert/strict";
import { test } from "node:test";
import { daysUntil, isExpired } from "./production.ts";
import { expiryStatus, safeStockNumber, stockDisplayUnit, stockUnitCostHundredths, stockValueHundredths } from "./stock-view.ts";

const d = (value: string) => new Date(value);

test("αποτίμηση: κλίμακα ανά διάσταση και σωστή μονάδα εμφάνισης", () => {
  assert.equal(stockValueHundredths(2_000_000, 12_000, "mass"), 24_000); // 2 kg × 1,20 €/kg
  assert.equal(stockUnitCostHundredths(12_000, 1_000_000, "mass"), 12_000);
  assert.equal(stockValueHundredths(2_000, 12_000, "volume"), 24_000); // 2 l × 1,20 €/l
  assert.equal(stockUnitCostHundredths(350_000, 1, "count"), 350); // 0,035 €/τεμ.
  assert.equal(stockDisplayUnit({ code: "mg", dimension: "mass", toBase: 1 }).code, "kg");
  assert.equal(stockDisplayUnit({ code: "ml", dimension: "volume", toBase: 1 }).code, "l");
  assert.equal(stockValueHundredths(-500_000, 12_000, "mass"), -6_000);
  assert.equal(stockValueHundredths(1, 500, "count"), 1);
  assert.equal(stockValueHundredths(-1, 500, "count"), -1);
  assert.equal(stockValueHundredths(0, 12_000, "mass"), 0);
});

test("αποτίμηση: ακυρα δεδομένα και υπέρβαση safe integer απορρίπτονται", () => {
  assert.throws(() => stockValueHundredths(Number.MAX_SAFE_INTEGER, 2_000, "count"));
  assert.throws(() => stockValueHundredths(1.5, 2, "mass"));
  assert.throws(() => stockValueHundredths(1, -2, "mass"));
  assert.throws(() => stockUnitCostHundredths(5, 0, "mass"));
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
