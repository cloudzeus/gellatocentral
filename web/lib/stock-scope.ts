// Καθαρό tenant/store/warehouse scope, χωρίς Next runtime. Δέχεται db ή transaction client.
import type { Prisma } from "./generated/prisma/client";
import type { Permission } from "./permissions";

export const STOCK_SCOPE_ERROR = [
  "STORE_NOT_FOUND",
  "STORE_INACTIVE",
  "WAREHOUSE_NOT_FOUND",
  "WAREHOUSE_INACTIVE",
  "WAREHOUSE_NOT_ALLOWED_FOR_STORE",
] as const;
export type StockScopeErrorCode = (typeof STOCK_SCOPE_ERROR)[number];

export const STOCK_SCOPE_ERROR_MESSAGE: Record<StockScopeErrorCode, string> = {
  STORE_NOT_FOUND: "Το κατάστημα δεν βρέθηκε ή δεν έχεις πρόσβαση",
  STORE_INACTIVE: "Το κατάστημα είναι ανενεργό",
  WAREHOUSE_NOT_FOUND: "Η αποθήκη δεν βρέθηκε ή δεν έχεις πρόσβαση",
  WAREHOUSE_INACTIVE: "Η αποθήκη είναι ανενεργή",
  WAREHOUSE_NOT_ALLOWED_FOR_STORE: "Η αποθήκη δεν εξυπηρετεί αυτό το κατάστημα",
};

export class StockScopeError extends Error {
  readonly code: StockScopeErrorCode;
  constructor(code: StockScopeErrorCode) {
    super(code);
    this.name = "StockScopeError";
    this.code = code;
  }
}

export type StockContext = {
  orgId: string;
  membershipId: string;
  userId: string;
  userName: string;
  permissions: readonly Permission[];
  storeIds: readonly string[]; // [] = όλα τα stores
  warehouseIds: readonly string[]; // [] = όλα εντός store scope, ρητές γραμμές = μόνο αυτές
  can: (permission: Permission) => boolean;
};

export type StockScopeInput = {
  storeId?: string;
  warehouseId?: string;
  warehouseIds?: readonly string[];
  forWrite?: boolean;
};

export type StockScopeDb = Pick<Prisma.TransactionClient, "store" | "warehouse" | "storeWarehouse" | "membershipStore" | "membershipWarehouse">;

/** Φίλτρο λίστας αποθηκών. Ρητό warehouse scope επιτρέπει και standalone εργαστήριο εκτός store links. */
export function warehouseScopeWhere(ctx: Pick<StockContext, "orgId" | "storeIds" | "warehouseIds">): Prisma.WarehouseWhereInput {
  if (ctx.warehouseIds.length) return { orgId: ctx.orgId, id: { in: [...ctx.warehouseIds] } };
  if (ctx.storeIds.length) return { orgId: ctx.orgId, stores: { some: { storeId: { in: [...ctx.storeIds] } } } };
  return { orgId: ctx.orgId };
}

async function assertStore(tx: StockScopeDb, ctx: StockContext, storeId: string, forWrite: boolean) {
  const store = await tx.store.findFirst({ where: { id: storeId, orgId: ctx.orgId }, select: { id: true, active: true } });
  if (!store) throw new StockScopeError("STORE_NOT_FOUND");
  if (forWrite && !store.active) throw new StockScopeError("STORE_INACTIVE");
  if (ctx.storeIds.length) {
    const membership = await tx.membershipStore.findUnique({
      where: { membershipId_storeId: { membershipId: ctx.membershipId, storeId } },
      select: { storeId: true },
    });
    if (!membership) throw new StockScopeError("STORE_NOT_FOUND");
  }
}

async function assertWarehouse(tx: StockScopeDb, ctx: StockContext, warehouseId: string, storeId: string | undefined, forWrite: boolean) {
  const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, orgId: ctx.orgId }, select: { id: true, active: true } });
  if (!warehouse) throw new StockScopeError("WAREHOUSE_NOT_FOUND");
  if (forWrite && !warehouse.active) throw new StockScopeError("WAREHOUSE_INACTIVE");

  if (ctx.warehouseIds.length) {
    const membership = await tx.membershipWarehouse.findFirst({
      where: { orgId: ctx.orgId, membershipId: ctx.membershipId, warehouseId },
      select: { warehouseId: true },
    });
    if (!membership) throw new StockScopeError("WAREHOUSE_NOT_FOUND");
  } else if (ctx.storeIds.length && !storeId) {
    // Store-restricted χρήστης δεν βλέπει standalone αποθήκη μόνο επειδή το warehouse scope είναι κενό.
    const linked = await tx.storeWarehouse.findFirst({
      where: { warehouseId, store: { orgId: ctx.orgId, membershipStores: { some: { membershipId: ctx.membershipId } } } },
      select: { warehouseId: true },
    });
    if (!linked) throw new StockScopeError("WAREHOUSE_NOT_FOUND");
  }

  if (storeId) {
    const link = await tx.storeWarehouse.findUnique({
      where: { storeId_warehouseId: { storeId, warehouseId } },
      select: { warehouseId: true },
    });
    if (!link) throw new StockScopeError("WAREHOUSE_NOT_ALLOWED_FOR_STORE");
  }
}

/** Επανέλεγχος με φρέσκα δεδομένα· καλείται και με transaction client πριν από εγγραφή. */
export async function assertStockScope(tx: StockScopeDb, ctx: StockContext, input: StockScopeInput = {}) {
  const forWrite = input.forWrite ?? false;
  if (input.storeId) await assertStore(tx, ctx, input.storeId, forWrite);
  const warehouseIds = [...new Set([...(input.warehouseIds ?? []), ...(input.warehouseId ? [input.warehouseId] : [])])];
  for (const warehouseId of warehouseIds) await assertWarehouse(tx, ctx, warehouseId, input.storeId, forWrite);
}
