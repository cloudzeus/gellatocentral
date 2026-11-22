// Server wrapper: authentication/RBAC/package από currentOrg και μετά φρέσκος scoped έλεγχος στη βάση.
import { currentOrg } from "./auth";
import { db } from "./db";
import type { Permission } from "./permissions";
import { assertStockScope, type StockContext, type StockScopeInput } from "./stock-scope";

export * from "./stock-scope";

export async function requireStockContext(permission: Permission, input: StockScopeInput = {}): Promise<StockContext> {
  const current = await currentOrg(permission);
  const ctx: StockContext = {
    orgId: current.org.id,
    membershipId: current.membership.id,
    userId: current.user.id,
    userName: current.user.name,
    permissions: current.permissions,
    storeIds: current.storeIds,
    warehouseIds: current.warehouseIds,
    can: current.can,
  };
  await assertStockScope(db, ctx, input);
  return ctx;
}
