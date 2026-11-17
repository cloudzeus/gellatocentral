import assert from "node:assert/strict";
import { test } from "node:test";
import { isBillable, monthlyCharge, PRICE_PER_DEVICE, PRICE_PER_STORE } from "./pricing.ts";
import { withVat } from "./viva/checkout.ts";

test("χρέωση = καταστήματα + συσκευές", () => {
  assert.equal(monthlyCharge(2, 3).totalCents, 2 * PRICE_PER_STORE + 3 * PRICE_PER_DEVICE);
  assert.equal(monthlyCharge(0, 0).totalCents, 0);
});

test("απορρίπτει αρνητικά και δεκαδικά", () => {
  assert.throws(() => monthlyCharge(-1, 0));
  assert.throws(() => monthlyCharge(1, 1.5));
});

test("ποσό πληρωμής με ΦΠΑ 24%", () => {
  assert.equal(withVat(8900), 11036);
  assert.equal(withVat(7400), 9176);
  assert.equal(withVat(1), 1); // 1,24 λεπτά → 1
  assert.equal(withVat(0), 0);
});

test("χρεώνονται μόνο οι συσκευές που τιμολογούν", () => {
  assert.equal(isBillable("POS_WEB"), true);
  assert.equal(isBillable("POS_ANDROID"), true);
  assert.equal(isBillable("KITCHEN_DISPLAY"), false);
});
