// Απογραφή εργαστηρίου/καταστήματος: snapshot, revisioned offline edits και ατομικό finalize.
import type { Prisma } from "./generated/prisma/client.ts";
import { writeAudit } from "./audit.ts";
import { db } from "./db.ts";
import {
  assertFinalizableStockCountLine,
  canonicalStockCountMeasurement,
  canonicalStockCountRequest,
  stockCountedOnDate,
  stockCountDifference,
  stockCountMeasurementsHash,
  stockCountRequestHash,
  StockCountError,
  type CanonicalStockCountRequest,
  type StockCountInput,
  type StockCountMeasurementInput,
} from "./stock-count-request.ts";
import {
  assertNoMovementAfterSnapshot,
  lockStockWarehouses,
  postStockMovement,
  stockBalances,
  StockError,
  type StockKey,
} from "./stock-db.ts";
import { assertStockScope, type StockContext } from "./stock-scope.ts";
import { stockTransaction } from "./stock-transaction.ts";

type CountDb = Pick<Prisma.TransactionClient, "stockCount" | "stockCountLine" | "stockCountEdit">;
type CountHeader = {
  id: string;
  orgId: string;
  storeId: string | null;
  warehouseId: string;
  countedOn: Date;
  snapshotAt: Date;
  status: "DRAFT" | "FINALIZED";
  updatedAt: Date;
};

export type StockCountResult = { id: string; replayed: boolean };
export type StockCountFinalizeResult = StockCountResult & { lineCount: number; correctionCount: number };

export type StockCountRevision = {
  countId: string;
  status: "DRAFT" | "FINALIZED";
  updatedAt: string;
  lines: {
    lineId: string;
    itemName: string;
    batchNumber: string | null;
    unitCode: string;
    expectedQty: number;
    currentQty: number | null;
    currentReason: string | null;
  }[];
};

/** Read-only snapshot για σύγκριση conflict· ο επανέλεγχος scope γίνεται πριν από κάθε αποκάλυψη τιμών. */
export async function readStockCountRevision(ctx: StockContext, countId: string): Promise<StockCountRevision> {
  const count = await db.stockCount.findFirst({
    where: { id: entityId(countId), orgId: ctx.orgId },
    select: {
      id: true,
      storeId: true,
      warehouseId: true,
      status: true,
      updatedAt: true,
      lines: {
        select: {
          id: true,
          expectedQty: true,
          actualQty: true,
          reason: true,
          genericItem: { select: { name: true, baseUnit: { select: { code: true } } } },
          lot: { select: { batchNumber: true } },
        },
        orderBy: [{ genericItem: { name: "asc" } }, { lotId: "asc" }],
      },
    },
  });
  if (!count) throw new StockCountError("COUNT_NOT_FOUND");
  await assertStockScope(db, ctx, { storeId: count.storeId ?? undefined, warehouseId: count.warehouseId });
  return {
    countId: count.id,
    status: count.status,
    updatedAt: count.updatedAt.toISOString(),
    lines: count.lines.map((line) => ({
      lineId: line.id,
      itemName: line.genericItem.name,
      batchNumber: line.lot?.batchNumber ?? null,
      unitCode: line.genericItem.baseUnit.code,
      expectedQty: line.expectedQty,
      currentQty: line.actualQty,
      currentReason: line.reason,
    })),
  };
}

function isUniqueConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && current.code === "P2002") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

function entityId(value: string): string {
  const clean = value.trim();
  if (!clean || clean.length > 80) throw new StockCountError("INVALID_COUNT_REQUEST");
  return clean;
}

async function databaseNow(tx: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
  if (!rows[0]) throw new StockCountError("INVALID_COUNT_REQUEST");
  return rows[0].now;
}

