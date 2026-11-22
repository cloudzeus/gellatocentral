// Μοναδική πηγή αποθέματος: aggregation των append-only StockMovement στο πλήρες stock key.
// Κάθε stock-aware εγγραφή παίρνει shared warehouse lock και exclusive key lock πριν διαβάσει υπόλοιπο.
import type { Prisma, StockMovement } from "./generated/prisma/client.ts";
import { assertStockScope, warehouseScopeWhere, type StockContext, type StockScopeDb } from "./stock-scope.ts";

export const STOCK_ERROR = [
  "INVALID_STOCK_QUANTITY",
  "INVALID_STOCK_INPUT",
  "WAREHOUSE_NOT_FOUND",
  "WAREHOUSE_INACTIVE",
  "GENERIC_ITEM_NOT_FOUND",
  "GENERIC_ITEM_NOT_TRACKED",
  "GENERIC_ITEM_BASE_UNIT_INVALID",
  "LOT_NOT_FOUND",
  "LOT_STOCK_KEY_MISMATCH",
  "NEGATIVE_STOCK_NOT_ALLOWED",
  "STOCK_CHANGED_SINCE_SNAPSHOT",
] as const;
export type StockErrorCode = (typeof STOCK_ERROR)[number];

export class StockError extends Error {
  readonly code: StockErrorCode;
  constructor(code: StockErrorCode) {
    super(code);
    this.name = "StockError";
    this.code = code;
  }
}

export const STOCK_ERROR_MESSAGE: Record<StockErrorCode, string> = {
  INVALID_STOCK_QUANTITY: "Η ποσότητα αποθέματος είναι μη μηδενικός ακέραιος στη βασική μονάδα",
  INVALID_STOCK_INPUT: "Η κίνηση αποθέματος έχει ελλιπή στοιχεία",
  WAREHOUSE_NOT_FOUND: "Η αποθήκη δεν βρέθηκε",
  WAREHOUSE_INACTIVE: "Η αποθήκη είναι ανενεργή",
  GENERIC_ITEM_NOT_FOUND: "Το είδος αποθέματος δεν βρέθηκε",
  GENERIC_ITEM_NOT_TRACKED: "Το είδος δεν παρακολουθεί απόθεμα",
  GENERIC_ITEM_BASE_UNIT_INVALID: "Το είδος δεν έχει έγκυρη βασική μονάδα αποθέματος",
  LOT_NOT_FOUND: "Η παρτίδα δεν βρέθηκε",
  LOT_STOCK_KEY_MISMATCH: "Η παρτίδα δεν αντιστοιχεί στο είδος και την αποθήκη",
  NEGATIVE_STOCK_NOT_ALLOWED: "Η κίνηση θα έκανε το απόθεμα του είδους ή της παρτίδας αρνητικό",
  STOCK_CHANGED_SINCE_SNAPSHOT: "Το απόθεμα άλλαξε μετά το snapshot της απογραφής",
};

export type StockKey = {
  orgId: string;
  warehouseId: string;
  genericItemId: string;
  lotId: string | null;
};

export type StockBalance = StockKey & { quantity: number };
export type StockBalanceInput = {
  orgId: string;
  warehouseIds?: readonly string[]; // undefined = όλα του tenant· [] = κανένα
  genericItemIds?: readonly string[];
  storeId?: string; // φιλτράρει επιλέξιμες αποθήκες, όχι μόνο κινήσεις με storeId
};

export type StockDb = Pick<Prisma.TransactionClient, "$queryRaw" | "warehouse" | "genericItem" | "stockLot" | "stockMovement">;
export type ScopedStockDb = StockDb & StockScopeDb;

function assertQuantity(quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity === 0 || quantity < -2_147_483_648 || quantity > 2_147_483_647) {
    throw new StockError("INVALID_STOCK_QUANTITY");
  }
}

