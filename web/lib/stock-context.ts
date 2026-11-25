// Server wrapper: authentication/RBAC/package από currentOrg και μετά φρέσκος scoped έλεγχος στη βάση.
import { actorNameOf, currentOrg, getUser } from "./auth";
import { db } from "./db";
import type { Permission } from "./permissions";
import { assertStockScope, type StockContext, type StockScopeInput } from "./stock-scope";

export * from "./stock-scope";

function contextFromCurrent(current: Awaited<ReturnType<typeof currentOrg>>): StockContext {
  return {
    orgId: current.org.id,
    membershipId: current.membership.id,
    userId: current.user.id,
    userName: actorNameOf(current.user),
    permissions: current.permissions,
    storeIds: current.storeIds,
    warehouseIds: current.warehouseIds,
    can: current.can,
  };
}

export async function requireStockContext(permission: Permission, input: StockScopeInput = {}): Promise<StockContext> {
  const current = await currentOrg(permission);
  const ctx = contextFromCurrent(current);
  await assertStockScope(db, ctx, input);
  return ctx;
}

/** Σε JSON routes τα auth failures μένουν 401/403, όχι HTML redirect ή γενικό 500. */
export async function stockApiContext(permission: Permission, input: StockScopeInput = {}): Promise<{ ctx: StockContext } | { error: Response }> {
  const user = await getUser();
  if (!user) return { error: Response.json({ code: "UNAUTHORIZED", message: "Χρειάζεται σύνδεση" }, { status: 401 }) };
  if (!user.memberships[0]) return { error: Response.json({ code: "FORBIDDEN", message: "Δεν υπάρχει συμμετοχή σε επιχείρηση" }, { status: 403 }) };
  const current = await currentOrg();
  if (!current.can(permission)) return { error: Response.json({ code: "FORBIDDEN", message: "Δεν έχεις δικαίωμα για αυτή την ενέργεια" }, { status: 403 }) };
  const ctx = contextFromCurrent(current);
  await assertStockScope(db, ctx, input);
  return { ctx };
}
