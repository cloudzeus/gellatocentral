import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import {
  assertNoMovementAfterSnapshot,
  postLegacyStockMovement,
  postStockMovement,
  stockBalance,
  stockBalances,
  StockError,
  type PostStockMovementInput,
} from "./stock-db.ts";
import { stockTransaction } from "./stock-transaction.ts";

// Πραγματικό PostgreSQL, όχι fake: τα fixtures είναι νέα tenants και καθαρίζονται πάντα.
const databaseOptions = { skip: !process.env.DATABASE_URL };
const actor = { id: null, name: "STK-01 integration" };

type Fixture = {
  orgId: string;
  warehouseId: string;
  genericItemId: string;
  lotId: string;
  unitId: string;
  ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `STK-01 ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη integration" } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Υλικό integration", baseUnitId: unit.id } });
    const lot = await tx.stockLot.create({ data: { orgId: org.id, genericItemId: generic.id, warehouseId: warehouse.id, batchNumber: `LOT-${suffix}` } });
    return { orgId: org.id, warehouseId: warehouse.id, genericItemId: generic.id, lotId: lot.id, unitId: unit.id, ownsUnit: !existingUnit };
  });
}

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

function write(f: Fixture, quantity: number, override: Partial<PostStockMovementInput> = {}) {
  return stockTransaction((tx) => postStockMovement(tx, {
    orgId: f.orgId,
    warehouseId: f.warehouseId,
    genericItemId: f.genericItemId,
    lotId: f.lotId,
    quantity,
    source: "manual",
    actor,
    ...override,
  }));
}

async function expectCode(promise: Promise<unknown>, code: StockError["code"]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof StockError);
    assert.equal(error.code, code);
    return true;
  });
}

test("PostgreSQL: lot/no-lot balances, negative guard και DB recordedAt", databaseOptions, async () => {
  const f = await fixture();
  try {
    const oldBusinessDate = new Date("2020-01-01T00:00:00Z");
    const snapshotBefore = new Date();
    const movement = await write(f, 10, { occurredAt: oldBusinessDate });
    await write(f, 5, { lotId: null });
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: f.lotId }), 10);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: null }), 5);
    assert.deepEqual(
      (await stockBalances(db, { orgId: f.orgId, warehouseIds: [f.warehouseId] })).map((row) => ({ lotId: row.lotId, quantity: row.quantity })),
      [{ lotId: f.lotId, quantity: 10 }, { lotId: null, quantity: 5 }], // PostgreSQL ASC: NULLS LAST
    );
    await expectCode(write(f, -11), "NEGATIVE_STOCK_NOT_ALLOWED");
    await expectCode(write(f, -6, { lotId: null }), "NEGATIVE_STOCK_NOT_ALLOWED");
    assert.equal(movement.occurredAt.toISOString(), oldBusinessDate.toISOString());
    assert.ok(movement.recordedAt instanceof Date);
    assert.equal(movement.createdByName, actor.name);
    await expectCode(
      assertNoMovementAfterSnapshot(db, { orgId: f.orgId, warehouseId: f.warehouseId, snapshotAt: snapshotBefore }),
      "STOCK_CHANGED_SINCE_SNAPSHOT",
    );
    await assertNoMovementAfterSnapshot(db, { orgId: f.orgId, warehouseId: f.warehouseId, snapshotAt: new Date(Date.now() + 1_000) });
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL concurrency: δύο αφαιρέσεις 7 από 10 → μία επιτυχία και τελικό 3", databaseOptions, async () => {
  const f = await fixture();
  try {
    await write(f, 10);
    const results = await Promise.allSettled([write(f, -7), write(f, -7)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof StockError);
    assert.equal(rejected.reason.code, "NEGATIVE_STOCK_NOT_ALLOWED");
    const movements = await db.stockMovement.findMany({ where: { orgId: f.orgId }, select: { quantity: true, source: true, lotId: true } });
    assert.deepEqual(movements.map((movement) => movement.quantity).sort((a, b) => a - b), [-7, 10]);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: f.lotId }), 3);
    assert.equal(movements.length, 2); // αρχική είσοδος + μία επιτυχής έξοδος· η αποτυχημένη κάνει rollback
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL: ξένο tenant και lot/warehouse mismatch δεν γράφουν κίνηση", databaseOptions, async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    await expectCode(write(a, 1, { genericItemId: b.genericItemId, lotId: null }), "GENERIC_ITEM_NOT_FOUND");
    await expectCode(write(a, 1, { lotId: b.lotId }), "LOT_NOT_FOUND");
    const otherWarehouse = await db.warehouse.create({ data: { orgId: a.orgId, name: "Δεύτερη αποθήκη" } });
    await expectCode(write(a, 1, { warehouseId: otherWarehouse.id }), "LOT_STOCK_KEY_MISMATCH");
    assert.equal(await db.stockMovement.count({ where: { orgId: { in: [a.orgId, b.orgId] } } }), 0);
  } finally {
    await cleanup(a);
    await cleanup(b);
  }
});

test("PostgreSQL: legacy sale χωρίς generic δεν χρησιμοποιεί warehouse-wide negative guard", databaseOptions, async () => {
  const f = await fixture();
  try {
    const movement = await stockTransaction((tx) => postLegacyStockMovement(tx, {
      orgId: f.orgId,
      warehouseId: f.warehouseId,
      quantity: -7,
      source: "sale",
      actor,
    }));
    assert.equal(movement.genericItemId, null);
    assert.equal(movement.lotId, null);
    assert.equal(movement.quantity, -7);
    assert.deepEqual(await stockBalances(db, { orgId: f.orgId, warehouseIds: [f.warehouseId] }), []);
  } finally {
    await cleanup(f);
  }
});