/** Υπόλοιπο μόνο για το συγκεκριμένο (org, warehouse, generic, lot)· null lot δεν συγχωνεύεται με παρτίδα. */
export async function stockBalance(tx: Pick<StockDb, "stockMovement">, key: StockKey): Promise<number> {
  const result = await tx.stockMovement.aggregate({
    where: { orgId: key.orgId, warehouseId: key.warehouseId, genericItemId: key.genericItemId, lotId: key.lotId },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/** Org-wide απόθεμα είδους, για τον υπάρχοντα υπολογισμό μέσου σταθμισμένου κόστους. */
export async function genericStockBalance(tx: Pick<StockDb, "stockMovement">, orgId: string, genericItemId: string): Promise<number> {
  const result = await tx.stockMovement.aggregate({ where: { orgId, genericItemId }, _sum: { quantity: true } });
  return result._sum.quantity ?? 0;
}

export async function stockBalances(tx: Pick<StockDb, "stockMovement">, input: StockBalanceInput): Promise<StockBalance[]> {
  if (input.warehouseIds?.length === 0 || input.genericItemIds?.length === 0) return [];
  const rows = await tx.stockMovement.groupBy({
    by: ["warehouseId", "genericItemId", "lotId"],
    where: {
      orgId: input.orgId,
      genericItemId: input.genericItemIds ? { in: [...input.genericItemIds] } : { not: null },
      ...(input.warehouseIds ? { warehouseId: { in: [...input.warehouseIds] } } : {}),
      ...(input.storeId ? { warehouse: { orgId: input.orgId, stores: { some: { storeId: input.storeId } } } } : {}),
    },
    _sum: { quantity: true },
    orderBy: [{ warehouseId: "asc" }, { genericItemId: "asc" }, { lotId: "asc" }],
  });
  return rows.flatMap((row) => row.genericItemId
    ? [{ orgId: input.orgId, warehouseId: row.warehouseId, genericItemId: row.genericItemId, lotId: row.lotId, quantity: row._sum.quantity ?? 0 }]
    : []);
}

/** Επιβάλλει φρέσκο membership/store scope και μετά συγκεντρώνει μόνο τις επιτρεπτές αποθήκες. */
export async function scopedStockBalances(
  tx: ScopedStockDb,
  ctx: StockContext,
  input: Omit<StockBalanceInput, "orgId"> = {},
): Promise<StockBalance[]> {
  await assertStockScope(tx, ctx, { storeId: input.storeId, warehouseIds: input.warehouseIds });
  const filters: Prisma.WarehouseWhereInput[] = [warehouseScopeWhere(ctx)];
  if (input.warehouseIds) filters.push({ id: { in: [...input.warehouseIds] } });
  if (input.storeId) filters.push({ stores: { some: { storeId: input.storeId } } });
  const warehouses = await tx.warehouse.findMany({ where: { AND: filters }, select: { id: true } });
  return stockBalances(tx, {
    orgId: ctx.orgId,
    warehouseIds: warehouses.map((warehouse) => warehouse.id),
    genericItemIds: input.genericItemIds,
  });
}

/** Υπόλοιπα παρτίδων με τα master data τους· το άθροισμα γίνεται στη βάση. */
export async function lotBalances(tx: Pick<StockDb, "stockMovement" | "stockLot">, input: StockBalanceInput) {
  const balances = (await stockBalances(tx, input)).filter((row): row is StockBalance & { lotId: string } => row.lotId !== null);
  if (!balances.length) return [];
  const lots = await tx.stockLot.findMany({
    where: { orgId: input.orgId, id: { in: balances.map((row) => row.lotId) } },
    include: { genericItem: { include: { baseUnit: true } } },
  });
  const byId = new Map(lots.map((lot) => [lot.id, lot]));
  return balances.flatMap((balance) => {
    const lot = byId.get(balance.lotId);
    return lot ? [{ ...balance, lot }] : [];
  });
}

async function lockAdvisory(tx: Pick<StockDb, "$queryRaw">, key: string, shared: boolean) {
  // Το εξωτερικό SELECT επιστρέφει Int· η Prisma δεν μπορεί να deserialize την void τιμή της lock function.
  if (shared) await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))) AS lock`;
  else await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS lock`;
}

/** Κοινό lock protocol και για μελλοντικά transfers/counts· τα IDs ταξινομούνται για αποφυγή deadlock. */
export async function lockStockWarehouses(tx: Pick<StockDb, "$queryRaw">, orgId: string, warehouseIds: readonly string[], exclusive = false) {
  const ids = [...new Set(warehouseIds)].sort();
  for (const warehouseId of ids) await lockAdvisory(tx, JSON.stringify(["stock-warehouse", orgId, warehouseId]), !exclusive);
}

export async function lockStockKey(tx: Pick<StockDb, "$queryRaw">, key: StockKey) {
  await lockAdvisory(tx, JSON.stringify(["stock-key", key.orgId, key.warehouseId, key.genericItemId, key.lotId]), false);
}

export type StockActor = { id: string | null; name: string };
export type PostStockMovementInput = StockKey & {
  quantity: number;
  source: string;
  storeId?: string | null;
  documentId?: string | null;
  lineId?: string | null;
  transferId?: string | null;
  transferLineId?: string | null;
  countId?: string | null;
  countLineId?: string | null;
  note?: string | null;
  occurredAt?: Date;
  actor: StockActor;
};

