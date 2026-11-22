import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { postStockMovement, type PostStockMovementInput } from "./stock-db.ts";
import { scopedStockLot, stockLotBalances, stockOverview } from "./stock-read.ts";
import { stockTransaction } from "./stock-transaction.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const actor = { id: null, name: "STK-02/03 integration" };

type Fixture = {
  orgId: string;
  warehouseId: string;
  otherWarehouseId: string;
  genericItemId: string;
  otherGenericItemId: string;
  unitId: string;
  ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `STK-02/03 ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Κεντρική" } });
    const otherWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Βοηθητική" } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα", baseUnitId: unit.id, avgCostHundredths: 125 } });
    const otherGeneric = await tx.genericItem.create({ data: { orgId: org.id, name: "Ζάχαρη", baseUnitId: unit.id, avgCostHundredths: 250 } });
    return { orgId: org.id, warehouseId: warehouse.id, otherWarehouseId: otherWarehouse.id, genericItemId: generic.id, otherGenericItemId: otherGeneric.id, unitId: unit.id, ownsUnit: !existingUnit };
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
    lotId: null,
    quantity,
    source: "manual",
    actor,
    ...override,
  }));
}

const readInput = (f: Fixture, warehouseIds: readonly string[], extra: { q?: string; skip?: number; take?: number } = {}) => ({
  orgId: f.orgId,
  warehouseIds,
  q: extra.q ?? "",
  skip: extra.skip ?? 0,
  take: extra.take ?? 50,
});

test("PostgreSQL STK-02: aggregation, valuation, search, scope και pagination", databaseOptions, async () => {
  const f = await fixture();
  const foreign = await fixture();
  try {
    await write(f, 1_000);
    await write(f, 500, { warehouseId: f.otherWarehouseId });
    await write(f, 200, { genericItemId: f.otherGenericItemId });

    const first = await stockOverview(db, readInput(f, [f.warehouseId], { take: 1 }));
    assert.equal(first.total, 2);
    assert.equal(first.rows.length, 1);
    assert.equal(first.totalValueHundredths, Math.round((1_000 * 125 + 200 * 250) / 1000));
    const second = await stockOverview(db, readInput(f, [f.warehouseId], { skip: 1, take: 1 }));
    assert.equal(second.total, 2);
    assert.equal(second.rows.length, 1);
    assert.notEqual(first.rows[0]!.genericItemId, second.rows[0]!.genericItemId);

    const search = await stockOverview(db, readInput(f, [f.warehouseId, f.otherWarehouseId], { q: "γάλα" }));
    assert.equal(search.total, 2);
    assert.deepEqual(search.rows.map((row) => row.quantity).sort((a, b) => a - b), [500, 1_000]);
    const central = await stockOverview(db, readInput(f, [f.warehouseId], { q: "γάλα" }));
    assert.equal(central.total, 1);
    assert.equal(central.rows[0]!.valueHundredths, 125);
    assert.equal(central.rows[0]!.unitCostHundredths, 125);

    assert.equal((await stockOverview(db, readInput(f, []))).total, 0);
    assert.equal((await stockOverview(db, readInput(foreign, [f.warehouseId]))).total, 0);
  } finally {
    await cleanup(f);
    await cleanup(foreign);
  }
});

test("PostgreSQL STK-03: FEFO, zero handling και ξένη/out-of-scope lot", databaseOptions, async () => {
  const f = await fixture();
  const foreign = await fixture();
  try {
    const suffix = randomUUID();
    const makeLot = (name: string, expiresAt: string | null, warehouseId = f.warehouseId) => db.stockLot.create({
      data: { orgId: f.orgId, genericItemId: f.genericItemId, warehouseId, batchNumber: `${name}-${suffix}`, expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00Z`) : null },
    });
    const later = await makeLot("LATER", "2026-12-01");
    const earlier = await makeLot("EARLY", "2026-11-01");
    const noExpiry = await makeLot("NO-EXPIRY", null);
    const zero = await makeLot("ZERO", "2026-10-01");
    const hidden = await makeLot("HIDDEN", "2026-09-01", f.otherWarehouseId);
    await write(f, 5, { lotId: later.id });
    await write(f, 10, { lotId: earlier.id });
    await write(f, 7, { lotId: noExpiry.id });
    await write(f, 4, { lotId: zero.id });
    await write(f, -4, { lotId: zero.id });
    await write(f, 8, { lotId: hidden.id, warehouseId: f.otherWarehouseId });

    const lots = await stockLotBalances(db, readInput(f, [f.warehouseId]));
    assert.equal(lots.total, 3);
    assert.deepEqual(lots.rows.map((row) => row.lotId), [earlier.id, later.id, noExpiry.id]);
    assert.ok(!lots.rows.some((row) => row.lotId === zero.id));
    assert.ok(!lots.rows.some((row) => row.lotId === hidden.id));
    assert.equal((await stockLotBalances(db, readInput(f, [f.warehouseId], { q: "EARLY" }))).rows[0]?.lotId, earlier.id);

    assert.equal((await scopedStockLot(db, { orgId: f.orgId, warehouseIds: [f.warehouseId], lotId: earlier.id }))?.id, earlier.id);
    assert.equal(await scopedStockLot(db, { orgId: f.orgId, warehouseIds: [f.warehouseId], lotId: hidden.id }), null);
    assert.equal(await scopedStockLot(db, { orgId: f.orgId, warehouseIds: [], lotId: earlier.id }), null);
    assert.equal(await scopedStockLot(db, { orgId: foreign.orgId, warehouseIds: [foreign.warehouseId], lotId: earlier.id }), null);
  } finally {
    await cleanup(f);
    await cleanup(foreign);
  }
});
