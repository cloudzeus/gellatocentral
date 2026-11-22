import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoMovementAfterSnapshot, stockBalance, stockBalances, StockError, type StockDb } from "./stock-db.ts";

const key = { orgId: "org-a", warehouseId: "w1", genericItemId: "g1", lotId: null };

test("stockBalance: πλήρες stock key, συμπεριλαμβανομένου του null lot", async () => {
  let captured: unknown;
  const tx = {
    stockMovement: {
      aggregate: async (args: unknown) => {
        captured = args;
        return { _sum: { quantity: null } };
      },
    },
  } as unknown as Pick<StockDb, "stockMovement">;
  assert.equal(await stockBalance(tx, key), 0);
  assert.deepEqual(captured, {
    where: { orgId: "org-a", warehouseId: "w1", genericItemId: "g1", lotId: null },
    _sum: { quantity: true },
  });
});

test("stockBalances: aggregation ανά warehouse/generic/lot και διατήρηση no-lot εγγραφών", async () => {
  let captured: { where?: unknown } | undefined;
  const tx = {
    stockMovement: {
      groupBy: async (args: { where?: unknown }) => {
        captured = args;
        return [
          { warehouseId: "w1", genericItemId: "g1", lotId: null, _sum: { quantity: 5 } },
          { warehouseId: "w1", genericItemId: "g1", lotId: "l1", _sum: { quantity: 10 } },
          { warehouseId: "w1", genericItemId: null, lotId: null, _sum: { quantity: -2 } },
        ];
      },
    },
  } as unknown as Pick<StockDb, "stockMovement">;
  const rows = await stockBalances(tx, { orgId: "org-a", warehouseIds: ["w1"], storeId: "s1" });
  assert.deepEqual(rows, [
    { orgId: "org-a", warehouseId: "w1", genericItemId: "g1", lotId: null, quantity: 5 },
    { orgId: "org-a", warehouseId: "w1", genericItemId: "g1", lotId: "l1", quantity: 10 },
  ]);
  assert.deepEqual(captured?.where, {
    orgId: "org-a",
    genericItemId: { not: null },
    warehouseId: { in: ["w1"] },
    warehouse: { orgId: "org-a", stores: { some: { storeId: "s1" } } },
  });
});

test("stockBalances: κενό επιτρεπτό warehouse set δεν μετατρέπεται σε όλα τα warehouses", async () => {
  let called = false;
  const tx = {
    stockMovement: {
      groupBy: async () => {
        called = true;
        return [];
      },
    },
  } as unknown as Pick<StockDb, "stockMovement">;
  assert.deepEqual(await stockBalances(tx, { orgId: "org-a", warehouseIds: [] }), []);
  assert.equal(called, false);
});

test("snapshot conflict: βασίζεται στο recordedAt και όχι στο occurredAt", async () => {
  const snapshotAt = new Date("2026-11-22T10:00:00Z");
  let found = false;
  const tx = {
    stockMovement: {
      findFirst: async () => found ? { id: "m1" } : null,
    },
  } as unknown as Pick<StockDb, "stockMovement">;
  await assertNoMovementAfterSnapshot(tx, { orgId: "org-a", warehouseId: "w1", snapshotAt });
  found = true;
  await assert.rejects(assertNoMovementAfterSnapshot(tx, { orgId: "org-a", warehouseId: "w1", snapshotAt }), (error: unknown) => {
    assert.ok(error instanceof StockError);
    assert.equal(error.code, "STOCK_CHANGED_SINCE_SNAPSHOT");
    return true;
  });
});
