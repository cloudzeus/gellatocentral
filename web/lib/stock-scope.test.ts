import assert from "node:assert/strict";
import { test } from "node:test";
import { assertStockScope, StockScopeError, warehouseScopeWhere, type StockContext, type StockScopeDb } from "./stock-scope.ts";

type State = {
  stores: { id: string; orgId: string; active: boolean }[];
  warehouses: { id: string; orgId: string; active: boolean }[];
  membershipStores: { membershipId: string; storeId: string }[];
  membershipWarehouses: { orgId: string; membershipId: string; warehouseId: string }[];
  links: { storeId: string; warehouseId: string }[];
};

const baseState = (): State => ({
  stores: [{ id: "s1", orgId: "org-a", active: true }, { id: "s2", orgId: "org-a", active: true }, { id: "sx", orgId: "org-b", active: true }],
  warehouses: [
    { id: "w1", orgId: "org-a", active: true },
    { id: "w2", orgId: "org-a", active: true },
    { id: "w3", orgId: "org-a", active: true },
    { id: "wi", orgId: "org-a", active: false },
    { id: "wx", orgId: "org-b", active: true },
  ],
  membershipStores: [{ membershipId: "m1", storeId: "s1" }],
  membershipWarehouses: [],
  links: [{ storeId: "s1", warehouseId: "w1" }, { storeId: "s2", warehouseId: "w2" }],
});

function fakeDb(state: State): StockScopeDb {
  return {
    store: {
      findFirst: async (args: { where: { id: string; orgId: string } }) => state.stores.find((s) => s.id === args.where.id && s.orgId === args.where.orgId) ?? null,
    },
    warehouse: {
      findFirst: async (args: { where: { id: string; orgId: string } }) => state.warehouses.find((w) => w.id === args.where.id && w.orgId === args.where.orgId) ?? null,
    },
    membershipStore: {
      findUnique: async (args: { where: { membershipId_storeId: { membershipId: string; storeId: string } } }) => {
        const key = args.where.membershipId_storeId;
        return state.membershipStores.find((m) => m.membershipId === key.membershipId && m.storeId === key.storeId) ?? null;
      },
    },
    membershipWarehouse: {
      findFirst: async (args: { where: { orgId: string; membershipId: string; warehouseId: string } }) => {
        const w = args.where;
        return state.membershipWarehouses.find((m) => m.orgId === w.orgId && m.membershipId === w.membershipId && m.warehouseId === w.warehouseId) ?? null;
      },
    },
    storeWarehouse: {
      findUnique: async (args: { where: { storeId_warehouseId: { storeId: string; warehouseId: string } } }) => {
        const key = args.where.storeId_warehouseId;
        return state.links.find((l) => l.storeId === key.storeId && l.warehouseId === key.warehouseId) ?? null;
      },
      findFirst: async (args: { where: { warehouseId: string; store: { orgId: string; membershipStores: { some: { membershipId: string } } } } }) => {
        const w = args.where;
        return state.links.find((l) => l.warehouseId === w.warehouseId && state.stores.some((s) => s.id === l.storeId && s.orgId === w.store.orgId) && state.membershipStores.some((m) => m.membershipId === w.store.membershipStores.some.membershipId && m.storeId === l.storeId)) ?? null;
      },
    },
  } as unknown as StockScopeDb;
}

const context = (override: Partial<StockContext> = {}): StockContext => ({
  orgId: "org-a",
  membershipId: "m1",
  userId: "u1",
  userName: "Χρήστης",
  permissions: [],
  storeIds: [],
  warehouseIds: [],
  can: () => true,
  ...override,
});

async function expectCode(promise: Promise<unknown>, code: StockScopeError["code"]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof StockScopeError);
    assert.equal(error.code, code);
    return true;
  });
}

test("warehouse listing: όλα, μόνο των stores μου ή μόνο ρητά warehouses", () => {
  assert.deepEqual(warehouseScopeWhere(context()), { orgId: "org-a" });
  assert.deepEqual(warehouseScopeWhere(context({ storeIds: ["s1"] })), { orgId: "org-a", stores: { some: { storeId: { in: ["s1"] } } } });
  assert.deepEqual(warehouseScopeWhere(context({ storeIds: ["s1"], warehouseIds: ["w3"] })), { orgId: "org-a", id: { in: ["w3"] } });
});

test("χρήστης όλων των stores με κενό warehouse scope βλέπει standalone αποθήκη", async () => {
  await assertStockScope(fakeDb(baseState()), context(), { warehouseId: "w3" });
});

test("store-restricted χρήστης: συνδεδεμένη αποθήκη ναι, standalone όχι", async () => {
  const state = baseState();
  const ctx = context({ storeIds: ["s1"] });
  await assertStockScope(fakeDb(state), ctx, { warehouseId: "w1" });
  await expectCode(assertStockScope(fakeDb(state), ctx, { warehouseId: "w3" }), "WAREHOUSE_NOT_FOUND");
});

test("ρητή warehouse membership επιτρέπει standalone εργαστήριο σε store-restricted χρήστη", async () => {
  const state = baseState();
  state.membershipWarehouses.push({ orgId: "org-a", membershipId: "m1", warehouseId: "w3" });
  await assertStockScope(fakeDb(state), context({ storeIds: ["s1"], warehouseIds: ["w3"] }), { warehouseId: "w3" });
  await expectCode(assertStockScope(fakeDb(state), context({ storeIds: ["s1"], warehouseIds: ["w3"] }), { warehouseId: "w1" }), "WAREHOUSE_NOT_FOUND");
});

test("store mutation απαιτεί φρέσκο membership και StoreWarehouse link", async () => {
  const state = baseState();
  const ctx = context({ storeIds: ["s1"] });
  await assertStockScope(fakeDb(state), ctx, { storeId: "s1", warehouseId: "w1", forWrite: true });
  await expectCode(assertStockScope(fakeDb(state), ctx, { storeId: "s1", warehouseId: "w2", forWrite: true }), "WAREHOUSE_NOT_ALLOWED_FOR_STORE");
  state.membershipStores = [];
  await expectCode(assertStockScope(fakeDb(state), ctx, { storeId: "s1", warehouseId: "w1", forWrite: true }), "STORE_NOT_FOUND");
});

test("ανενεργή αποθήκη/store: read επιτρέπεται, write όχι", async () => {
  const state = baseState();
  await assertStockScope(fakeDb(state), context(), { warehouseId: "wi" });
  await expectCode(assertStockScope(fakeDb(state), context(), { warehouseId: "wi", forWrite: true }), "WAREHOUSE_INACTIVE");
  state.stores[0].active = false;
  await assertStockScope(fakeDb(state), context(), { storeId: "s1" });
  await expectCode(assertStockScope(fakeDb(state), context(), { storeId: "s1", forWrite: true }), "STORE_INACTIVE");
});

test("cross-tenant IDs και μη έγκυρη δεύτερη αποθήκη μεταφοράς απορρίπτονται", async () => {
  const state = baseState();
  await expectCode(assertStockScope(fakeDb(state), context(), { warehouseId: "wx" }), "WAREHOUSE_NOT_FOUND");
  await expectCode(assertStockScope(fakeDb(state), context({ storeIds: ["s1"] }), { warehouseIds: ["w1", "w3"] }), "WAREHOUSE_NOT_FOUND");
  await expectCode(assertStockScope(fakeDb(state), context(), { storeId: "sx" }), "STORE_NOT_FOUND");
});
