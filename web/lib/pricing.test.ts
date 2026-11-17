import assert from "node:assert/strict";
import { test } from "node:test";
import { withVat } from "./pricing.ts";

test("ποσό πληρωμής με ΦΠΑ 24%", () => {
  assert.equal(withVat(8900), 11036);
  assert.equal(withVat(7400), 9176);
  assert.equal(withVat(1), 1); // 1,24 λεπτά → 1
  assert.equal(withVat(0), 0);
});