async function assertActiveWarehouse(tx: StockDb, orgId: string, warehouseId: string) {
  const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, orgId }, select: { id: true, active: true } });
  if (!warehouse) throw new StockError("WAREHOUSE_NOT_FOUND");
  if (!warehouse.active) throw new StockError("WAREHOUSE_INACTIVE");
}

/** Κοινός writer για αγορά, παραγωγή, correction και τις επόμενες transfer/count ροές. */
export async function postStockMovement(tx: StockDb, input: PostStockMovementInput): Promise<StockMovement> {
  assertQuantity(input.quantity);
  if (!input.source.trim() || !input.actor.name.trim()) throw new StockError("INVALID_STOCK_INPUT");
  await assertActiveWarehouse(tx, input.orgId, input.warehouseId);
  const generic = await tx.genericItem.findFirst({
    where: { id: input.genericItemId, orgId: input.orgId },
    select: { id: true, trackStock: true, baseUnit: { select: { toBase: true } } },
  });
  if (!generic) throw new StockError("GENERIC_ITEM_NOT_FOUND");
  if (!generic.trackStock) throw new StockError("GENERIC_ITEM_NOT_TRACKED");
  if (generic.baseUnit.toBase !== 1) throw new StockError("GENERIC_ITEM_BASE_UNIT_INVALID");
  if (input.lotId) {
    const lot = await tx.stockLot.findFirst({
      where: { id: input.lotId, orgId: input.orgId },
      select: { id: true, warehouseId: true, genericItemId: true },
    });
    if (!lot) throw new StockError("LOT_NOT_FOUND");
    if (lot.warehouseId !== input.warehouseId || lot.genericItemId !== input.genericItemId) throw new StockError("LOT_STOCK_KEY_MISMATCH");
  }

  const key: StockKey = { orgId: input.orgId, warehouseId: input.warehouseId, genericItemId: input.genericItemId, lotId: input.lotId };
  await lockStockWarehouses(tx, input.orgId, [input.warehouseId]);
  await lockStockKey(tx, key);
  if (input.quantity < 0 && (await stockBalance(tx, key)) + input.quantity < 0) throw new StockError("NEGATIVE_STOCK_NOT_ALLOWED");

  // Το recordedAt συμπληρώνεται με CURRENT_TIMESTAMP από τη βάση· δεν δέχεται ώρα client.
  return tx.stockMovement.create({
    data: {
      orgId: input.orgId,
      warehouseId: input.warehouseId,
      genericItemId: input.genericItemId,
      lotId: input.lotId,
      quantity: input.quantity,
      source: input.source,
      storeId: input.storeId ?? null,
      documentId: input.documentId ?? null,
      lineId: input.lineId ?? null,
      transferId: input.transferId ?? null,
      transferLineId: input.transferLineId ?? null,
      countId: input.countId ?? null,
      countLineId: input.countLineId ?? null,
      note: input.note ?? null,
      occurredAt: input.occurredAt,
      createdById: input.actor.id,
      createdByName: input.actor.name,
    },
  });
}

/** Προσωρινό κανάλι μόνο για legacy sale χωρίς generic· δεν αποδίδει ποσότητα σε stock key. */
export async function postLegacyStockMovement(
  tx: StockDb,
  input: Omit<PostStockMovementInput, "genericItemId" | "lotId" | "actor"> & { genericItemId?: null; lotId?: null; actor?: StockActor },
): Promise<StockMovement> {
  assertQuantity(input.quantity);
  if (!input.source.trim()) throw new StockError("INVALID_STOCK_INPUT");
  await assertActiveWarehouse(tx, input.orgId, input.warehouseId);
  await lockStockWarehouses(tx, input.orgId, [input.warehouseId]);
  return tx.stockMovement.create({
    data: {
      orgId: input.orgId,
      warehouseId: input.warehouseId,
      genericItemId: null,
      lotId: null,
      quantity: input.quantity,
      source: input.source,
      storeId: input.storeId ?? null,
      documentId: input.documentId ?? null,
      lineId: input.lineId ?? null,
      note: input.note ?? null,
      occurredAt: input.occurredAt,
      createdById: input.actor?.id ?? null,
      createdByName: input.actor?.name ?? null,
    },
  });
}

export async function assertNoMovementAfterSnapshot(tx: Pick<StockDb, "stockMovement">, input: { orgId: string; warehouseId: string; snapshotAt: Date }) {
  const changed = await tx.stockMovement.findFirst({
    where: { orgId: input.orgId, warehouseId: input.warehouseId, recordedAt: { gt: input.snapshotAt } },
    select: { id: true },
  });
  if (changed) throw new StockError("STOCK_CHANGED_SINCE_SNAPSHOT");
}
