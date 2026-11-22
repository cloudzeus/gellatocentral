import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { postStockCorrection } from "./stock-corrections.ts";
import { StockError } from "./stock-db.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };

type Fixture = {
  orgId: string;
  userId: string;
  warehouseId: string;
  otherWarehouseId: string;
  genericItemId: string;
  lotId: string;
  unitId: string;
  ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `STK-07 ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const user = await tx.user.create({ data: { email: `stk07-${suffix}@example.test`, name: "Υπεύθυνος STK-07" } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη STK-07" } });
    const otherWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Άλλη αποθήκη STK-07" } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα STK-07", baseUnitId: unit.id } });
    const lot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: warehouse.id, genericItemId: generic.id, batchNumber: `LOT-${suffix}` } });
    return { orgId: org.id, userId: user.id, warehouseId: warehouse.id, otherWarehouseId: otherWarehouse.id, genericItemId: generic.id, lotId: lot.id, unitId: unit.id, ownsUnit: !existingUnit };
  });
}

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

function context(f: Fixture, warehouseIds: readonly string[] = []): StockContext {
  return {
    orgId: f.orgId,
    membershipId: "unrestricted-integration-context",
    userId: f.userId,
    userName: "Υπεύθυνος STK-07",
    permissions: ["stock.correct"],
    storeIds: [],
    warehouseIds,
    can: (permission) => permission === "stock.correct",
  };
}

function correction(f: Fixture, quantity: number, reason = "αιτιολογία διόρθωσης") {
  return { warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: f.lotId, quantity, reason };
}

test("PostgreSQL STK-07: θετική/αρνητική correction, actor, audit και append-only ιστορικό", databaseOptions, async () => {
  const f = await fixture();
  try {
    const first = await postStockCorrection(context(f), correction(f, 10, "  αρχική παραλαβή  "));
    const second = await postStockCorrection(context(f), correction(f, -3, "σπασίματα συσκευασίας"));
    assert.notEqual(first.id, second.id);
    assert.equal(first.note, "αρχική παραλαβή");
    assert.equal(second.quantity, -3);
    assert.equal(second.createdById, f.userId);
    assert.equal(second.createdByName, "Υπεύθυνος STK-07");
    assert.equal(second.source, "manual");

    const movements = await db.stockMovement.findMany({ where: { orgId: f.orgId }, orderBy: { recordedAt: "asc" } });
    assert.equal(movements.length, 2);
    assert.equal(movements[0]!.quantity, 10);
    const audits = await db.auditEvent.findMany({ where: { orgId: f.orgId, action: "stock.correction.posted" }, orderBy: { createdAt: "asc" } });
    assert.equal(audits.length, 2);
    assert.equal(audits[0]!.entityId, first.id);
    assert.equal(audits[0]!.entityType, "stock_movement");
    assert.equal(audits[0]!.actorId, f.userId);
    assert.equal(audits[0]!.reason, "αρχική παραλαβή");
    assert.deepEqual(audits[0]!.metadata, { genericItemId: f.genericItemId, lotId: f.lotId, quantity: 10 });
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-07: negative stock και άκυρη αιτιολογία κάνουν πλήρες rollback", databaseOptions, async () => {
  const f = await fixture();
  try {
    await postStockCorrection(context(f), correction(f, 2));
    await assert.rejects(postStockCorrection(context(f), correction(f, -3, "υπερβολική αφαίρεση")), (error: unknown) => {
      assert.ok(error instanceof StockError);
      assert.equal(error.code, "NEGATIVE_STOCK_NOT_ALLOWED");
      return true;
    });
    await assert.rejects(postStockCorrection(context(f), correction(f, 1, "απ")), StockError);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), 1);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-07: cross-tenant και warehouse scope δεν γράφουν κίνηση ή audit", databaseOptions, async () => {
  const f = await fixture();
  const foreign = await fixture();
  try {
    await assert.rejects(postStockCorrection(context(f), correction(foreign, 1)), (error: unknown) => {
      assert.ok(error instanceof StockScopeError);
      assert.equal(error.code, "WAREHOUSE_NOT_FOUND");
      return true;
    });
    await assert.rejects(postStockCorrection(context(f, [f.otherWarehouseId]), correction(f, 1)), (error: unknown) => {
      assert.ok(error instanceof StockScopeError);
      assert.equal(error.code, "WAREHOUSE_NOT_FOUND");
      return true;
    });
    assert.equal(await db.stockMovement.count({ where: { orgId: { in: [f.orgId, foreign.orgId] } } }), 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: { in: [f.orgId, foreign.orgId] } } }), 0);
  } finally {
    await cleanup(f);
    await cleanup(foreign);
  }
});