/** Πραγματική στιγμή λήψης, όχι αρχή transaction· το TIMESTAMP(3) στρογγυλοποιεί, άρα το snapshot στρογγυλοποιείται προς τα πάνω. */
async function databaseSnapshotAt(tx: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT DATE_TRUNC('milliseconds', CLOCK_TIMESTAMP()) + INTERVAL '1 millisecond' AS now`;
  if (!rows[0]) throw new StockCountError("INVALID_COUNT_REQUEST");
  return rows[0].now;
}

/** Το database clock μπορεί να έχει ίδιο millisecond· κάθε committed edit προχωρά τουλάχιστον 1 ms. */
async function nextStockCountRevision(tx: Pick<Prisma.TransactionClient, "$queryRaw">, previous: Date): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT GREATEST(CURRENT_TIMESTAMP, ${previous.toISOString()}::timestamptz + INTERVAL '1 millisecond') AS now`;
  if (!rows[0] || rows[0].now.getTime() <= previous.getTime()) throw new StockCountError("INVALID_COUNT_REQUEST");
  return rows[0].now;
}

async function scopedCount(tx: CountDb, ctx: StockContext, id: string): Promise<CountHeader> {
  const count = await tx.stockCount.findFirst({
    where: { id: entityId(id), orgId: ctx.orgId },
    select: { id: true, orgId: true, storeId: true, warehouseId: true, countedOn: true, snapshotAt: true, status: true, updatedAt: true },
  });
  if (!count) throw new StockCountError("COUNT_NOT_FOUND");
  return count;
}

async function existingCount(tx: CountDb, orgId: string, clientKey: string, requestHash: string): Promise<StockCountResult | null> {
  const existing = await tx.stockCount.findUnique({
    where: { orgId_clientKey: { orgId, clientKey } },
    select: { id: true, requestHash: true },
  });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new StockCountError("IDEMPOTENCY_KEY_REUSED");
  return { id: existing.id, replayed: true };
}

async function createInTransaction(
  tx: Prisma.TransactionClient,
  ctx: StockContext,
  request: CanonicalStockCountRequest,
  requestHash: string,
): Promise<StockCountResult> {
  await assertStockScope(tx, ctx, { storeId: request.storeId ?? undefined, warehouseId: request.warehouseId, forWrite: true });
  const replay = await existingCount(tx, ctx.orgId, request.clientKey, requestHash);
  if (replay) return replay;

  // Το αποκλειστικό lock καλύπτει και τη στρογγυλοποίηση προς τα πάνω· κανένα movement δεν μπαίνει πριν από το commit.
  await lockStockWarehouses(tx, ctx.orgId, [request.warehouseId], true);
  const snapshotAt = await databaseSnapshotAt(tx);
  const nonzero = (await stockBalances(tx, {
    orgId: ctx.orgId,
    warehouseIds: [request.warehouseId],
    storeId: request.storeId ?? undefined,
  })).filter((balance) => balance.quantity !== 0);
  const generics = nonzero.length ? await tx.genericItem.findMany({
    where: { orgId: ctx.orgId, id: { in: nonzero.map((balance) => balance.genericItemId) }, trackStock: true },
    select: { id: true, avgCostHundredths: true, baseUnit: { select: { toBase: true } } },
  }) : [];
  const genericById = new Map(generics.map((generic) => [generic.id, generic]));
  const included = nonzero.filter((balance) => genericById.has(balance.genericItemId));
  for (const generic of generics) {
    if (generic.baseUnit.toBase !== 1) throw new StockError("GENERIC_ITEM_BASE_UNIT_INVALID");
    if (!Number.isSafeInteger(generic.avgCostHundredths) || generic.avgCostHundredths < 0) {
      throw new StockCountError("INVALID_COUNT_REQUEST");
    }
  }

  const lotIds = included.flatMap((balance) => balance.lotId ? [balance.lotId] : []);
  const lots = lotIds.length ? await tx.stockLot.findMany({
    where: { orgId: ctx.orgId, id: { in: lotIds } },
    select: { id: true, warehouseId: true, genericItemId: true },
  }) : [];
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  for (const balance of included) {
    if (!balance.lotId) continue;
    const lot = lotById.get(balance.lotId);
    if (!lot) throw new StockError("LOT_NOT_FOUND");
    if (lot.warehouseId !== balance.warehouseId || lot.genericItemId !== balance.genericItemId) {
      throw new StockError("LOT_STOCK_KEY_MISMATCH");
    }
  }

  const count = await tx.stockCount.create({
    data: {
      orgId: ctx.orgId,
      storeId: request.storeId,
      warehouseId: request.warehouseId,
      countedOn: stockCountedOnDate(request.countedOn),
      snapshotAt,
      clientKey: request.clientKey,
      requestHash,
      note: request.note,
      createdById: ctx.userId,
      createdByName: ctx.userName,
      lines: {
        create: included.map((balance) => ({
          orgId: ctx.orgId,
          genericItemId: balance.genericItemId,
          lotId: balance.lotId,
          expectedQty: balance.quantity,
          unitCostHundredths: genericById.get(balance.genericItemId)!.avgCostHundredths,
        })),
      },
    },
    select: { id: true },
  });
  return { id: count.id, replayed: false };
}

