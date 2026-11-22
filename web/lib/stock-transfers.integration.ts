import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { postStockMovement, StockError, type PostStockMovementInput } from "./stock-db.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";
import { stockTransaction } from "./stock-transaction.ts";
import { postStockTransfer } from "./stock-transfers.ts";
import { StockTransferError, type StockTransferInput } from "./stock-transfer-request.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };

type Fixture = {
  orgId: string;
  userId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  genericItemId: string;
  otherGenericItemId: string;
  sourceLotId: string;
  otherSourceLotId: string;
  expiresAt: Date;
  unitId: string;
  ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `STK-04 ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const user = await tx.user.create({ data: { email: `stk04-${suffix}@example.test`, name: "Υπεύθυνος STK-04" } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const source = await tx.warehouse.create({ data: { orgId: org.id, name: "Προέλευση" } });
    const destination = await tx.warehouse.create({ data: { orgId: org.id, name: "Προορισμός" } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα STK-04", baseUnitId: unit.id, avgCostHundredths: 125 } });
    const otherGeneric = await tx.genericItem.create({ data: { orgId: org.id, name: "Ζάχαρη STK-04", baseUnitId: unit.id, avgCostHundredths: 250 } });
    const expiresAt = new Date("2027-01-15T00:00:00.000Z");
    const lot = await tx.stockLot.create({ data: { orgId: org.id, genericItemId: generic.id, warehouseId: source.id, batchNumber: `LOT-A-${suffix}`, expiresAt } });
    const otherLot = await tx.stockLot.create({ data: { orgId: org.id, genericItemId: otherGeneric.id, warehouseId: source.id, batchNumber: `LOT-B-${suffix}`, expiresAt } });
    return {
      orgId: org.id,
      userId: user.id,
      sourceWarehouseId: source.id,
      destinationWarehouseId: destination.id,
      genericItemId: generic.id,
      otherGenericItemId: otherGeneric.id,
      sourceLotId: lot.id,
      otherSourceLotId: otherLot.id,
      expiresAt,
      unitId: unit.id,
      ownsUnit: !existingUnit,
    };
  });
}

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
  await db.stockTransferLine.deleteMany({ where: { orgId: f.orgId } });
  await db.stockTransfer.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

function context(f: Fixture, warehouseIds: readonly string[] = []): StockContext {
  return {
    orgId: f.orgId,
    membershipId: "unrestricted-integration-context",
    userId: f.userId,
    userName: "Υπεύθυνος STK-04",
    permissions: ["stock.transfer"],
    storeIds: [],
    warehouseIds,
    can: (permission) => permission === "stock.transfer",
  };
}

function request(f: Fixture, quantity: number, override: Partial<StockTransferInput> = {}): StockTransferInput {
  return {
    clientKey: randomUUID(),
    sourceWarehouseId: f.sourceWarehouseId,
    destinationWarehouseId: f.destinationWarehouseId,
    note: "Δοκιμαστική μεταφορά",
    lines: [{ genericItemId: f.genericItemId, sourceLotId: f.sourceLotId, quantity }],
    ...override,
  };
}

function seed(f: Fixture, quantity: number, override: Partial<PostStockMovementInput> = {}) {
  return stockTransaction((tx) => postStockMovement(tx, {
    orgId: f.orgId,
    warehouseId: f.sourceWarehouseId,
    genericItemId: f.genericItemId,
    lotId: f.sourceLotId,
    quantity,
    source: "manual",
    actor: { id: f.userId, name: "Υπεύθυνος STK-04" },
    ...override,
  }));
}

async function expectTransferCode(promise: Promise<unknown>, code: StockTransferError["code"]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof StockTransferError);
    assert.equal(error.code, code);
    return true;
  });
}

test("PostgreSQL STK-04: lot conservation, δύο κινήσεις, κόστος, audit και ασφαλές replay", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const input = request(f, 4);
    const posted = await postStockTransfer(context(f), input);
    assert.equal(posted.replayed, false);
    assert.equal(posted.lines[0]!.sourceBalance, 6);
    assert.equal(posted.lines[0]!.destinationBalance, 4);

    const transfer = await db.stockTransfer.findFirst({
      where: { id: posted.id, orgId: f.orgId },
      include: { lines: { include: { sourceLot: true, destinationLot: true } }, movements: true },
    });
    assert.ok(transfer);
    assert.equal(transfer.lines.length, 1);
    assert.equal(transfer.movements.length, 2);
    assert.equal(transfer.createdById, f.userId);
    assert.equal(transfer.createdByName, "Υπεύθυνος STK-04");
    const line = transfer.lines[0]!;
    assert.equal(line.quantity, 4);
    assert.equal(line.unitCostHundredths, 125);
    assert.equal(line.sourceLotId, f.sourceLotId);
    assert.ok(line.destinationLotId && line.destinationLotId !== f.sourceLotId);
    assert.equal(line.sourceLot?.batchNumber, line.destinationLot?.batchNumber);
    assert.equal(line.sourceLot?.expiresAt?.toISOString(), f.expiresAt.toISOString());
    assert.equal(line.destinationLot?.expiresAt?.toISOString(), f.expiresAt.toISOString());
    assert.equal(line.destinationLot?.documentId, null);
    assert.deepEqual(transfer.movements.map((movement) => movement.quantity).sort((a, b) => a - b), [-4, 4]);
    for (const movement of transfer.movements) {
      assert.equal(movement.orgId, f.orgId);
      assert.equal(movement.genericItemId, f.genericItemId);
      assert.equal(movement.transferId, transfer.id);
      assert.equal(movement.transferLineId, line.id);
      assert.equal(movement.source, "transfer");
      assert.equal(movement.createdById, f.userId);
    }
    const sourceMovement = transfer.movements.find((movement) => movement.quantity < 0)!;
    const destinationMovement = transfer.movements.find((movement) => movement.quantity > 0)!;
    assert.equal(sourceMovement.warehouseId, f.sourceWarehouseId);
    assert.equal(sourceMovement.lotId, f.sourceLotId);
    assert.equal(destinationMovement.warehouseId, f.destinationWarehouseId);
    assert.equal(destinationMovement.lotId, line.destinationLotId);
    assert.equal((await db.genericItem.findUnique({ where: { id: f.genericItemId } }))?.avgCostHundredths, 125);
    const audit = await db.auditEvent.findMany({ where: { orgId: f.orgId, entityType: "stock_transfer", entityId: transfer.id } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.action, "stock.transfer.posted");
    assert.equal(audit[0]!.actorId, f.userId);

    const replay = await postStockTransfer(context(f), input);
    assert.equal(replay.id, posted.id);
    assert.equal(replay.replayed, true);
    assert.equal(await db.stockTransfer.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, transferId: posted.id } }), 2);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), 1);
    await expectTransferCode(postStockTransfer(context(f), { ...input, lines: [{ genericItemId: f.genericItemId, sourceLotId: f.sourceLotId, quantity: 5 }] }), "IDEMPOTENCY_KEY_REUSED");
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-04: concurrent ίδιο clientKey δημιουργεί μία μεταφορά και ένα audit", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const input = request(f, 4);
    const results = await Promise.all([postStockTransfer(context(f), input), postStockTransfer(context(f), input)]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(await db.stockTransfer.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "transfer" } }), 2);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "stock.transfer.posted" } }), 1);
    assert.equal(results[0].lines[0]!.sourceBalance + (await db.stockTransferLine.findFirst({ where: { transferId: results[0].id } }))!.quantity, 10);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-04: concurrent αφαιρέσεις 7 από 10 χωρίς αρνητικό υπόλοιπο", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 10);
    const results = await Promise.allSettled([
      postStockTransfer(context(f), request(f, 7)),
      postStockTransfer(context(f), request(f, 7)),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof StockError);
    assert.equal(rejected.reason.code, "NEGATIVE_STOCK_NOT_ALLOWED");
    assert.equal(await db.stockTransfer.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "transfer" } }), 2);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 3);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-04: αποτυχία δεύτερης γραμμής κάνει πλήρες rollback και destination lots", databaseOptions, async () => {
  const f = await fixture();
  try {
    const ordered = [
      { genericItemId: f.genericItemId, sourceLotId: f.sourceLotId },
      { genericItemId: f.otherGenericItemId, sourceLotId: f.otherSourceLotId },
    ].sort((a, b) => a.genericItemId.localeCompare(b.genericItemId));
    await seed(f, 1, { genericItemId: ordered[0]!.genericItemId, lotId: ordered[0]!.sourceLotId });
    await assert.rejects(postStockTransfer(context(f), request(f, 1, {
      lines: ordered.map((line) => ({ ...line, quantity: 1 })),
    })), (error: unknown) => {
      assert.ok(error instanceof StockError);
      assert.equal(error.code, "NEGATIVE_STOCK_NOT_ALLOWED");
      return true;
    });
    assert.equal(await db.stockTransfer.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.stockTransferLine.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.stockLot.count({ where: { orgId: f.orgId, warehouseId: f.destinationWarehouseId } }), 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), 0);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-04: διαφορετική λήξη destination lot απορρίπτεται χωρίς mutation", databaseOptions, async () => {
  const f = await fixture();
  try {
    await seed(f, 5);
    const source = await db.stockLot.findUnique({ where: { id: f.sourceLotId } });
    const wrongExpiry = new Date("2027-02-20T00:00:00.000Z");
    const destination = await db.stockLot.create({ data: {
      orgId: f.orgId,
      genericItemId: f.genericItemId,
      warehouseId: f.destinationWarehouseId,
      batchNumber: source!.batchNumber,
      expiresAt: wrongExpiry,
    } });
    await expectTransferCode(postStockTransfer(context(f), request(f, 1)), "DESTINATION_LOT_EXPIRY_MISMATCH");
    assert.equal((await db.stockLot.findUnique({ where: { id: destination.id } }))?.expiresAt?.toISOString(), wrongExpiry.toISOString());
    assert.equal(await db.stockTransfer.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), 0);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL STK-04: cross-tenant, warehouse scope και inactive destination δεν γράφουν τίποτα", databaseOptions, async () => {
  const f = await fixture();
  const foreign = await fixture();
  try {
    await seed(f, 5);
    await assert.rejects(postStockTransfer(context(f), request(f, 1, { destinationWarehouseId: foreign.destinationWarehouseId })), (error: unknown) => {
      assert.ok(error instanceof StockScopeError);
      assert.equal(error.code, "WAREHOUSE_NOT_FOUND");
      return true;
    });
    await assert.rejects(postStockTransfer(context(f), request(f, 1, {
      lines: [{ genericItemId: foreign.genericItemId, sourceLotId: null, quantity: 1 }],
    })), (error: unknown) => {
      assert.ok(error instanceof StockError);
      assert.equal(error.code, "GENERIC_ITEM_NOT_FOUND");
      return true;
    });
    await assert.rejects(postStockTransfer(context(f, [f.sourceWarehouseId]), request(f, 1)), (error: unknown) => {
      assert.ok(error instanceof StockScopeError);
      assert.equal(error.code, "WAREHOUSE_NOT_FOUND");
      return true;
    });
    await db.warehouse.update({ where: { id: f.destinationWarehouseId }, data: { active: false } });
    await assert.rejects(postStockTransfer(context(f), request(f, 1)), (error: unknown) => {
      assert.ok(error instanceof StockScopeError);
      assert.equal(error.code, "WAREHOUSE_INACTIVE");
      return true;
    });
    assert.equal(await db.stockTransfer.count({ where: { orgId: { in: [f.orgId, foreign.orgId] } } }), 0);
    assert.equal(await db.stockMovement.count({ where: { orgId: foreign.orgId } }), 0);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 1);
  } finally {
    await cleanup(f);
    await cleanup(foreign);
  }
});

test("PostgreSQL STK-04: no-lot ζεύγος και έγκυρο store context", databaseOptions, async () => {
  const f = await fixture();
  try {
    const store = await db.store.create({ data: { orgId: f.orgId, name: "Κατάστημα STK-04" } });
    await db.storeWarehouse.createMany({ data: [
      { storeId: store.id, warehouseId: f.sourceWarehouseId },
      { storeId: store.id, warehouseId: f.destinationWarehouseId },
    ] });
    await seed(f, 8, { lotId: null });
    const input = request(f, 3, { storeId: store.id, lines: [{ genericItemId: f.genericItemId, sourceLotId: null, quantity: 3 }] });
    const posted = await postStockTransfer(context(f), input);
    assert.equal(posted.lines[0]!.sourceLotId, null);
    assert.equal(posted.lines[0]!.destinationLotId, null);
    assert.equal(posted.lines[0]!.sourceBalance, 5);
    assert.equal(posted.lines[0]!.destinationBalance, 3);
    const movements = await db.stockMovement.findMany({ where: { orgId: f.orgId, transferId: posted.id } });
    assert.equal(movements.length, 2);
    assert.ok(movements.every((movement) => movement.storeId === store.id && movement.lotId === null));

    const unlinked = await db.store.create({ data: { orgId: f.orgId, name: "Χωρίς αποθήκες" } });
    await assert.rejects(postStockTransfer(context(f), { ...input, clientKey: randomUUID(), storeId: unlinked.id }), (error: unknown) => {
      assert.ok(error instanceof StockScopeError);
      assert.equal(error.code, "WAREHOUSE_NOT_ALLOWED_FOR_STORE");
      return true;
    });
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, source: "transfer" } }), 2);
  } finally {
    await cleanup(f);
  }
});
