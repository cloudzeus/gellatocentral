import assert from "node:assert/strict";
import { test } from "node:test";
import { attachWarehouse, detachWarehouse, resolveWarehouseId, setDefaultWarehouse, WarehouseError, type WarehouseDb } from "./warehouses.ts";

// Υποκατάστατη «βάση» στη μνήμη: υλοποιεί μόνο ό,τι ακουμπά το lib/warehouses.
function fakeDb() {
  const stores = new Map<string, { id: string; orgId: string; active: boolean }>();
  const warehouses = new Map<string, { id: string; orgId: string; active: boolean }>();
  const devices = new Map<string, { id: string; orgId: string; storeId: string; defaultWarehouseId: string | null }>();
  const links = new Map<string, { storeId: string; warehouseId: string; isDefault: boolean; priority: number }>();
  const movements: { warehouseId: string; quantity: number }[] = [];
  const key = (storeId: string, warehouseId: string) => `${storeId}:${warehouseId}`;
  const match = (row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]): boolean => {
      if (k === "warehouse" || k === "store") return match(row, undefined) || true; // στα fake τα φίλτρα σχέσεων τα καλύπτουν τα maps
      if (v && typeof v === "object") return match(row[k] as Record<string, unknown>, v as Record<string, unknown>);
      return row[k] === v;
    });

  const db = {
    store: {
      findFirst: async ({ where }: { where?: Record<string, unknown> }) => [...stores.values()].find((s) => match(s as never, where)) ?? null,
    },
    warehouse: {
      findFirst: async ({ where }: { where?: Record<string, unknown> }) => [...warehouses.values()].find((w) => match(w as never, where)) ?? null,
    },
    device: {
      findFirst: async ({ where }: { where?: Record<string, unknown> }) => [...devices.values()].find((d) => match(d as never, where)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { defaultWarehouseId: string | null } }) => {
        for (const [k, d] of devices) if (match(d as never, where)) devices.set(k, { ...d, defaultWarehouseId: data.defaultWarehouseId });
      },
    },
    storeWarehouse: {
      findUnique: async ({ where }: { where: { storeId_warehouseId: { storeId: string; warehouseId: string } } }) => links.get(key(where.storeId_warehouseId.storeId, where.storeId_warehouseId.warehouseId)) ?? null,
      findFirst: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: { [k: string]: string }[] }) => {
        const rows = [...links.values()].filter((l) => {
          if (where?.storeId && l.storeId !== where.storeId) return false;
          if (where?.isDefault !== undefined && l.isDefault !== where.isDefault) return false;
          const w = warehouses.get(l.warehouseId);
          const s = stores.get(l.storeId);
          if (where?.warehouse && (!w || w.active !== true)) return false;
          if (where?.store && (!s || s.active !== true)) return false;
          return true;
        });
        if (orderBy) rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.priority - b.priority);
        return rows[0] ?? null;
      },
      create: async ({ data }: { data: { storeId: string; warehouseId: string; isDefault: boolean; priority: number } }) => {
        const row = { ...data };
        links.set(key(data.storeId, data.warehouseId), row);
        return row;
      },
      update: async ({ where, data }: { where: { storeId_warehouseId: { storeId: string; warehouseId: string } }; data: Partial<{ isDefault: boolean }> }) => {
        const k = key(where.storeId_warehouseId.storeId, where.storeId_warehouseId.warehouseId);
        links.set(k, { ...links.get(k)!, ...data });
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { isDefault: boolean } }) => {
        for (const [k, l] of links) if (l.storeId === where.storeId) links.set(k, { ...l, isDefault: data.isDefault });
      },
      delete: async ({ where }: { where: { storeId_warehouseId: { storeId: string; warehouseId: string } } }) => {
        links.delete(key(where.storeId_warehouseId.storeId, where.storeId_warehouseId.warehouseId));
      },
    },
    stockMovement: {
      aggregate: async ({ where }: { where: { warehouseId: string } }) => ({ _sum: { quantity: movements.filter((m) => m.warehouseId === where.warehouseId).reduce((a, m) => a + m.quantity, 0) } }),
      create: async ({ data }: { data: { warehouseId: string; quantity: number } }) => {
        movements.push(data);
        return data;
      },
    },
  } as unknown as WarehouseDb;

  return { db, stores, warehouses, devices, links, movements };
}

const seed = () => {
  const f = fakeDb();
  f.stores.set("st1", { id: "st1", orgId: "org1", active: true });
  f.stores.set("st2", { id: "st2", orgId: "org1", active: true });
  f.warehouses.set("wh1", { id: "wh1", orgId: "org1", active: true });
  f.warehouses.set("wh2", { id: "wh2", orgId: "org1", active: true });
  return f;
};
const code = (e: unknown) => (e instanceof WarehouseError ? e.code : String(e));