/** Το ίδιο client key/payload επιστρέφει το ίδιο draft, ακόμη και μετά από concurrent create. */
export async function createStockCount(ctx: StockContext, input: StockCountInput): Promise<StockCountResult> {
  const request = canonicalStockCountRequest(input);
  const requestHash = stockCountRequestHash(ctx.orgId, request);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await stockTransaction((tx) => createInTransaction(tx, ctx, request, requestHash));
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const replay = await existingCount(db, ctx.orgId, request.clientKey, requestHash);
      if (replay) return replay;
      if (attempt === 2) throw error;
    }
  }
  throw new Error("unreachable");
}

async function lockDraft(
  tx: Prisma.TransactionClient,
  ctx: StockContext,
  countId: string,
): Promise<CountHeader> {
  const initial = await scopedCount(tx, ctx, countId);
  await assertStockScope(tx, ctx, { storeId: initial.storeId ?? undefined, warehouseId: initial.warehouseId });
  // Κλειδώνει έναντι του finalize, ώστε καμία μέτρηση/γραμμή δεν γράφεται ενώ οριστικοποιείται.
  await lockStockWarehouses(tx, ctx.orgId, [initial.warehouseId], true);
  const count = await scopedCount(tx, ctx, countId);
  if (count.status !== "DRAFT") throw new StockCountError("COUNT_ALREADY_FINALIZED");
  return count;
}

export type StockCountMeasurementOptions = { clientKey: string; expectedUpdatedAt: Date };
export type StockCountMeasurementResult = { replayed: boolean; updatedAt: Date };

