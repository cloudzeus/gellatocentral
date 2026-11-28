import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { productionForecast } from "./forecast-db.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";
import { postStockMovement } from "./stock-db.ts";
import { stockTransaction } from "./stock-transaction.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const NOW = new Date("2026-11-24T12:00:00.000Z");

async function fixture() {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `FCST integration ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const user = await tx.user.create({ data: { email: `fcst-${suffix}@example.test`, name: "Forecast integration" } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const store = await tx.store.create({ data: { orgId: org.id, name: "Κατάστημα forecast" } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Κεντρική forecast" } });
    const otherWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Άλλη forecast" } });
    await tx.storeWarehouse.create({ data: { storeId: store.id, warehouseId: warehouse.id } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Παγωτό forecast", baseUnitId: unit.id } });
    const customer = await tx.party.create({ data: { orgId: org.id, name: "Πελάτης forecast", roles: ["customer"] } });
    const historyLot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: warehouse.id, genericItemId: generic.id, batchNumber: `HISTORY-${suffix}` } });
    const availableLot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: warehouse.id, genericItemId: generic.id, batchNumber: `AVAILABLE-${suffix}` } });
    const heldLot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: warehouse.id, genericItemId: generic.id, batchNumber: `HELD-${suffix}`, holdStatus: "HELD" } });
    const otherLot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: otherWarehouse.id, genericItemId: generic.id, batchNumber: `OTHER-${suffix}` } });
    const recipe = await tx.recipe.create({ data: { orgId: org.id, name: "Συνταγή forecast", batchGrams: 1000, outputGenericItemId: generic.id } });
    return { orgId: org.id, userId: user.id, storeId: store.id, warehouseId: warehouse.id, otherWarehouseId: otherWarehouse.id, genericId: generic.id, customerId: customer.id, historyLotId: historyLot.id, availableLotId: availableLot.id, heldLotId: heldLot.id, otherLotId: otherLot.id, recipeId: recipe.id, unitId: unit.id, ownsUnit: !existingUnit, userName: user.name };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture, warehouseIds: readonly string[] = []): StockContext {
  return { orgId: f.orgId, membershipId: "forecast-integration", userId: f.userId, userName: f.userName, permissions: ["production.read"], storeIds: [], warehouseIds, can: (permission) => permission === "production.read" };
}
async function cleanup(fixtures: readonly Fixture[]) {
  const orgIds = fixtures.map((f) => f.orgId);
  await db.stockMovement.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.wholesaleOrderLine.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.wholesaleOrder.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: { in: fixtures.map((f) => f.userId) } } });
  for (const f of fixtures) if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

test("PostgreSQL PRD-07: hand-computed forecast, held/other warehouse exclusion και tenant isolation", databaseOptions, async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    await stockTransaction(async (tx) => {
      const actor = { id: f.userId, name: f.userName };
      await postStockMovement(tx, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericId, lotId: f.historyLotId, quantity: 4000, source: "purchase", occurredAt: new Date("2026-11-01T10:00:00.000Z"), actor });
      await postStockMovement(tx, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericId, lotId: f.historyLotId, quantity: -4000, source: "sale", storeId: f.storeId, occurredAt: new Date("2026-11-20T10:00:00.000Z"), actor });
      await postStockMovement(tx, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericId, lotId: f.availableLotId, quantity: 2000, source: "purchase", actor });
      await postStockMovement(tx, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericId, lotId: f.heldLotId, quantity: 5000, source: "purchase", actor });
      await postStockMovement(tx, { orgId: f.orgId, warehouseId: f.otherWarehouseId, genericItemId: f.genericId, lotId: f.otherLotId, quantity: 9000, source: "purchase", actor });
      await postStockMovement(tx, { orgId: other.orgId, warehouseId: other.warehouseId, genericItemId: other.genericId, lotId: other.historyLotId, quantity: 40_000, source: "purchase", actor: { id: other.userId, name: other.userName } });
      await postStockMovement(tx, { orgId: other.orgId, warehouseId: other.warehouseId, genericItemId: other.genericId, lotId: other.historyLotId, quantity: -40_000, source: "sale", occurredAt: new Date("2026-11-20T10:00:00.000Z"), actor: { id: other.userId, name: other.userName } });
    });
    // Η ιστορική ζήτηση διαβάζεται από το DemandDaily (τη γράφει η μηχανή κατανάλωσης)· η άλλη αποθήκη δεν μετρά.
    const day = new Date("2026-11-20T00:00:00.000Z");
    await db.demandDaily.createMany({ data: [
      { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericId, day, consumedBase: 4000 },
      { orgId: f.orgId, warehouseId: f.otherWarehouseId, genericItemId: f.genericId, day, consumedBase: 9000 },
      { orgId: other.orgId, warehouseId: other.warehouseId, genericItemId: other.genericId, day, consumedBase: 40_000 },
    ] });
    await db.wholesaleOrder.create({ data: { orgId: f.orgId, customerId: f.customerId, storeId: f.storeId, warehouseId: f.warehouseId, number: `FCST-${randomUUID()}`, status: "CONFIRMED", neededAt: new Date("2026-11-25T12:00:00.000Z"), createdByName: f.userName, lines: { create: [{ orgId: f.orgId, genericItemId: f.genericId, quantityBase: 3000, unitPriceCents: 1000, vatRate: 24 }] } } });
    await db.productionPlan.create({ data: { orgId: f.orgId, recipeId: f.recipeId, sourceWarehouseId: f.warehouseId, destinationWarehouseId: f.warehouseId, plannedFor: new Date("2026-11-26T12:00:00.000Z"), quantityGrams: 1, status: "IN_PROGRESS", createdByName: f.userName } });

    const rows = await productionForecast(db, context(f), f.warehouseId, NOW);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0] && {
      historicalBase: rows[0].historicalBase, historicalForecastBase: rows[0].historicalForecastBase,
      confirmedWholesaleBase: rows[0].confirmedWholesaleBase, availableBase: rows[0].availableBase,
      plannedProductionBase: rows[0].plannedProductionBase, suggestedBase: rows[0].suggestedBase,
    }, { historicalBase: 4000, historicalForecastBase: 1000, confirmedWholesaleBase: 3000, availableBase: 2000, plannedProductionBase: 1000, suggestedBase: 1000 });
    const otherRows = await productionForecast(db, context(other), other.warehouseId, NOW);
    assert.equal(otherRows[0]?.historicalForecastBase, 10_000);
    assert.equal(otherRows[0]?.suggestedBase, 10_000);
    await assert.rejects(productionForecast(db, context(f, [f.otherWarehouseId]), f.warehouseId, NOW), StockScopeError);
  } finally {
    await cleanup([f, other]);
  }
});
