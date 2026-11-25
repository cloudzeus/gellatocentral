import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import {
  addStockCountLine,
  addStockCountLotLine,
  createStockCount,
  finalizeStockCount,
  readStockCountRevision,
  updateStockCountMeasurements,
} from "./stock-counts.ts";
import { StockCountError } from "./stock-count-request.ts";
import { postStockMovement, StockError, type PostStockMovementInput } from "./stock-db.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";
import { stockTransaction } from "./stock-transaction.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const countedOn = "2026-11-22";

type Fixture = {
  orgId: string;
  userId: string;
  warehouseId: string;
  otherWarehouseId: string;
  genericItemId: string;
  otherGenericItemId: string;
  lotId: string;
  unitId: string;
  ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `STK-05 ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const user = await tx.user.create({ data: { email: `stk05-${suffix}@example.test`, name: "Υπεύθυνος STK-05" } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Εργαστήριο STK-05" } });
    const otherWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Δεύτερη αποθήκη STK-05" } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα STK-05", baseUnitId: unit.id, avgCostHundredths: 125 } });
    const otherGeneric = await tx.genericItem.create({ data: { orgId: org.id, name: "Ζάχαρη STK-05", baseUnitId: unit.id, avgCostHundredths: 250 } });
    const lot = await tx.stockLot.create({ data: { orgId: org.id, genericItemId: generic.id, warehouseId: warehouse.id, batchNumber: `LOT-${suffix}`, expiresAt: new Date("2027-01-15T00:00:00.000Z") } });
    return {
      orgId: org.id,
      userId: user.id,
      warehouseId: warehouse.id,
      otherWarehouseId: otherWarehouse.id,
      genericItemId: generic.id,
      otherGenericItemId: otherGeneric.id,
      lotId: lot.id,
      unitId: unit.id,
      ownsUnit: !existingUnit,
    };
  });
}

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
  await db.stockCountLine.deleteMany({ where: { orgId: f.orgId } });
  await db.stockCount.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

function context(f: Fixture, warehouseIds: readonly string[] = []): StockContext {
  return {
    orgId: f.orgId,
    membershipId: "unrestricted-integration-context",
    userId: f.userId,
    userName: "Υπεύθυνος STK-05",
    permissions: ["counts.read", "counts.add", "counts.edit", "counts.finalize"],
    storeIds: [],
    warehouseIds,
    can: (permission) => permission.startsWith("counts."),
  };
}

function input(f: Fixture, override: Partial<{ clientKey: string; storeId: string | null; warehouseId: string; countedOn: string; note: string | null }> = {}) {
  return { clientKey: randomUUID(), warehouseId: f.warehouseId, countedOn, note: "Δοκιμαστική απογραφή", ...override };
}

function seed(f: Fixture, quantity: number, override: Partial<PostStockMovementInput> = {}) {
  return stockTransaction((tx) => postStockMovement(tx, {
    orgId: f.orgId,
    warehouseId: f.warehouseId,
    genericItemId: f.genericItemId,
    lotId: f.lotId,
    quantity,
    source: "manual",
    actor: { id: f.userId, name: "Υπεύθυνος STK-05" },
    ...override,
  }));
}

async function expectCountCode(promise: Promise<unknown>, code: StockCountError["code"]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof StockCountError);
    assert.equal(error.code, code);
    return true;
  });
}

async function expectScopeCode(promise: Promise<unknown>, code: StockScopeError["code"]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof StockScopeError);
    assert.equal(error.code, code);
    return true;
  });
}

async function saveLines(countId: string, measurements: readonly { lineId: string; actualQty: number | null; reason?: string | null }[], f: Fixture) {
  await updateStockCountMeasurements(context(f), countId, measurements);
}

test("PostgreSQL STK-05: frozen snapshot/cost, concurrent replay create και key reuse", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const request = input(f);
    const results = await Promise.all([createStockCount(context(f), request), createStockCount(context(f), request)]);
    assert.equal(results[0]!.id, results[1]!.id);
    assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(await db.stockCount.count({ where: { orgId: f.orgId } }), 1);

    const count = await db.stockCount.findUnique({ where: { id: results[0]!.id }, include: { lines: true } });
    assert.ok(count);
    assert.equal(count.lines.length, 1);
    assert.equal(count.lines[0]!.expectedQty, 10);
    assert.equal(count.lines[0]!.unitCostHundredths, 125);
    assert.equal(count.storeId, null);
    assert.equal(count.createdById, f.userId);
    assert.equal(count.countedOn.toISOString(), "2026-11-22T00:00:00.000Z");

    await db.genericItem.update({ where: { id: f.genericItemId }, data: { avgCostHundredths: 999 } });
    const replay = await createStockCount(context(f), request);
    assert.deepEqual(replay, { id: count.id, replayed: true });
    assert.equal((await db.stockCountLine.findUnique({ where: { id: count.lines[0]!.id } }))?.unitCostHundredths, 125);
    await expectCountCode(createStockCount(context(f), { ...request, note: "Διαφορετικό payload" }), "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await db.stockCount.count({ where: { orgId: f.orgId } }), 1);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-05: no-lot και νέα lot, μία correction ανά διαφορά, actor/audit και immutable replay", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    await seed(f, 4, { lotId: null });
    const created = await createStockCount(context(f), input(f));
    const count = await db.stockCount.findUnique({ where: { id: created.id }, include: { lines: true } });
    assert.ok(count);
    assert.equal(count.lines.length, 2);
    assert.ok(count.lines.every((line) => line.actualQty === null && line.differenceQty === null));

    await expectCountCode(addStockCountLine(context(f), count.id, { genericItemId: f.genericItemId, lotId: null }), "DUPLICATE_COUNT_LINE");
    const expiresAt = new Date("2027-03-20T00:00:00.000Z");
    await addStockCountLotLine(context(f), count.id, { genericItemId: f.genericItemId, batchNumber: "FOUND-PHYSICAL-LOT", expiresAt });
    const detailed = await db.stockCount.findUnique({ where: { id: created.id }, include: { lines: { include: { lot: true } } } });
    assert.ok(detailed);
    const lotLine = detailed.lines.find((line) => line.lotId === f.lotId)!;
    const noLotLine = detailed.lines.find((line) => line.lotId === null)!;
    const newLotLine = detailed.lines.find((line) => line.lot?.batchNumber === "FOUND-PHYSICAL-LOT")!;
    assert.ok(lotLine && noLotLine && newLotLine);
    assert.equal(newLotLine.expectedQty, 0);
    assert.equal(newLotLine.lot?.expiresAt?.toISOString(), expiresAt.toISOString());

    await saveLines(count.id, [
      { lineId: lotLine.id, actualQty: 8, reason: "σπασίματα" },
      { lineId: noLotLine.id, actualQty: 4 },
      { lineId: newLotLine.id, actualQty: 3, reason: "μη καταχωρισμένη παραλαβή" },
    ], f);
    const finalized = await finalizeStockCount(context(f), count.id);
    assert.deepEqual(finalized, { id: count.id, replayed: false, lineCount: 3, correctionCount: 2 });

    const stored = await db.stockCount.findUnique({ where: { id: count.id }, include: { lines: { include: { movement: true } }, movements: true } });
    assert.ok(stored);
    assert.equal(stored.status, "FINALIZED");
    assert.equal(stored.finalizedById, f.userId);
    assert.equal(stored.finalizedByName, "Υπεύθυνος STK-05");
    assert.ok(stored.finalizedAt);
    assert.equal(stored.movements.length, 2);
    assert.deepEqual(stored.movements.map((movement) => movement.quantity).sort((a, b) => a - b), [-2, 3]);
    assert.equal(stored.lines.filter((line) => line.movement).length, 2);
    assert.equal(stored.lines.find((line) => line.id === noLotLine.id)!.movement, null);
    for (const movement of stored.movements) {
      assert.equal(movement.source, "count");
      assert.equal(movement.countId, stored.id);
      assert.equal(movement.createdById, f.userId);
      assert.equal(movement.createdByName, "Υπεύθυνος STK-05");
      assert.equal(movement.storeId, null);
      assert.ok(movement.countLineId);
      assert.equal(movement.occurredAt.toISOString(), stored.finalizedAt!.toISOString());
      assert.ok(movement.note && movement.note.length >= 3);
    }
    const audits = await db.auditEvent.findMany({ where: { orgId: f.orgId, entityType: "stock_count", entityId: stored.id } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.action, "stock.count.finalized");
    assert.equal(audits[0]!.actorId, f.userId);
    assert.deepEqual(audits[0]!.metadata, { countedOn, lineCount: 3, correctionCount: 2 });

    const replay = await finalizeStockCount(context(f), stored.id);
    assert.deepEqual(replay, { id: stored.id, replayed: true, lineCount: 3, correctionCount: 2 });
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "count" } }), 2);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), 1);
    await expectCountCode(saveLines(stored.id, [{ lineId: lotLine.id, actualQty: 7, reason: "νέα αλλαγή" }], f), "COUNT_ALREADY_FINALIZED");
    await expectCountCode(addStockCountLine(context(f), stored.id, { genericItemId: f.otherGenericItemId }), "COUNT_ALREADY_FINALIZED");
    assert.equal((await db.stockCountLine.findUnique({ where: { id: lotLine.id } }))?.actualQty, 8);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-05: missing actual/reason απορρίπτουν όλο το finalize χωρίς corrections ή audit", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const created = await createStockCount(context(f), input(f));
    await addStockCountLine(context(f), created.id, { genericItemId: f.otherGenericItemId });
    const lines = await db.stockCountLine.findMany({ where: { orgId: f.orgId, countId: created.id } });
    const first = lines.find((line) => line.genericItemId === f.genericItemId)!;
    const second = lines.find((line) => line.genericItemId === f.otherGenericItemId)!;

    await expectCountCode(finalizeStockCount(context(f), created.id), "MISSING_ACTUAL_QUANTITY");
    await saveLines(created.id, [
      { lineId: first.id, actualQty: 8, reason: "σπασίματα" },
      { lineId: second.id, actualQty: null },
    ], f);
    await expectCountCode(finalizeStockCount(context(f), created.id), "MISSING_ACTUAL_QUANTITY");
    await saveLines(created.id, [
      { lineId: first.id, actualQty: 8, reason: "σπασίματα" },
      { lineId: second.id, actualQty: 2, reason: " " },
    ], f);
    await expectCountCode(finalizeStockCount(context(f), created.id), "MISSING_DIFFERENCE_REASON");
    await saveLines(created.id, [
      { lineId: first.id, actualQty: 8, reason: "σπασίματα" },
      { lineId: second.id, actualQty: 2, reason: "απ" },
    ], f);
    await expectCountCode(finalizeStockCount(context(f), created.id), "MISSING_DIFFERENCE_REASON");

    assert.equal((await db.stockCount.findUnique({ where: { id: created.id } }))?.status, "DRAFT");
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "count" } }), 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), 0);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-05: backdated κίνηση μετά το snapshot κάνει πλήρες rollback", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const created = await createStockCount(context(f), input(f));
    const line = (await db.stockCountLine.findFirst({ where: { orgId: f.orgId, countId: created.id } }))!;
    await saveLines(created.id, [{ lineId: line.id, actualQty: 8, reason: "σπασίματα" }], f);
    await seed(f, 1, { occurredAt: new Date("2020-01-01T00:00:00.000Z") });
    await assert.rejects(finalizeStockCount(context(f), created.id), (error: unknown) => {
      assert.ok(error instanceof StockError);
      assert.equal(error.code, "STOCK_CHANGED_SINCE_SNAPSHOT");
      return true;
    });
    assert.equal((await db.stockCount.findUnique({ where: { id: created.id } }))?.status, "DRAFT");
    assert.equal((await db.stockCount.findUnique({ where: { id: created.id } }))?.finalizedAt, null);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 2);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "count" } }), 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), 0);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-05: concurrent finalize ίδιου count δίνει μία οριστικοποίηση και ένα replay", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const created = await createStockCount(context(f), input(f));
    const line = (await db.stockCountLine.findFirst({ where: { orgId: f.orgId, countId: created.id } }))!;
    await saveLines(created.id, [{ lineId: line.id, actualQty: 6, reason: "απόκλιση μέτρησης" }], f);
    const results = await Promise.all([finalizeStockCount(context(f), created.id), finalizeStockCount(context(f), created.id)]);
    assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
    assert.ok(results.every((result) => result.id === created.id && result.lineCount === 1 && result.correctionCount === 1));
    assert.equal((await db.stockCount.findUnique({ where: { id: created.id } }))?.status, "FINALIZED");
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "count", countId: created.id, quantity: -4 } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "stock.count.finalized" } }), 1);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-05: δύο drafts ίδιας ημέρας επιτρέπουν μόνο μία finalized απογραφή", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const first = await createStockCount(context(f), input(f));
    const second = await createStockCount(context(f), input(f));
    assert.notEqual(first.id, second.id);
    for (const countId of [first.id, second.id]) {
      const line = (await db.stockCountLine.findFirst({ where: { orgId: f.orgId, countId } }))!;
      await saveLines(countId, [{ lineId: line.id, actualQty: 10 }], f);
    }
    assert.equal((await finalizeStockCount(context(f), first.id)).replayed, false);
    await expectCountCode(finalizeStockCount(context(f), second.id), "FINALIZED_COUNT_EXISTS");
    assert.equal((await db.stockCount.findUnique({ where: { id: second.id } }))?.status, "DRAFT");
    assert.equal(await db.stockCount.count({ where: { orgId: f.orgId, status: "FINALIZED" } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "stock.count.finalized" } }), 1);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-05: cross-tenant, warehouse scope και inactive warehouse δεν γράφουν τίποτα", databaseOptions, async () => {
  const f = await fixture();
  const foreign = await fixture();
  try {
    await seed(f, 5);
    await seed(foreign, 7);
    const own = await createStockCount(context(f), input(f));
    const other = await createStockCount(context(foreign), input(foreign));
    const otherLine = (await db.stockCountLine.findFirst({ where: { orgId: foreign.orgId, countId: other.id } }))!;

    await expectScopeCode(createStockCount(context(f), input(f, { warehouseId: foreign.warehouseId })), "WAREHOUSE_NOT_FOUND");
    await expectCountCode(updateStockCountMeasurements(context(f), other.id, [{ lineId: otherLine.id, actualQty: 7 }]), "COUNT_NOT_FOUND");
    await expectCountCode(finalizeStockCount(context(f), other.id), "COUNT_NOT_FOUND");
    await assert.rejects(addStockCountLine(context(f), own.id, { genericItemId: foreign.genericItemId }), (error: unknown) => {
      assert.ok(error instanceof StockError);
      assert.equal(error.code, "GENERIC_ITEM_NOT_FOUND");
      return true;
    });
    await expectScopeCode(finalizeStockCount(context(f, [f.otherWarehouseId]), own.id), "WAREHOUSE_NOT_FOUND");
    await db.warehouse.update({ where: { id: f.warehouseId }, data: { active: false } });
    await expectScopeCode(finalizeStockCount(context(f), own.id), "WAREHOUSE_INACTIVE");
    await expectScopeCode(createStockCount(context(f), input(f)), "WAREHOUSE_INACTIVE");

    assert.equal((await db.stockCount.findUnique({ where: { id: own.id } }))?.status, "DRAFT");
    assert.equal((await db.stockCount.findUnique({ where: { id: other.id } }))?.status, "DRAFT");
    assert.equal((await db.stockCountLine.findUnique({ where: { id: otherLine.id } }))?.actualQty, null);
    assert.equal(await db.stockMovement.count({ where: { orgId: { in: [f.orgId, foreign.orgId] }, source: "count" } }), 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: { in: [f.orgId, foreign.orgId] } } }), 0);
  } finally {
    await cleanup(f);
    await cleanup(foreign);
  }
});


test("PostgreSQL STK-06: store count, replay, ημερήσιο conflict και scoped corrections", databaseOptions, async () => {
  const f = await fixture();
  try {
    const store = await db.store.create({ data: { orgId: f.orgId, name: "Κατάστημα STK-06" } });
    await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: f.warehouseId, isDefault: true } });
    await seed(f, 10);
    const request = input(f, { storeId: store.id });
    const first = await createStockCount(context(f), request);
    const replay = await createStockCount(context(f), request);
    assert.deepEqual(replay, { id: first.id, replayed: true });

    const count = await db.stockCount.findUnique({ where: { id: first.id }, include: { lines: true } });
    assert.ok(count);
    assert.equal(count.storeId, store.id);
    assert.equal(count.lines[0]!.expectedQty, 10);
    await saveLines(count.id, [{ lineId: count.lines[0]!.id, actualQty: 8, reason: "διαφορά καταστήματος" }], f);
    assert.equal((await finalizeStockCount(context(f), count.id)).replayed, false);
    assert.deepEqual(await finalizeStockCount(context(f), count.id), { id: count.id, replayed: true, lineCount: 1, correctionCount: 1 });

    const movement = await db.stockMovement.findFirst({ where: { orgId: f.orgId, countId: count.id } });
    assert.ok(movement);
    assert.equal(movement.storeId, store.id);
    assert.equal(movement.quantity, -2);

    const second = await createStockCount(context(f), input(f, { storeId: store.id }));
    const secondLine = (await db.stockCountLine.findFirst({ where: { countId: second.id, orgId: f.orgId } }))!;
    await saveLines(second.id, [{ lineId: secondLine.id, actualQty: 8 }], f);
    await expectCountCode(finalizeStockCount(context(f), second.id), "FINALIZED_COUNT_EXISTS");
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "count" } }), 1);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-06: store/warehouse link, membership και inactive store μπλοκάρουν εγγραφές", databaseOptions, async () => {
  const f = await fixture();
  const foreign = await fixture();
  try {
    await seed(f, 5);
    const store = await db.store.create({ data: { orgId: f.orgId, name: "Περιορισμένο κατάστημα STK-06" } });
    const otherStore = await db.store.create({ data: { orgId: f.orgId, name: "Άλλο κατάστημα STK-06" } });
    await expectScopeCode(createStockCount(context(f), input(f, { storeId: store.id })), "WAREHOUSE_NOT_ALLOWED_FOR_STORE");
    await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: f.warehouseId } });
    await db.storeWarehouse.create({ data: { storeId: otherStore.id, warehouseId: f.otherWarehouseId } });

    const role = await db.orgRole.create({ data: { orgId: f.orgId, name: "Απογραφές STK-06", permissions: ["counts.read", "counts.add", "counts.edit", "counts.finalize"] } });
    const membership = await db.membership.create({ data: { orgId: f.orgId, userId: f.userId, roleId: role.id } });
    await db.membershipStore.create({ data: { membershipId: membership.id, storeId: store.id } });
    const restricted = { ...context(f), membershipId: membership.id, storeIds: [store.id] };
    await expectScopeCode(createStockCount(restricted, input(f, { storeId: otherStore.id, warehouseId: f.otherWarehouseId })), "STORE_NOT_FOUND");

    const own = await createStockCount(restricted, input(f, { storeId: store.id }));
    const line = (await db.stockCountLine.findFirst({ where: { orgId: f.orgId, countId: own.id } }))!;
    await updateStockCountMeasurements(restricted, own.id, [{ lineId: line.id, actualQty: 5 }]);
    await db.store.update({ where: { id: store.id }, data: { active: false } });
    await expectScopeCode(createStockCount(context(f), input(f, { storeId: store.id })), "STORE_INACTIVE");
    await expectScopeCode(finalizeStockCount(context(f), own.id), "STORE_INACTIVE");
    await expectScopeCode(createStockCount(context(f), input(f, { storeId: foreign.warehouseId })), "STORE_NOT_FOUND");
    assert.equal((await db.stockCount.findUnique({ where: { id: own.id } }))?.status, "DRAFT");
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "count" } }), 0);
  } finally {
    await cleanup(f);
    await cleanup(foreign);
  }
});


test("PostgreSQL STK-08: edit replay, payload mismatch, stale revision και finalized replay", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const store = await db.store.create({ data: { orgId: f.orgId, name: "Offline STK-08" } });
    await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: f.warehouseId } });
    const created = await createStockCount(context(f), input(f, { storeId: store.id }));
    const initial = (await db.stockCount.findUnique({ where: { id: created.id } }))!;
    const line = (await db.stockCountLine.findFirst({ where: { orgId: f.orgId, countId: created.id } }))!;
    const options = { clientKey: randomUUID(), expectedUpdatedAt: initial.updatedAt };
    const first = await updateStockCountMeasurements(context(f), created.id, [{ lineId: line.id, actualQty: 8, reason: "offline μέτρηση" }], options);
    assert.equal(first.replayed, false);
    assert.ok(first.updatedAt > initial.updatedAt);

    const replay = await updateStockCountMeasurements(context(f), created.id, [{ lineId: line.id, actualQty: 8, reason: "offline μέτρηση" }], options);
    assert.equal(replay.replayed, true);
    assert.equal(replay.updatedAt.toISOString(), first.updatedAt.toISOString());
    assert.equal(await db.stockCountEdit.count({ where: { orgId: f.orgId, countId: created.id } }), 1);
    await expectCountCode(updateStockCountMeasurements(context(f), created.id, [{ lineId: line.id, actualQty: 7, reason: "άλλο payload" }], options), "IDEMPOTENCY_KEY_REUSED");
    await expectCountCode(updateStockCountMeasurements(context(f), created.id, [{ lineId: line.id, actualQty: 6, reason: "παλιά συσκευή" }], { clientKey: randomUUID(), expectedUpdatedAt: initial.updatedAt }), "COUNT_REVISION_CONFLICT");
    assert.equal((await db.stockCountLine.findUnique({ where: { id: line.id } }))?.actualQty, 8);

    await finalizeStockCount(context(f), created.id);
    const finalizedReplay = await updateStockCountMeasurements(context(f), created.id, [{ lineId: line.id, actualQty: 8, reason: "offline μέτρηση" }], options);
    assert.equal(finalizedReplay.replayed, true);
    await expectCountCode(updateStockCountMeasurements(context(f), created.id, [{ lineId: line.id, actualQty: 8, reason: "offline μέτρηση" }], { clientKey: randomUUID(), expectedUpdatedAt: first.updatedAt }), "COUNT_ALREADY_FINALIZED");
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "count" } }), 1);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-08: concurrent device edits επιτρέπουν μία εγγραφή και ρητό revision conflict", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const created = await createStockCount(context(f), input(f));
    const initial = (await db.stockCount.findUnique({ where: { id: created.id } }))!;
    const line = (await db.stockCountLine.findFirst({ where: { orgId: f.orgId, countId: created.id } }))!;
    const results = await Promise.allSettled([7, 8].map((actualQty) => updateStockCountMeasurements(
      context(f),
      created.id,
      [{ lineId: line.id, actualQty, reason: "ταυτόχρονη συσκευή" }],
      { clientKey: randomUUID(), expectedUpdatedAt: initial.updatedAt },
    )));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof StockCountError);
    assert.equal(rejected.reason.code, "COUNT_REVISION_CONFLICT");
    assert.equal(await db.stockCountEdit.count({ where: { orgId: f.orgId, countId: created.id } }), 1);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-08: conflict snapshot είναι read-only και tenant/store/warehouse scoped", databaseOptions, async () => {
  const f = await fixture();
  const foreign = await fixture();
  try {
    await seed(f, 10);
    const store = await db.store.create({ data: { orgId: f.orgId, name: "Conflict snapshot STK-08" } });
    await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: f.warehouseId } });
    const created = await createStockCount(context(f), input(f, { storeId: store.id }));
    const initial = await readStockCountRevision(context(f), created.id);
    assert.equal(initial.status, "DRAFT");
    assert.equal(initial.lines.length, 1);
    assert.equal(initial.lines[0]?.expectedQty, 10);
    assert.equal(initial.lines[0]?.currentQty, null);
    assert.equal(initial.lines[0]?.itemName, "Γάλα STK-05");

    const first = await updateStockCountMeasurements(context(f), created.id, [
      { lineId: initial.lines[0]!.lineId, actualQty: 8, reason: "μέτρηση άλλης συσκευής" },
    ], { clientKey: randomUUID(), expectedUpdatedAt: new Date(initial.updatedAt) });
    const current = await readStockCountRevision(context(f), created.id);
    assert.equal(current.updatedAt, first.updatedAt.toISOString());
    assert.equal(current.lines[0]?.currentQty, 8);
    assert.equal(current.lines[0]?.currentReason, "μέτρηση άλλης συσκευής");
    assert.equal(current.lines[0]?.expectedQty, 10);
    await expectScopeCode(readStockCountRevision(context(f, [f.otherWarehouseId]), created.id), "WAREHOUSE_NOT_FOUND");
    await expectCountCode(readStockCountRevision(context(foreign), created.id), "COUNT_NOT_FOUND");

    await finalizeStockCount(context(f), created.id);
    assert.equal((await readStockCountRevision(context(f), created.id)).status, "FINALIZED");
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "count" } }), 1);
  } finally {
    await cleanup(f);
    await cleanup(foreign);
  }
});