export async function updateStockCountMeasurements(
  ctx: StockContext,
  countId: string,
  measurements: readonly ({ lineId: string } & StockCountMeasurementInput)[],
  options?: StockCountMeasurementOptions,
): Promise<StockCountMeasurementResult> {
  if (!measurements.length || measurements.length > 1000) throw new StockCountError("INVALID_COUNT_REQUEST");
  const seen = new Set<string>();
  const parsed = measurements.map((measurement) => {
    const lineId = entityId(measurement.lineId);
    if (seen.has(lineId)) throw new StockCountError("INVALID_COUNT_REQUEST");
    seen.add(lineId);
    return { lineId, ...canonicalStockCountMeasurement(measurement) };
  });
  const clientKey = options ? entityId(options.clientKey) : null;
  if (options && !Number.isFinite(options.expectedUpdatedAt.getTime())) throw new StockCountError("INVALID_COUNT_REQUEST");
  const requestHash = stockCountMeasurementsHash(ctx.orgId, countId, parsed);

  return stockTransaction(async (tx) => {
    // Το replay ελέγχεται πριν από το status lock, ώστε ένα ήδη εφαρμοσμένο edit να μείνει επιτυχές.
    const initial = await scopedCount(tx, ctx, countId);
    await assertStockScope(tx, ctx, { storeId: initial.storeId ?? undefined, warehouseId: initial.warehouseId });
    if (clientKey) {
      const existing = await tx.stockCountEdit.findUnique({
        where: { orgId_countId_clientKey: { orgId: ctx.orgId, countId: initial.id, clientKey } },
        select: { requestHash: true },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new StockCountError("IDEMPOTENCY_KEY_REUSED");
        return { replayed: true, updatedAt: initial.updatedAt };
      }
    }

    const count = await lockDraft(tx, ctx, countId);
    if (options && count.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) {
      throw new StockCountError("COUNT_REVISION_CONFLICT");
    }
    const lines = await tx.stockCountLine.findMany({
      where: { orgId: ctx.orgId, countId: count.id, id: { in: parsed.map((measurement) => measurement.lineId) } },
      select: { id: true, expectedQty: true },
    });
    if (lines.length !== parsed.length) throw new StockCountError("INVALID_COUNT_LINE");
    const expectedById = new Map(lines.map((line) => [line.id, line.expectedQty]));
    for (const measurement of parsed) {
      const differenceQty = stockCountDifference(expectedById.get(measurement.lineId)!, measurement.actualQty);
      const result = await tx.stockCountLine.updateMany({
        where: { id: measurement.lineId, orgId: ctx.orgId, countId: count.id, count: { status: "DRAFT" } },
        data: { actualQty: measurement.actualQty, differenceQty, reason: measurement.reason },
      });
      if (result.count !== 1) throw new StockCountError("COUNT_ALREADY_FINALIZED");
    }
    const updatedAt = await nextStockCountRevision(tx, count.updatedAt);
    const touched = await tx.stockCount.updateMany({
      where: { id: count.id, orgId: ctx.orgId, status: "DRAFT" },
      data: { updatedAt },
    });
    if (touched.count !== 1) throw new StockCountError("COUNT_ALREADY_FINALIZED");
    if (clientKey) await tx.stockCountEdit.create({ data: { orgId: ctx.orgId, countId: count.id, clientKey, requestHash } });
    return { replayed: false, updatedAt };
  });
}

async function countGeneric(tx: Prisma.TransactionClient, orgId: string, genericItemId: string) {
  const generic = await tx.genericItem.findFirst({
    where: { id: entityId(genericItemId), orgId, trackStock: true },
    select: { id: true, avgCostHundredths: true, baseUnit: { select: { toBase: true } } },
  });
  if (!generic) throw new StockError("GENERIC_ITEM_NOT_FOUND");
  if (generic.baseUnit.toBase !== 1) throw new StockError("GENERIC_ITEM_BASE_UNIT_INVALID");
  if (!Number.isSafeInteger(generic.avgCostHundredths) || generic.avgCostHundredths < 0) {
    throw new StockCountError("INVALID_COUNT_REQUEST");
  }
  return generic;
}

/** Προσθέτει ρητά είδος/υπάρχουσα παρτίδα με expected μηδέν· δεν ξαναϋπολογίζει το αρχικό snapshot. */
export async function addStockCountLine(
  ctx: StockContext,
  countId: string,
  input: { genericItemId: string; lotId?: string | null },
): Promise<void> {
  try {
    await stockTransaction(async (tx) => {
      const count = await lockDraft(tx, ctx, countId);
      const generic = await countGeneric(tx, ctx.orgId, input.genericItemId);
      const lotId = input.lotId?.trim() ? entityId(input.lotId) : null;
      if (lotId) {
        const lot = await tx.stockLot.findFirst({
          where: { id: lotId, orgId: ctx.orgId },
          select: { id: true, genericItemId: true, warehouseId: true },
        });
        if (!lot) throw new StockError("LOT_NOT_FOUND");
        if (lot.genericItemId !== generic.id || lot.warehouseId !== count.warehouseId) throw new StockError("LOT_STOCK_KEY_MISMATCH");
      }
      const duplicate = await tx.stockCountLine.findFirst({
        where: { orgId: ctx.orgId, countId: count.id, genericItemId: generic.id, lotId },
        select: { id: true },
      });
      if (duplicate) throw new StockCountError("DUPLICATE_COUNT_LINE");
      await tx.stockCountLine.create({
        data: {
          orgId: ctx.orgId,
          countId: count.id,
          genericItemId: generic.id,
          lotId,
          expectedQty: 0,
          unitCostHundredths: generic.avgCostHundredths,
        },
      });
      await tx.stockCount.update({ where: { id: count.id }, data: { updatedAt: await nextStockCountRevision(tx, count.updatedAt) } });
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new StockCountError("DUPLICATE_COUNT_LINE");
    throw error;
  }
}

/** Ρητή δημιουργία φυσικής παρτίδας· το batch δίνεται από τον χρήστη και δεν παράγεται αυτόματα. */
export async function addStockCountLotLine(
  ctx: StockContext,
  countId: string,
  input: { genericItemId: string; batchNumber: string; expiresAt?: Date | null },
): Promise<void> {
  const batchNumber = input.batchNumber.trim();
  if (!batchNumber || batchNumber.length > 80) throw new StockCountError("INVALID_COUNT_REQUEST");
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()))) throw new StockCountError("INVALID_COUNT_REQUEST");
  try {
    await stockTransaction(async (tx) => {
      const count = await lockDraft(tx, ctx, countId);
      const generic = await countGeneric(tx, ctx.orgId, input.genericItemId);
      const identity = {
        orgId: ctx.orgId,
        genericItemId: generic.id,
        warehouseId: count.warehouseId,
        batchNumber,
      };
      if (await tx.stockLot.findUnique({ where: { orgId_genericItemId_warehouseId_batchNumber: identity }, select: { id: true } })) {
        throw new StockCountError("LOT_ALREADY_EXISTS");
      }
      const lot = await tx.stockLot.create({ data: { ...identity, expiresAt }, select: { id: true } });
      await tx.stockCountLine.create({
        data: {
          orgId: ctx.orgId,
          countId: count.id,
          genericItemId: generic.id,
          lotId: lot.id,
          expectedQty: 0,
          unitCostHundredths: generic.avgCostHundredths,
        },
      });
      await tx.stockCount.update({ where: { id: count.id }, data: { updatedAt: await nextStockCountRevision(tx, count.updatedAt) } });
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new StockCountError("LOT_ALREADY_EXISTS");
    throw error;
  }
}

function keyOf(key: Omit<StockKey, "orgId">): string {
  return JSON.stringify([key.warehouseId, key.genericItemId, key.lotId]);
}

async function finalizeResult(tx: CountDb, ctx: StockContext, id: string, replayed: boolean): Promise<StockCountFinalizeResult> {
  const count = await tx.stockCount.findFirst({
    where: { id, orgId: ctx.orgId, status: "FINALIZED" },
    select: { id: true, lines: { select: { id: true, movement: { select: { id: true } } } } },
  });
  if (!count) throw new StockCountError("COUNT_NOT_FOUND");
  return {
    id: count.id,
    replayed,
    lineCount: count.lines.length,
    correctionCount: count.lines.filter((line) => line.movement).length,
  };
}

async function finalizeInTransaction(tx: Prisma.TransactionClient, ctx: StockContext, countId: string): Promise<StockCountFinalizeResult> {
  const initial = await scopedCount(tx, ctx, countId);
  await assertStockScope(tx, ctx, { storeId: initial.storeId ?? undefined, warehouseId: initial.warehouseId });
  await lockStockWarehouses(tx, ctx.orgId, [initial.warehouseId], true);
  const count = await scopedCount(tx, ctx, countId);
  if (count.status === "FINALIZED") return finalizeResult(tx, ctx, count.id, true);
  await assertStockScope(tx, ctx, { storeId: count.storeId ?? undefined, warehouseId: count.warehouseId, forWrite: true });

  const finalized = await tx.stockCount.findFirst({
    where: {
      orgId: ctx.orgId,
      warehouseId: count.warehouseId,
      countedOn: count.countedOn,
      status: "FINALIZED",
      NOT: { id: count.id },
    },
    select: { id: true },
  });
  if (finalized) throw new StockCountError("FINALIZED_COUNT_EXISTS");
  await assertNoMovementAfterSnapshot(tx, { orgId: ctx.orgId, warehouseId: count.warehouseId, snapshotAt: count.snapshotAt });

  const lines = await tx.stockCountLine.findMany({
    where: { orgId: ctx.orgId, countId: count.id },
    orderBy: [{ genericItemId: "asc" }, { lotId: "asc" }],
  });
  if (!lines.length) throw new StockCountError("EMPTY_COUNT");
  const prepared = lines.map((line) => ({ line, ...assertFinalizableStockCountLine(line) }));
  const balances = await stockBalances(tx, {
    orgId: ctx.orgId,
    warehouseIds: [count.warehouseId],
    genericItemIds: lines.map((line) => line.genericItemId),
    storeId: count.storeId ?? undefined,
  });
  const currentByKey = new Map(balances.map((balance) => [keyOf(balance), balance.quantity]));
  for (const { line } of prepared) {
    const current = currentByKey.get(keyOf({
      warehouseId: count.warehouseId,
      genericItemId: line.genericItemId,
      lotId: line.lotId,
    })) ?? 0;
    // Αμυντικός έλεγχος επιπλέον του global snapshot check· ποτέ rebase πάνω σε νέο απόθεμα.
    if (current !== line.expectedQty) throw new StockError("STOCK_CHANGED_SINCE_SNAPSHOT");
  }

  const finalizedAt = await databaseNow(tx);
  for (const { line, differenceQty, reason } of prepared) {
    if (differenceQty === 0) continue;
    await postStockMovement(tx, {
      orgId: ctx.orgId,
      warehouseId: count.warehouseId,
      genericItemId: line.genericItemId,
      lotId: line.lotId,
      storeId: count.storeId,
      quantity: differenceQty,
      source: "count",
      countId: count.id,
      countLineId: line.id,
      note: reason,
      occurredAt: finalizedAt,
      actor: { id: ctx.userId, name: ctx.userName },
    });
  }
  const updated = await tx.stockCount.updateMany({
    where: { id: count.id, orgId: ctx.orgId, status: "DRAFT" },
    data: {
      status: "FINALIZED",
      finalizedById: ctx.userId,
      finalizedByName: ctx.userName,
      finalizedAt,
    },
  });
  if (updated.count !== 1) throw new StockCountError("COUNT_ALREADY_FINALIZED");
  const correctionCount = prepared.filter((line) => line.differenceQty !== 0).length;
  await writeAudit(tx, {
    orgId: ctx.orgId,
    actor: { id: ctx.userId, name: ctx.userName },
    action: "stock.count.finalized",
    entityType: "stock_count",
    entityId: count.id,
    warehouseId: count.warehouseId,
    metadata: {
      countedOn: count.countedOn.toISOString().slice(0, 10),
      lineCount: lines.length,
      correctionCount,
    },
  });
  return { id: count.id, replayed: false, lineCount: lines.length, correctionCount };
}

/** Το finalize δέχεται μόνο count ID· το replay μετά από επιτυχία επιστρέφει το αποθηκευμένο αποτέλεσμα. */
export async function finalizeStockCount(ctx: StockContext, countId: string): Promise<StockCountFinalizeResult> {
  try {
    return await stockTransaction((tx) => finalizeInTransaction(tx, ctx, countId));
  } catch (error) {
    const unique = isUniqueConflict(error);
    const staleSnapshot = error instanceof StockError && error.code === "STOCK_CHANGED_SINCE_SNAPSHOT";
    const alreadyFinalized = error instanceof StockCountError && error.code === "COUNT_ALREADY_FINALIZED";
    if (!unique && !staleSnapshot && !alreadyFinalized) throw error;

    // Μετά το rollback η committed κατάσταση διαχωρίζει replay ίδιου count από γνήσιο stale draft.
    const committed = await db.stockCount.findFirst({
      where: { id: entityId(countId), orgId: ctx.orgId, status: "FINALIZED" },
      select: { id: true, storeId: true, warehouseId: true },
    });
    if (committed) {
      await assertStockScope(db, ctx, { storeId: committed.storeId ?? undefined, warehouseId: committed.warehouseId });
      return finalizeResult(db, ctx, committed.id, true);
    }
    if (unique) throw new StockCountError("FINALIZED_COUNT_EXISTS");
    throw error;
  }
}
