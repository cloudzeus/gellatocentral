import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalStockTransferRequest,
  stockTransferRequestHash,
  StockTransferError,
  type StockTransferInput,
} from "./stock-transfer-request.ts";

const input: StockTransferInput = {
  clientKey: "6a052f42-02dd-4c59-91f2-2f0e93618c64",
  sourceWarehouseId: " source ",
  destinationWarehouseId: "destination",
  storeId: " store ",
  note: "  Μεταφορά πρώτων υλών  ",
  lines: [
    { genericItemId: "item-b", sourceLotId: " lot-b ", quantity: 2 },
    { genericItemId: "item-a", sourceLotId: null, quantity: 3 },
  ],
};

test("transfer request: trim, null normalization και σταθερή ταξινόμηση γραμμών", () => {
  assert.deepEqual(canonicalStockTransferRequest(input), {
    clientKey: input.clientKey,
    sourceWarehouseId: "source",
    destinationWarehouseId: "destination",
    storeId: "store",
    note: "Μεταφορά πρώτων υλών",
    lines: [
      { genericItemId: "item-a", sourceLotId: null, quantity: 3 },
      { genericItemId: "item-b", sourceLotId: "lot-b", quantity: 2 },
    ],
  });
});

test("transfer hash: η σειρά γραμμών και το clientKey δεν αλλάζουν το λογικό request", () => {
  const first = canonicalStockTransferRequest(input);
  const reordered = canonicalStockTransferRequest({
    ...input,
    clientKey: "479055a0-0be2-4f2b-aadb-41c282b4295d",
    lines: [...input.lines].reverse(),
  });
  assert.equal(stockTransferRequestHash("org-a", first), stockTransferRequestHash("org-a", reordered));
});

test("transfer hash: διαφέρει ανά tenant και ανά ουσιαστικό payload", () => {
  const request = canonicalStockTransferRequest(input);
  const hash = stockTransferRequestHash("org-a", request);
  assert.notEqual(stockTransferRequestHash("org-b", request), hash);
  for (const changed of [
    { ...input, destinationWarehouseId: "other" },
    { ...input, note: "άλλη σημείωση" },
    { ...input, lines: [{ ...input.lines[0]!, quantity: 3 }, input.lines[1]!] },
  ]) {
    assert.notEqual(stockTransferRequestHash("org-a", canonicalStockTransferRequest(changed)), hash);
  }
});

test("transfer request: απορρίπτει ίδιες αποθήκες, κενές/άκυρες ποσότητες και duplicates", () => {
  const cases: { input: StockTransferInput; code: StockTransferError["code"] }[] = [
    { input: { ...input, destinationWarehouseId: " source " }, code: "SAME_WAREHOUSE" },
    { input: { ...input, lines: [] }, code: "INVALID_TRANSFER_REQUEST" },
    { input: { ...input, lines: [{ genericItemId: "item", quantity: 0 }] }, code: "INVALID_TRANSFER_REQUEST" },
    { input: { ...input, lines: [{ genericItemId: "item", quantity: -1 }] }, code: "INVALID_TRANSFER_REQUEST" },
    { input: { ...input, lines: [{ genericItemId: "item", quantity: 1.5 }] }, code: "INVALID_TRANSFER_REQUEST" },
    { input: { ...input, lines: [{ genericItemId: "item", quantity: 2_147_483_648 }] }, code: "INVALID_TRANSFER_REQUEST" },
    {
      input: { ...input, lines: [{ genericItemId: "item", quantity: 1 }, { genericItemId: " item ", sourceLotId: null, quantity: 2 }] },
      code: "DUPLICATE_TRANSFER_LINE",
    },
  ];
  for (const entry of cases) {
    assert.throws(() => canonicalStockTransferRequest(entry.input), (error: unknown) => {
      assert.ok(error instanceof StockTransferError);
      assert.equal(error.code, entry.code);
      return true;
    });
  }
});
