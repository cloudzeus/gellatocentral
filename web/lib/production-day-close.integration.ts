import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { closeProductionDay } from "./production-day-close-db.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";
import { postStockMovement, stockBalance } from "./stock-db.ts";
import { stockTransaction } from "./stock-transaction.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };

async function fixture(rawGrams = 10_000) {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `DAY integration ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const user = await tx.user.create({ data: { email: `day-${suffix}@example.test`, name: "Υπεύθυνος ημερήσιου κλεισίματος" } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const source = await tx.warehouse.create({ data: { orgId: org.id, name: "Εργαστήριο day close" } });
    const destination = await tx.warehouse.create({ data: { orgId: org.id, name: "Έτοιμα day close" } });
    const raw = await tx.genericItem.create({ data: { orgId: org.id, name: "Πρώτη ύλη day close", baseUnitId: unit.id, avgCostHundredths: 500_000 } });
    const base = await tx.genericItem.create({ data: { orgId: org.id, name: "Βάση day close", baseUnitId: unit.id } });
    const final = await tx.genericItem.create({ data: { orgId: org.id, name: "Τελικό day close", baseUnitId: unit.id } });
    const rawLot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: source.id, genericItemId: raw.id, batchNumber: `RAW-${suffix}` } });
    const baseLot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: source.id, genericItemId: base.id, batchNumber: `BASE-STOCK-${suffix}` } });
    const baseRecipe = await tx.recipe.create({ data: { orgId: org.id, name: "Υποσυνταγή day close", type: "cream", batchGrams: 1000, outputGenericItemId: base.id, items: { create: [{ orgId: org.id, genericItemId: raw.id, grams: 1000 }] } } });
    const finalRecipe = await tx.recipe.create({ data: { orgId: org.id, name: "Τελική day close", type: "cream", batchGrams: 2000, outputGenericItemId: final.id, shelfLifeDays: 4, items: { create: [{ orgId: org.id, genericItemId: base.id, grams: 500 }, { orgId: org.id, genericItemId: raw.id, grams: 1500 }] } } });
    const plan = await tx.productionPlan.create({ data: { orgId: org.id, recipeId: finalRecipe.id, sourceWarehouseId: source.id, destinationWarehouseId: destination.id, plannedFor: new Date("2026-11-24T08:00:00.000Z"), quantityGrams: 2000, createdByName: user.name } });
    return { orgId: org.id, userId: user.id, sourceId: source.id, destinationId: destination.id, rawId: raw.id, baseId: base.id, finalId: final.id, rawLotId: rawLot.id, baseLotId: baseLot.id, baseRecipeId: baseRecipe.id, finalRecipeId: finalRecipe.id, planId: plan.id, unitId: unit.id, ownsUnit: !existingUnit, userName: user.name, rawGrams };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture, warehouseIds: readonly string[] = []): StockContext {
  return { orgId: f.orgId, membershipId: "day-close-integration", userId: f.userId, userName: f.userName, permissions: ["production.add"], storeIds: [], warehouseIds, can: (permission) => permission === "production.add" || permission === "production.read" };
}
async function cleanup(fixtures: readonly Fixture[]) {
  await db.stockMovement.deleteMany({ where: { orgId: { in: fixtures.map((f) => f.orgId) } } });
  await db.organization.deleteMany({ where: { id: { in: fixtures.map((f) => f.orgId) } } });
  await db.user.deleteMany({ where: { id: { in: fixtures.map((f) => f.userId) } } });
  for (const f of fixtures) if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}
async function openingStock(f: Fixture, baseGrams: number) {
  await stockTransaction(async (tx) => {
    await postStockMovement(tx, { orgId: f.orgId, warehouseId: f.sourceId, genericItemId: f.rawId, lotId: f.rawLotId, quantity: f.rawGrams * 1000, unitCostHundredths: 500_000, source: "manual", actor: { id: f.userId, name: f.userName } });
    if (baseGrams) await postStockMovement(tx, { orgId: f.orgId, warehouseId: f.sourceId, genericItemId: f.baseId, lotId: f.baseLotId, quantity: baseGrams * 1000, source: "manual", actor: { id: f.userId, name: f.userName } });
  });
}
const input = (f: Fixture, clientKey = randomUUID(), quantityGrams = 1800) => ({ businessDate: "2026-11-24", sourceWarehouseId: f.sourceId, destinationWarehouseId: f.destinationId, clientKey, actuals: [{ planId: f.planId, quantityGrams, scrapReason: quantityGrams < 2000 ? "Απώλεια κατά την έξοδο" : null, labourMinutes: 30, labourCostCents: 500 }] });

test("PostgreSQL PRD-04: child→parent, semi stock, actual/waste, idempotency και tenant isolation", databaseOptions, async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    await openingStock(f, 200);
    const clientKey = randomUUID();
    const closed = await closeProductionDay(context(f), input(f, clientKey));
    assert.equal(closed.status, "COMPLETED");
    const batches = await db.productionBatch.findMany({ where: { orgId: f.orgId }, orderBy: { createdAt: "asc" }, include: { items: true } });
    assert.equal(batches.length, 2);
    const automatic = batches.find((batch) => batch.recipeId === f.baseRecipeId)!;
    const final = batches.find((batch) => batch.recipeId === f.finalRecipeId)!;
    assert.equal(automatic.quantityGrams, 300);
    assert.equal(automatic.warehouseId, f.sourceId);
    assert.equal(automatic.destinationWarehouseId, f.sourceId);
    assert.equal(final.quantityGrams, 1800);
    assert.equal(final.expectedQuantityGrams, 2000);
    assert.equal(final.wasteGrams, 200);
    assert.equal(final.scrapReason, "Απώλεια κατά την έξοδο");
    assert.deepEqual(new Set(final.items.map((item) => item.genericItemId)), new Set([f.baseId, f.rawId]));
    assert.equal(final.items.filter((item) => item.genericItemId === f.baseId).reduce((sum, item) => sum + item.quantity, 0), 500_000);
    assert.equal(final.items.filter((item) => item.genericItemId === f.rawId).reduce((sum, item) => sum + item.quantity, 0), 1_500_000);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.sourceId, genericItemId: f.rawId, lotId: f.rawLotId }), 8_200_000);
    const baseRemainder = await db.stockMovement.aggregate({ where: { orgId: f.orgId, warehouseId: f.sourceId, genericItemId: f.baseId }, _sum: { quantity: true } });
    assert.equal(baseRemainder._sum.quantity, 0);
    assert.equal((await db.productionPlan.findUnique({ where: { id: f.planId } }))?.status, "COMPLETED");
    assert.equal((await db.productionPlan.findUnique({ where: { id: other.planId } }))?.status, "PLANNED");
    assert.equal(await db.productionBatch.count({ where: { orgId: other.orgId } }), 0);

    const replay = await closeProductionDay(context(f), input(f, clientKey));
    assert.equal(replay.id, closed.id);
    assert.equal(await db.productionBatch.count({ where: { orgId: f.orgId } }), 2);
    await assert.rejects(closeProductionDay(context(f), input(f, clientKey, 1700)), /διαφορετικά δεδομένα/);
    await assert.rejects(closeProductionDay(context(f), input(f)), /έχει ήδη κλείσει/);
    assert.ok(await db.auditEvent.count({ where: { orgId: f.orgId, action: "production.day.close" } }) === 1);
  } finally {
    await cleanup([f, other]);
  }
});

test("PostgreSQL PRD-04: κάθε αποτυχία κάνει rollback ολόκληρο το day close", databaseOptions, async () => {
  const f = await fixture(100);
  try {
    await openingStock(f, 0);
    await assert.rejects(closeProductionDay(context(f), input(f)), /Δεν φτάνει το απόθεμα/);
    assert.equal(await db.productionDayClose.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.productionBatch.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.recipeVersion.count({ where: { orgId: f.orgId } }), 0);
    assert.equal((await db.productionPlan.findUnique({ where: { id: f.planId } }))?.status, "PLANNED");
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.sourceId, genericItemId: f.rawId, lotId: f.rawLotId }), 100_000);
  } finally {
    await cleanup([f]);
  }
});

test("PostgreSQL PRD-04: απορρίπτεται warehouse εκτός membership scope", databaseOptions, async () => {
  const f = await fixture();
  try {
    await assert.rejects(closeProductionDay(context(f, [f.destinationId]), input(f)), (error: unknown) => {
      assert.ok(error instanceof StockScopeError);
      assert.equal(error.code, "WAREHOUSE_NOT_FOUND");
      return true;
    });
    assert.equal(await db.productionDayClose.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.productionBatch.count({ where: { orgId: f.orgId } }), 0);
  } finally {
    await cleanup([f]);
  }
});
