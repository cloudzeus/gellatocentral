import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { closeProductionBatch as closeBatch, correctProductionOutput } from "./production-db.ts";
import { completeProductionSchedule, createProductionSchedule, recordHaccpLotCheck, saveMachine, setLotHold } from "./production-workflow-db.ts";
import { postStockMovement, stockBalance } from "./stock-db.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";
import { stockTransaction } from "./stock-transaction.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };

type Fixture = {
  orgId: string;
  userId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  rawItemId: string;
  baseItemId: string;
  finalItemId: string;
  rawLotId: string;
  baseRecipeId: string;
  finalRecipeId: string;
  unitId: string;
  ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `PRD integration ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const user = await tx.user.create({ data: { email: `prd-${suffix}@example.test`, name: "Υπεύθυνος παραγωγής integration" } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const source = await tx.warehouse.create({ data: { orgId: org.id, name: "Α΄ υλά integration" } });
    const destination = await tx.warehouse.create({ data: { orgId: org.id, name: "Έτοιμα integration" } });
    const raw = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα integration", baseUnitId: unit.id, avgCostHundredths: 500_000 } });
    const base = await tx.genericItem.create({ data: { orgId: org.id, name: "Βάση integration", baseUnitId: unit.id } });
    const final = await tx.genericItem.create({ data: { orgId: org.id, name: "Παγωτό integration", baseUnitId: unit.id } });
    const rawLot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: source.id, genericItemId: raw.id, batchNumber: `RAW-${suffix}` } });
    const baseRecipe = await tx.recipe.create({ data: {
      orgId: org.id, name: "Υποσυνταγή integration", type: "cream", batchGrams: 1000, outputGenericItemId: base.id, shelfLifeDays: 3,
      items: { create: [{ orgId: org.id, genericItemId: raw.id, grams: 1000 }] },
    } });
    const finalRecipe = await tx.recipe.create({ data: {
      orgId: org.id, name: "Τελική συνταγή integration", type: "cream", batchGrams: 2000, outputGenericItemId: final.id, shelfLifeDays: 5,
      items: { create: [{ orgId: org.id, genericItemId: base.id, grams: 500, sortOrder: 0 }, { orgId: org.id, genericItemId: raw.id, grams: 1500, sortOrder: 1 }] },
    } });
    return {
      orgId: org.id, userId: user.id, sourceWarehouseId: source.id, destinationWarehouseId: destination.id,
      rawItemId: raw.id, baseItemId: base.id, finalItemId: final.id, rawLotId: rawLot.id,
      baseRecipeId: baseRecipe.id, finalRecipeId: finalRecipe.id, unitId: unit.id, ownsUnit: !existingUnit,
    };
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
    membershipId: "production-integration-context",
    userId: f.userId,
    userName: "Υπεύθυνος παραγωγής integration",
    permissions: ["production.add", "haccp.add", "haccp.edit"],
    storeIds: [],
    warehouseIds,
    can: (permission) => ["production.add", "production.read", "haccp.add", "haccp.edit"].includes(permission),
  };
}

test("PostgreSQL PRD: recursive plan, μία ολοκλήρωση, output correction και HACCP hold", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  try {
    await stockTransaction((tx) => postStockMovement(tx, {
      orgId: f.orgId, warehouseId: f.sourceWarehouseId, genericItemId: f.rawItemId, lotId: f.rawLotId,
      quantity: 10_000_000, unitCostHundredths: 500_000, source: "manual", actor: { id: f.userId, name: ctx.userName },
    }));

    const baseBatch = await closeBatch(ctx, {
      recipeId: f.baseRecipeId, warehouseId: f.sourceWarehouseId, destinationWarehouseId: f.destinationWarehouseId,
      quantityGrams: 1000, batchNumber: `BASE-${randomUUID()}`, producedAt: new Date("2026-11-23T08:00:00.000Z"),
    });
    assert.ok(baseBatch.outputLotId);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.destinationWarehouseId, genericItemId: f.baseItemId, lotId: baseBatch.outputLotId }), 1_000_000);

    const plan = await createProductionSchedule(ctx, {
      recipeId: f.finalRecipeId, sourceWarehouseId: f.sourceWarehouseId, destinationWarehouseId: f.destinationWarehouseId,
      plannedFor: new Date("2026-11-23T09:00:00.000Z"), quantityGrams: 2000,
    });
    const completion = {
      quantityGrams: 1800, scrapReason: "Απώλεια στο σημείο έξοδου", labourMinutes: 120, labourCostCents: 1000,
      batchNumber: `FINAL-${randomUUID()}`, producedAt: new Date("2026-11-23T10:00:00.000Z"),
    };
    const results = await Promise.allSettled([
      completeProductionSchedule(ctx, plan.id, completion),
      completeProductionSchedule(ctx, plan.id, completion),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const finalBatch = results.find((result) => result.status === "fulfilled");
    assert.ok(finalBatch && finalBatch.status === "fulfilled");
    assert.ok(finalBatch.value.outputLotId);
    assert.equal((await db.productionPlan.findUnique({ where: { id: plan.id } }))?.status, "COMPLETED");
    assert.equal(await db.productionBatch.count({ where: { orgId: f.orgId, recipeId: f.finalRecipeId } }), 1);

    const finalItems = await db.productionBatchItem.findMany({ where: { orgId: f.orgId, batchId: finalBatch.value.id } });
    assert.equal(finalItems.length, 1);
    assert.equal(finalItems[0]?.genericItemId, f.rawItemId);
    assert.equal(finalItems[0]?.grams, 2000);
    assert.equal(finalItems[0]?.quantity, 2_000_000);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.sourceWarehouseId, genericItemId: f.rawItemId, lotId: f.rawLotId }), 7_000_000);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.destinationWarehouseId, genericItemId: f.finalItemId, lotId: finalBatch.value.outputLotId }), 1_800_000);
    const outputLot = await db.stockLot.findUnique({ where: { id: finalBatch.value.outputLotId! } });
    assert.equal(outputLot?.expiresAt?.toISOString(), "2026-11-28T10:00:00.000Z");

    await correctProductionOutput(ctx, { batchId: finalBatch.value.id, correctedQuantityGrams: 1900, reason: "Επανάληψη ζύγισης" });
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.destinationWarehouseId, genericItemId: f.finalItemId, lotId: finalBatch.value.outputLotId }), 1_900_000);
    assert.equal(await db.productionCorrection.count({ where: { orgId: f.orgId, batchId: finalBatch.value.id } }), 1);
    assert.equal((await db.productionBatch.findUnique({ where: { id: finalBatch.value.id } }))?.wasteGrams, 100);
    assert.equal(await db.productionBatchItem.count({ where: { orgId: f.orgId, batchId: finalBatch.value.id } }), 1);

    await recordHaccpLotCheck(ctx, {
      lotId: finalBatch.value.outputLotId!, batchId: finalBatch.value.id, kind: "Θερμοκρασία ψύξης",
      measuredValue: 8, maximum: 4, unit: "°C", correctiveAction: "Απομόνωση και νέα μέτρηση",
    });
    assert.equal((await db.stockLot.findUnique({ where: { id: finalBatch.value.outputLotId! } }))?.holdStatus, "HELD");
    await setLotHold(ctx, { lotId: finalBatch.value.outputLotId!, status: "RELEASED", reason: "Νέα μέτρηση εντός ορίων" });
    assert.equal((await db.stockLot.findUnique({ where: { id: finalBatch.value.outputLotId! } }))?.holdStatus, "RELEASED");
    assert.ok(await db.auditEvent.count({ where: { orgId: f.orgId, action: { in: ["production.close", "production.correct", "haccp.lot.check", "haccp.lot.hold"] } } }) >= 5);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL PRD: περιορισμένος χρήστης δεν δημιουργεί καθολικό μηχάνημα", databaseOptions, async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      saveMachine(context(f, [f.sourceWarehouseId]), { name: "Απαγορευμένο κοινό μηχάνημα", warehouseId: null }),
      (error: unknown) => {
        assert.ok(error instanceof StockScopeError);
        assert.equal(error.code, "GLOBAL_SCOPE_NOT_ALLOWED");
        return true;
      },
    );
    assert.equal(await db.machine.count({ where: { orgId: f.orgId } }), 0);
  } finally {
    await cleanup(f);
  }
});
