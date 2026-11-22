import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { stockAlerts } from "./stock-alerts.ts";
import type { StockAlertScope } from "./stock-alerts.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const now = new Date("2026-11-22T12:00:00.000Z");

type Fixture = {
  orgId: string;
  warehouseId: string;
  otherWarehouseId: string;
  genericItemId: string;
  otherGenericItemId: string;
  storeId: string;
  unitId: string;
  ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `STK-09 ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Κεντρική STK-09" } });
    const otherWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Βοηθητική STK-09" } });
    const store = await tx.store.create({ data: { orgId: org.id, name: "Κατάστημα STK-09" } });
    await tx.storeWarehouse.create({ data: { storeId: store.id, warehouseId: warehouse.id, isDefault: true } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα STK-09", baseUnitId: unit.id } });
    const otherGeneric = await tx.genericItem.create({ data: { orgId: org.id, name: "Ζάχαρη STK-09", baseUnitId: unit.id } });
    return { orgId: org.id, warehouseId: warehouse.id, otherWarehouseId: otherWarehouse.id, genericItemId: generic.id, otherGenericItemId: otherGeneric.id, storeId: store.id, unitId: unit.id, ownsUnit: !existingUnit };
  });
}

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

function scope(f: Fixture, extra: Partial<StockAlertScope> = {}): StockAlertScope {
  return { orgId: f.orgId, storeIds: [], warehouseIds: [], ...extra };
}

function movement(f: Fixture, quantity: number, extra: { warehouseId?: string; genericItemId?: string; lotId?: string } = {}) {
  return db.stockMovement.create({ data: {
    orgId: f.orgId,
    warehouseId: extra.warehouseId ?? f.warehouseId,
    genericItemId: extra.genericItemId ?? f.genericItemId,
    lotId: extra.lotId ?? null,
    quantity,
    source: "manual",
  } });
}

test("PostgreSQL STK-09: thresholds χωρίς movements, zero/negative και tenant/warehouse/store scope", databaseOptions, async () => {
  const f = await fixture();
  const foreign = await fixture();
  try {
    await db.stockThreshold.create({ data: { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, minimumQty: 10 } });
    await db.stockThreshold.create({ data: { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.otherGenericItemId, minimumQty: 0 } });
    await db.stockThreshold.create({ data: { orgId: f.orgId, warehouseId: f.otherWarehouseId, genericItemId: f.genericItemId, minimumQty: 100 } });
    await db.stockThreshold.create({ data: { orgId: foreign.orgId, warehouseId: foreign.warehouseId, genericItemId: foreign.genericItemId, minimumQty: 100 } });
    const withoutThreshold = await db.genericItem.create({ data: { orgId: f.orgId, name: `Χωρίς όριο ${randomUUID()}`, baseUnitId: f.unitId } });
    await movement(f, -50, { genericItemId: withoutThreshold.id });
    await movement(foreign, 5);

    const zero = await stockAlerts(db, scope(f), now);
    assert.equal(zero.lowStock.length, 2);
    assert.ok(!zero.lowStock.some((row) => row.genericItemId === f.otherGenericItemId));
    assert.ok(!zero.thresholds.some((row) => row.genericItemId === withoutThreshold.id));
    await movement(f, -1, { genericItemId: f.otherGenericItemId });

    const all = await stockAlerts(db, scope(f), now);
    assert.equal(all.thresholds.length, 3);
    assert.equal(all.lowStock.length, 3);
    assert.equal(all.lowStock.find((row) => row.genericItemId === f.genericItemId && row.warehouseId === f.warehouseId)?.quantity, 0);
    assert.equal(all.lowStock.find((row) => row.genericItemId === f.otherGenericItemId)?.quantity, -1);
    assert.equal(all.lowStock.find((row) => row.warehouseId === f.otherWarehouseId)?.quantity, 0);

    const warehouseOnly = await stockAlerts(db, scope(f, { warehouseIds: [f.otherWarehouseId] }), now);
    assert.equal(warehouseOnly.thresholds.length, 1);
    assert.equal(warehouseOnly.lowStock[0]?.warehouseId, f.otherWarehouseId);
    const storeOnly = await stockAlerts(db, scope(f, { storeIds: [f.storeId] }), now);
    assert.equal(storeOnly.thresholds.length, 2);
    assert.ok(storeOnly.thresholds.every((row) => row.warehouseId === f.warehouseId));
    assert.equal((await stockAlerts(db, scope(f, { storeIds: ["missing-store"] }), now)).thresholds.length, 0);
    assert.equal((await stockAlerts(db, scope(foreign, { warehouseIds: [f.warehouseId] }), now)).thresholds.length, 0);
  } finally {
    await cleanup(f);
    await cleanup(foreign);
  }
});

test("PostgreSQL STK-09: expiry μόνο για θετικό υπόλοιπο, έως 30 ημέρες και εντός tenant", databaseOptions, async () => {
  const f = await fixture();
  const foreign = await fixture();
  try {
    const suffix = randomUUID();
    const makeLot = (name: string, day: string | null, warehouseId = f.warehouseId) => db.stockLot.create({ data: {
      orgId: f.orgId,
      warehouseId,
      genericItemId: f.genericItemId,
      batchNumber: `${name}-${suffix}`,
      expiresAt: day ? new Date(`${day}T12:00:00.000Z`) : null,
    } });
    const expired = await makeLot("EXPIRED", "2026-11-21");
    const three = await makeLot("THREE", "2026-11-25");
    const four = await makeLot("FOUR", "2026-11-26");
    const thirty = await makeLot("THIRTY", "2026-12-22");
    const later = await makeLot("LATER", "2026-12-23");
    const zero = await makeLot("ZERO", "2026-11-20");
    const negative = await makeLot("NEGATIVE", "2026-11-20");
    const noExpiry = await makeLot("NO-EXPIRY", null);
    const hidden = await makeLot("HIDDEN", "2026-11-20", f.otherWarehouseId);
    const foreignLot = await db.stockLot.create({ data: { orgId: foreign.orgId, warehouseId: foreign.warehouseId, genericItemId: foreign.genericItemId, batchNumber: `FOREIGN-${suffix}`, expiresAt: new Date("2026-11-20T12:00:00.000Z") } });
    for (const lot of [expired, three, four, thirty, later, zero, negative, noExpiry, hidden]) await movement(f, 5, { lotId: lot.id, warehouseId: lot.warehouseId });
    await movement(f, -5, { lotId: zero.id });
    await movement(f, -10, { lotId: negative.id });
    await movement(foreign, 5, { lotId: foreignLot.id });

    const result = await stockAlerts(db, scope(f, { warehouseIds: [f.warehouseId] }), now);
    assert.deepEqual(result.expiringLots.map((row) => row.lotId), [expired.id, three.id, four.id, thirty.id]);
    assert.deepEqual(result.expiringLots.map((row) => row.bucket), ["expired", "0-3", "4-7", "8-30"]);
    assert.ok(!result.expiringLots.some((row) => [later.id, zero.id, negative.id, noExpiry.id, hidden.id, foreignLot.id].includes(row.lotId)));
  } finally {
    await cleanup(f);
    await cleanup(foreign);
  }
});
