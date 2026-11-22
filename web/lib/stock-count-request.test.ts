import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertFinalizableStockCountLine,
  canonicalStockCountMeasurement,
  canonicalStockCountRequest,
  stockCountedOnDate,
  stockCountDifference,
  stockCountRequestHash,
  StockCountError,
  type StockCountInput,
} from "./stock-count-request.ts";

const input: StockCountInput = {
  clientKey: "6a052f42-02dd-4c59-91f2-2f0e93618c64",
  warehouseId: " warehouse ",
  countedOn: " 2026-11-22 ",
  note: "  Μηνιαία απογραφή  ",
};

function expectCode(work: () => unknown, code: StockCountError["code"]) {
  assert.throws(work, (error: unknown) => {
    assert.ok(error instanceof StockCountError);
    assert.equal(error.code, code);
    return true;
  });
}

test("count request: trim, null normalization και canonical hash", () => {
  const canonical = canonicalStockCountRequest(input);
  assert.deepEqual(canonical, {
    clientKey: input.clientKey,
    storeId: null,
    warehouseId: "warehouse",
    countedOn: "2026-11-22",
    note: "Μηνιαία απογραφή",
  });
  assert.equal(canonicalStockCountRequest({ ...input, note: "  " }).note, null);
  const rekeyed = canonicalStockCountRequest({ ...input, clientKey: "479055a0-0be2-4f2b-aadb-41c282b4295d" });
  assert.equal(stockCountRequestHash("org-a", canonical), stockCountRequestHash("org-a", rekeyed));
});

test("count request: το hash αλλάζει ανά tenant, store και ουσιαστικό payload", () => {
  const request = canonicalStockCountRequest(input);
  const hash = stockCountRequestHash("org-a", request);
  assert.notEqual(stockCountRequestHash("org-b", request), hash);
  for (const changed of [
    { ...input, storeId: " store-a " },
    { ...input, warehouseId: "other" },
    { ...input, countedOn: "2026-11-23" },
    { ...input, note: "άλλη σημείωση" },
  ]) {
    assert.notEqual(stockCountRequestHash("org-a", canonicalStockCountRequest(changed)), hash);
  }
  assert.equal(stockCountRequestHash("org-a", request), stockCountRequestHash("org-a", canonicalStockCountRequest({ ...input, storeId: null })));
});

test("count date: δέχεται μόνο πραγματικά ISO calendar dates", () => {
  assert.equal(stockCountedOnDate("2028-02-29").toISOString(), "2028-02-29T00:00:00.000Z");
  for (const value of ["", "2026-1-01", "2026-02-29", "2026-13-01", "2026-04-31", "2026-11-22x", "22/11/2026"]) {
    expectCode(() => stockCountedOnDate(value), "INVALID_COUNT_REQUEST");
  }
});

test("count measurement: κενό actual επιτρέπεται στο draft· άκυροι αριθμοί απορρίπτονται", () => {
  assert.deepEqual(canonicalStockCountMeasurement({ actualQty: null, reason: "  " }), { actualQty: null, reason: null });
  assert.deepEqual(canonicalStockCountMeasurement({ actualQty: 0, reason: "  λόγος  " }), { actualQty: 0, reason: "λόγος" });
  for (const actualQty of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    expectCode(() => canonicalStockCountMeasurement({ actualQty }), "INVALID_COUNT_LINE");
  }
  expectCode(() => canonicalStockCountMeasurement({ actualQty: 1, reason: "x".repeat(201) }), "INVALID_COUNT_LINE");
});

test("count difference: υπολογίζει persisted τιμή και απορρίπτει Int overflow", () => {
  assert.equal(stockCountDifference(10, null), null);
  assert.equal(stockCountDifference(10, 8), -2);
  assert.equal(stockCountDifference(10, 12), 2);
  assert.equal(stockCountDifference(10, 10), 0);
  expectCode(() => stockCountDifference(-1, 2_147_483_647), "INVALID_COUNT_LINE");
});

test("count finalize validation: missing actual, reason και persisted mismatch", () => {
  expectCode(() => assertFinalizableStockCountLine({ expectedQty: 10, actualQty: null, differenceQty: null, reason: null }), "MISSING_ACTUAL_QUANTITY");
  expectCode(() => assertFinalizableStockCountLine({ expectedQty: 10, actualQty: 8, differenceQty: -2, reason: " " }), "MISSING_DIFFERENCE_REASON");
  expectCode(() => assertFinalizableStockCountLine({ expectedQty: 10, actualQty: 8, differenceQty: -2, reason: "απ" }), "MISSING_DIFFERENCE_REASON");
  expectCode(() => assertFinalizableStockCountLine({ expectedQty: 10, actualQty: 8, differenceQty: -1, reason: "σπασίματα" }), "INVALID_COUNT_LINE");
  assert.deepEqual(assertFinalizableStockCountLine({ expectedQty: 10, actualQty: 8, differenceQty: -2, reason: " σπασίματα " }), { differenceQty: -2, reason: "σπασίματα" });
  assert.deepEqual(assertFinalizableStockCountLine({ expectedQty: 10, actualQty: 10, differenceQty: 0, reason: null }), { differenceQty: 0, reason: null });
});
