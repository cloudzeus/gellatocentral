import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalStockCorrection } from "./stock-correction-request.ts";
import { StockError } from "./stock-db.ts";

const input = {
  warehouseId: "warehouse",
  genericItemId: "generic",
  lotId: null,
  quantity: -5,
  reason: "  σπασίματα συσκευασίας  ",
};

test("stock correction: canonical αιτιολογία 3–200 και μη μηδενικός ακέραιος", () => {
  assert.deepEqual(canonicalStockCorrection(input), { ...input, storeId: null, reason: "σπασίματα συσκευασίας" });
  for (const quantity of [0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    assert.throws(() => canonicalStockCorrection({ ...input, quantity }), (error: unknown) => {
      assert.ok(error instanceof StockError);
      assert.equal(error.code, "INVALID_STOCK_INPUT");
      return true;
    });
  }
  for (const reason of ["", "  ", "απ", "x".repeat(201)]) {
    assert.throws(() => canonicalStockCorrection({ ...input, reason }), StockError);
  }
  assert.equal(canonicalStockCorrection({ ...input, reason: "x".repeat(200) }).reason.length, 200);
});
