import assert from "node:assert/strict";
import { test } from "node:test";
import { isLowStock, stockExpiryBucket } from "./stock-alerts.ts";

const now = new Date("2026-11-22T12:00:00.000Z");
const on = (day: string) => new Date(`${day}T12:00:00.000Z`);

test("STK-09: low stock μόνο κάτω από ρητό threshold, με σωστό zero/negative handling", () => {
  assert.equal(isLowStock(0, 0), false);
  assert.equal(isLowStock(-1, 0), true);
  assert.equal(isLowStock(9, 10), true);
  assert.equal(isLowStock(10, 10), false);
  assert.equal(isLowStock(11, 10), false);
});

test("STK-09: expiry buckets στα ακριβή όρια 0/3/4/7/8/30/31 ημερών", () => {
  assert.equal(stockExpiryBucket(null, now), null);
  assert.equal(stockExpiryBucket(on("2026-11-21"), now), "expired");
  assert.equal(stockExpiryBucket(on("2026-11-22"), now), "0-3");
  assert.equal(stockExpiryBucket(on("2026-11-25"), now), "0-3");
  assert.equal(stockExpiryBucket(on("2026-11-26"), now), "4-7");
  assert.equal(stockExpiryBucket(on("2026-11-29"), now), "4-7");
  assert.equal(stockExpiryBucket(on("2026-11-30"), now), "8-30");
  assert.equal(stockExpiryBucket(on("2026-12-22"), now), "8-30");
  assert.equal(stockExpiryBucket(on("2026-12-23"), now), null);
});

test("STK-09: τα buckets ακολουθούν την ημερολογιακή ημέρα Europe/Athens", () => {
  assert.equal(stockExpiryBucket(new Date("2026-11-25T23:30:00.000Z"), now), "4-7");
  assert.equal(stockExpiryBucket(new Date("2026-11-25T21:30:00.000Z"), now), "0-3");
});
