import assert from "node:assert/strict";
import { test } from "node:test";
import { rateLimited } from "./rate-limit.ts";

test("όριο ρυθμού: κόβει μετά το όριο και ξανανοίγει στο επόμενο παράθυρο, ανά κλειδί", () => {
  const key = `t:${Math.random()}`;
  for (let i = 0; i < 3; i += 1) assert.equal(rateLimited(key, 3, 1000, 0), false);
  assert.equal(rateLimited(key, 3, 1000, 500), true);
  assert.equal(rateLimited(`${key}:άλλο`, 3, 1000, 500), false);
  assert.equal(rateLimited(key, 3, 1000, 1000), false);
});
