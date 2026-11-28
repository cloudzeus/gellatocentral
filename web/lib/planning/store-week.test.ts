import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays } from "./production-suggest.ts";
import { backtestAccuracy, storeWeek, sumHistory } from "./store-week.ts";

test("σύνολο ημέρας: αθροίζει τα είδη, η εξάντληση ενός λογοκρίνει την ημέρα", () => {
  const sum = sumHistory([[{ day: "2026-11-01", qty: 4, stockout: false }, { day: "2026-11-02", qty: 2, stockout: true }], [{ day: "2026-11-01", qty: 6, stockout: false }]]);
  assert.deepEqual(sum, [{ day: "2026-11-01", qty: 10, stockout: false }, { day: "2026-11-02", qty: 2, stockout: true }]);
});

test("εβδομάδα και ακρίβεια: σταθερή ζήτηση χωρίς καιρό → ίδια με/χωρίς καιρό, MAPE 0", () => {
  const today = "2026-11-30";
  const history = Array.from({ length: 120 }, (_, i) => ({ day: addDays(today, -120 + i), qty: 10_000_000, stockout: false }));
  const week = storeWeek(history, new Map(), today);
  assert.equal(week.days.length, 7);
  for (const d of week.days) {
    assert.equal(d.withWeather, d.withoutWeather);
    assert.ok(Math.abs(d.withWeather - 10_000_000) <= 1, `${d.withWeather}`);
  }
  const acc = backtestAccuracy(history, new Map(), today);
  assert.equal(acc.days, 28);
  assert.ok(acc.mape !== null && acc.mape < 0.5, `${acc.mape}`);
});