test("ρητή αποθήκη: υπερισχύει, αλλά μόνο αν επιτρέπεται στο κατάστημα", async () => {
  const { db } = seed();
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh1" });
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st1", requestedWarehouseId: "wh1" }), "wh1");
  // η wh2 δεν είναι δεμένη στο st1
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st1", requestedWarehouseId: "wh2" }).catch(code), "WAREHOUSE_NOT_ALLOWED_FOR_STORE");
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st1", requestedWarehouseId: "wh9" }).catch(code), "WAREHOUSE_NOT_FOUND");
});

test("προεπιλογή ταμείου, μετά προεπιλογή καταστήματος, μετά priority, μετά σφάλμα", async () => {
  const { db, devices } = seed();
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh1" }); // πρώτη → προεπιλογή
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh2", priority: 5 });
  // χωρίς ταμείο: η προεπιλογή (wh1) κερδίζει το μικρότερο priority
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st1" }), "wh1");
  // το ταμείο με δική του προεπιλογή υπερισχύει
  devices.set("dev1", { id: "dev1", orgId: "org1", storeId: "st1", defaultWarehouseId: "wh2" });
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st1", deviceId: "dev1" }), "wh2");
  // ταμείο άλλου καταστήματος
  devices.set("dev2", { id: "dev2", orgId: "org1", storeId: "st2", defaultWarehouseId: null });
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st1", deviceId: "dev2" }).catch(code), "DEVICE_STORE_MISMATCH");
  // χωρίς καμία σύνδεση: σφάλμα
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st2" }).catch(code), "DEFAULT_WAREHOUSE_REQUIRED");
});

test("fallback σε priority όταν δεν υπάρχει προεπιλογή", async () => {
  const { db } = seed();
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh1", priority: 20 });
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh2", priority: 5 });
  // κατεβάζουμε χειροκίνητα την προεπιλογή για να μετρήσουμε μόνο το priority
  const { links } = seed();
  void links;
  const f = fakeDb();
  f.stores.set("s", { id: "s", orgId: "o", active: true });
  f.warehouses.set("a", { id: "a", orgId: "o", active: true });
  f.warehouses.set("b", { id: "b", orgId: "o", active: true });
  f.links.set("s:a", { storeId: "s", warehouseId: "a", isDefault: false, priority: 20 });
  f.links.set("s:b", { storeId: "s", warehouseId: "b", isDefault: false, priority: 5 });
  assert.equal(await resolveWarehouseId(f.db, { orgId: "o", storeId: "s" }), "b");
});

test("μία μόνο προεπιλογή ανά κατάστημα· η πρώτη σύνδεση γίνεται αυτόματα προεπιλογή", async () => {
  const { db, links } = seed();
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh1" });
  assert.equal(links.get("st1:wh1")!.isDefault, true);
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh2" });
  assert.equal(links.get("st1:wh2")!.isDefault, false);
  await setDefaultWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh2" });
  assert.equal(links.get("st1:wh1")!.isDefault, false);
  assert.equal(links.get("st1:wh2")!.isDefault, true);
  // setDefault σε μη δεμένη αποθήκη
  assert.equal(await setDefaultWarehouse(db, { orgId: "org1", storeId: "st2", warehouseId: "wh1" }).catch(code), "WAREHOUSE_NOT_ALLOWED_FOR_STORE");
});

test("αποσύνδεση: προάγεται η επόμενη ως προεπιλογή και καθαρίζουν οι προεπιλογές ταμείων", async () => {
  const { db, links, devices } = seed();
  devices.set("dev1", { id: "dev1", orgId: "org1", storeId: "st1", defaultWarehouseId: "wh1" });
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh1" });
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh2", priority: 7 });
  await detachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh1" });
  assert.equal(links.get("st1:wh2")!.isDefault, true);
  assert.equal(devices.get("dev1")!.defaultWarehouseId, null);
});

test("ανενεργά: απορρίπτονται σε σύνδεση και επίλυση", async () => {
  const { db, stores, warehouses } = seed();
  warehouses.get("wh1")!.active = false;
  assert.equal(await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh1" }).catch(code), "WAREHOUSE_INACTIVE");
  warehouses.get("wh1")!.active = true;
  stores.get("st1")!.active = false;
  assert.equal(await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh1" }).catch(code), "STORE_INACTIVE");
  await attachWarehouse(db, { orgId: "org1", storeId: "st2", warehouseId: "wh1" });
  warehouses.get("wh1")!.active = false;
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st2" }).catch(code), "DEFAULT_WAREHOUSE_REQUIRED"); // ανενεργή δεν προσφέρεται ως fallback
});

test("κεντρική αποθήκη σε πολλά καταστήματα", async () => {
  const { db } = seed();
  await attachWarehouse(db, { orgId: "org1", storeId: "st1", warehouseId: "wh1" });
  await attachWarehouse(db, { orgId: "org1", storeId: "st2", warehouseId: "wh1" });
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st1" }), "wh1");
  assert.equal(await resolveWarehouseId(db, { orgId: "org1", storeId: "st2" }), "wh1");
});
