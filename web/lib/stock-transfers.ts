// Άμεση οριστική μεταφορά: header, γραμμές, δύο κινήσεις ανά γραμμή και audit σε ένα Serializable transaction.
import type { Prisma } from "./generated/prisma/client.ts";
import { writeAudit } from "./audit.ts";
import { db } from "./db.ts";
import {
  lockStockKey,
  lockStockWarehouses,
  postStockMovement,
  stockBalances,
  StockError,
  type StockKey,
} from "./stock-db.ts";
import { assertStockScope, type StockContext } from "./stock-scope.ts";
import { stockTransaction } from "./stock-transaction.ts";
import {
  canonicalStockTransferRequest,
  stockTransferRequestHash,
  StockTransferError,
  type CanonicalStockTransferRequest,
  type StockTransferInput,
} from "./stock-transfer-request.ts";

type TransferDb = Pick<Prisma.TransactionClient, "stockTransfer" | "stockMovement">;

export type StockTransferResult = {
  id: string;
  replayed: boolean;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  lines: {
    id: string;
    genericItemId: string;
    sourceLotId: string | null;
    destinationLotId: string | null;
    quantity: number;
    unitCostHundredths: number;
    sourceBalance: number;
    destinationBalance: number;
  }[];
};

function sameExpiry(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function keyOf(key: Omit<StockKey, "orgId">): string {
  return JSON.stringify([key.warehouseId, key.genericItemId, key.lotId]);
}

async function existingTransfer(
  tx: TransferDb,
  orgId: string,
  clientKey: string,
  requestHash: string,
): Promise<{ id: string; replayed: true } | null> {
  const existing = await tx.stockTransfer.findUnique({
    where: { orgId_clientKey: { orgId, clientKey } },
    select: { id: true, requestHash: true },
  });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new StockTransferError("IDEMPOTENCY_KEY_REUSED");
  return { id: existing.id, replayed: true };
}

async function transferResult(tx: TransferDb, orgId: string, id: string, replayed: boolean): Promise<StockTransferResult> {
  const transfer = await tx.stockTransfer.findFirst({
    where: { id, orgId },
    include: { lines: { orderBy: [{ genericItemId: "asc" }, { sourceLotId: "asc" }] } },
  });
  if (!transfer) throw new StockTransferError("INVALID_TRANSFER_REQUEST");
  const balances = await stockBalances(tx, {
    orgId,
    warehouseIds: [transfer.sourceWarehouseId, transfer.destinationWarehouseId],
    genericItemIds: transfer.lines.map((line) => line.genericItemId),
  });
  const byKey = new Map(balances.map((balance) => [keyOf(balance), balance.quantity]));
  return {
    id: transfer.id,
    replayed,
    sourceWarehouseId: transfer.sourceWarehouseId,
    destinationWarehouseId: transfer.destinationWarehouseId,
    lines: transfer.lines.map((line) => ({
      id: line.id,
      genericItemId: line.genericItemId,
      sourceLotId: line.sourceLotId,
      destinationLotId: line.destinationLotId,
      quantity: line.quantity,
      unitCostHundredths: line.unitCostHundredths,
      sourceBalance: byKey.get(keyOf({
        warehouseId: transfer.sourceWarehouseId,
        genericItemId: line.genericItemId,
        lotId: line.sourceLotId,
      })) ?? 0,
      destinationBalance: byKey.get(keyOf({
        warehouseId: transfer.destinationWarehouseId,
        genericItemId: line.genericItemId,
        lotId: line.destinationLotId,
      })) ?? 0,
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

async function postInTransaction(
  tx: Prisma.TransactionClient,
  ctx: StockContext,
  request: CanonicalStockTransferRequest,
  requestHash: string,
): Promise<StockTransferResult> {
  const warehouseIds = [request.sourceWarehouseId, request.destinationWarehouseId];
  await assertStockScope(tx, ctx, {
    storeId: request.storeId ?? undefined,
    warehouseIds,
    forWrite: true,
  });
  await lockStockWarehouses(tx, ctx.orgId, warehouseIds);

  const replay = await existingTransfer(tx, ctx.orgId, request.clientKey, requestHash);
  if (replay) return transferResult(tx, ctx.orgId, replay.id, true);

  const generics = await tx.genericItem.findMany({
    where: { orgId: ctx.orgId, id: { in: request.lines.map((line) => line.genericItemId) } },
    select: { id: true, avgCostHundredths: true, trackStock: true, baseUnit: { select: { toBase: true } } },
  });
  const genericById = new Map(generics.map((generic) => [generic.id, generic]));
  const sourceLotIds = request.lines.flatMap((line) => line.sourceLotId ? [line.sourceLotId] : []);
  const sourceLots = sourceLotIds.length ? await tx.stockLot.findMany({
    where: { orgId: ctx.orgId, id: { in: sourceLotIds } },
    select: { id: true, genericItemId: true, warehouseId: true, batchNumber: true, expiresAt: true },
  }) : [];
  const sourceLotById = new Map(sourceLots.map((lot) => [lot.id, lot]));

  const transfer = await tx.stockTransfer.create({
    data: {
      orgId: ctx.orgId,
      sourceWarehouseId: request.sourceWarehouseId,
      destinationWarehouseId: request.destinationWarehouseId,
      storeId: request.storeId,
      clientKey: request.clientKey,
      requestHash,
      note: request.note,
      createdById: ctx.userId,
      createdByName: ctx.userName,
    },
    select: { id: true },
  });

  const prepared: {
    lineId: string;
    genericItemId: string;
    sourceLotId: string | null;
    destinationLotId: string | null;
    quantity: number;
  }[] = [];
  for (const line of request.lines) {
    const generic = genericById.get(line.genericItemId);
    if (!generic) throw new StockError("GENERIC_ITEM_NOT_FOUND");
    if (!generic.trackStock) throw new StockError("GENERIC_ITEM_NOT_TRACKED");
    if (generic.baseUnit.toBase !== 1) throw new StockError("GENERIC_ITEM_BASE_UNIT_INVALID");
    if (!Number.isSafeInteger(generic.avgCostHundredths) || generic.avgCostHundredths < 0) {
      throw new StockTransferError("INVALID_TRANSFER_REQUEST");
    }

    const sourceLot = line.sourceLotId ? sourceLotById.get(line.sourceLotId) : null;
    if (line.sourceLotId && !sourceLot) throw new StockError("LOT_NOT_FOUND");
    if (sourceLot && (sourceLot.genericItemId !== line.genericItemId || sourceLot.warehouseId !== request.sourceWarehouseId)) {
      throw new StockError("LOT_STOCK_KEY_MISMATCH");
    }

    let destinationLotId: string | null = null;
    if (sourceLot) {
      const identity = {
        orgId: ctx.orgId,
        genericItemId: line.genericItemId,
        warehouseId: request.destinationWarehouseId,
        batchNumber: sourceLot.batchNumber,
      };
      // Το update είναι επίτηδες κενό: ούτε λήξη ούτε αρχικό documentId αντικαθίστανται από μεταφορά.
      const destinationLot = sourceLot.batchNumber === null
        ? (await tx.stockLot.findFirst({ where: identity })) ?? await tx.stockLot.create({
          data: { ...identity, expiresAt: sourceLot.expiresAt },
        })
        : await tx.stockLot.upsert({
          where: {
            orgId_genericItemId_warehouseId_batchNumber: {
              ...identity,
              batchNumber: sourceLot.batchNumber,
            },
          },
          update: {},
          create: { ...identity, expiresAt: sourceLot.expiresAt },
        });
      if (!sameExpiry(destinationLot.expiresAt, sourceLot.expiresAt)) {
        throw new StockTransferError("DESTINATION_LOT_EXPIRY_MISMATCH");
      }
      destinationLotId = destinationLot.id;
    }

    const transferLine = await tx.stockTransferLine.create({
      data: {
        orgId: ctx.orgId,
        transferId: transfer.id,
        genericItemId: line.genericItemId,
        sourceLotId: line.sourceLotId,
        destinationLotId,
        quantity: line.quantity,
        unitCostHundredths: generic.avgCostHundredths,
      },
      select: { id: true },
    });
    prepared.push({
      lineId: transferLine.id,
      genericItemId: line.genericItemId,
      sourceLotId: line.sourceLotId,
      destinationLotId,
      quantity: line.quantity,
    });
  }

  // Όλα τα γνωστά source/destination keys κλειδώνουν με κοινή λεξικογραφική σειρά πριν από οποιαδήποτε κίνηση.
  const keys: StockKey[] = prepared.flatMap((line) => [
    { orgId: ctx.orgId, warehouseId: request.sourceWarehouseId, genericItemId: line.genericItemId, lotId: line.sourceLotId },
    { orgId: ctx.orgId, warehouseId: request.destinationWarehouseId, genericItemId: line.genericItemId, lotId: line.destinationLotId },
  ]).sort((a, b) => keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0);
  for (const key of keys) await lockStockKey(tx, key);

  for (const line of prepared) {
    const common = {
      orgId: ctx.orgId,
      genericItemId: line.genericItemId,
      storeId: request.storeId,
      transferId: transfer.id,
      transferLineId: line.lineId,
      source: "transfer",
      note: request.note,
      actor: { id: ctx.userId, name: ctx.userName },
    };
    await postStockMovement(tx, {
      ...common,
      warehouseId: request.sourceWarehouseId,
      lotId: line.sourceLotId,
      quantity: -line.quantity,
    });
    await postStockMovement(tx, {
      ...common,
      warehouseId: request.destinationWarehouseId,
      lotId: line.destinationLotId,
      quantity: line.quantity,
    });
  }

  await writeAudit(tx, {
    orgId: ctx.orgId,
    actor: { id: ctx.userId, name: ctx.userName },
    action: "stock.transfer.posted",
    entityType: "stock_transfer",
    entityId: transfer.id,
    storeId: request.storeId,
    warehouseId: request.sourceWarehouseId,
    reason: request.note,
    metadata: {
      lineCount: prepared.length,
      sourceWarehouseId: request.sourceWarehouseId,
      destinationWarehouseId: request.destinationWarehouseId,
    },
  });
  return transferResult(tx, ctx.orgId, transfer.id, false);
}

/** Το unique conflict ξαναδιαβάζει το αποθηκευμένο hash· ποτέ δεν ξαναγράφει πάνω σε υπάρχον transfer. */
export async function postStockTransfer(ctx: StockContext, input: StockTransferInput): Promise<StockTransferResult> {
  const request = canonicalStockTransferRequest(input);
  const requestHash = stockTransferRequestHash(ctx.orgId, request);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await stockTransaction((tx) => postInTransaction(tx, ctx, request, requestHash));
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const replay = await existingTransfer(db, ctx.orgId, request.clientKey, requestHash);
      if (replay) return transferResult(db, ctx.orgId, replay.id, true);
      if (attempt === 2) throw error;
      // Π.χ. ταυτόχρονη δημιουργία destination lot χωρίς batch: ξαναϋπολογίζεται ΟΛΟ το transaction.
    }
  }
  throw new Error("unreachable");
}
