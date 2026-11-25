import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, targetPace } from "./dashboard.ts";

test("compare: πάνω, κάτω, περίπου ίδιο, χωρίς χθες", () => {
  assert.deepEqual([compare(12000, 10000).tone, compare(12000, 10000).pct], ["up", 20]);
  assert.deepEqual([compare(8000, 10000).tone, compare(8000, 10000).pct], ["down", 20]);
  assert.equal(compare(10200, 10000).tone, "same");
  assert.equal(compare(5000, 0).tone, "none");
});

test("targetPace: πρώτη του μήνα, πίσω, μπροστά, πιάστηκε, τελευταία μέρα", () => {
  // 1η του μήνα χωρίς πωλήσεις: δεν έχει κλείσει καμία μέρα, άρα δεν είσαι πίσω
  assert.deepEqual(targetPace(0, 3_000_000, 1, 30), { pct: 0, expectedPct: 0, gapCents: 0, perDayCents: 100_000, tone: "ok" });
  // 25 του μήνα (24 κλειστές μέρες από 30 = 80%), στο 76%
  assert.deepEqual(targetPace(2_430_000, 3_200_000, 25, 30), { pct: 76, expectedPct: 80, gapCents: 130_000, perDayCents: 128_334, tone: "behind" });
  const ahead = targetPace(2_000_000, 3_000_000, 16, 30);
  assert.deepEqual([ahead.tone, ahead.pct, ahead.expectedPct, ahead.gapCents], ["ok", 67, 50, -500_000]);
  assert.equal(targetPace(1_460_000, 3_000_000, 16, 30).tone, "ok"); // 2,7% κάτω από το αναμενόμενο: όχι είδηση
  assert.deepEqual([targetPace(3_100_000, 3_000_000, 20, 30).tone, targetPace(3_100_000, 3_000_000, 20, 30).perDayCents], ["done", 0]);
  // τελευταία μέρα: ό,τι λείπει πρέπει να γίνει σήμερα
  assert.deepEqual(targetPace(2_900_000, 3_000_000, 30, 30), { pct: 97, expectedPct: 97, gapCents: 0, perDayCents: 100_000, tone: "ok" });
  assert.deepEqual([targetPace(2_000_000, 3_000_000, 31, 31).tone, targetPace(2_000_000, 3_000_000, 31, 31).perDayCents], ["behind", 1_000_000]);
});
