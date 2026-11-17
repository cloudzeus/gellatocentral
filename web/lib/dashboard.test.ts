import assert from "node:assert/strict";
import { test } from "node:test";
import { compare } from "./dashboard.ts";

test("compare: πάνω, κάτω, περίπου ίδιο, χωρίς χθες", () => {
  assert.deepEqual([compare(12000, 10000).tone, compare(12000, 10000).pct], ["up", 20]);
  assert.deepEqual([compare(8000, 10000).tone, compare(8000, 10000).pct], ["down", 20]);
  assert.equal(compare(10200, 10000).tone, "same");
  assert.equal(compare(5000, 0).tone, "none");
});
