import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { test, type TestContext } from "node:test";

// Ο υπάρχοντας Node runner χρειάζεται επεκτάσεις στα imports της εφαρμογής· ο Next/Turbopack τις συμπληρώνει μόνος του.
type ResolveHooks = { registerHooks(hooks: { resolve(specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown): unknown }): void };
(nodeModule as unknown as ResolveHooks).registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND" || /\.[a-z]+$/i.test(specifier)) throw error;
      return nextResolve(`${specifier}.${specifier.startsWith(".") ? "ts" : "js"}`, context);
    }
  },
});
const { canAccessFile } = await import("./index.ts");
const { db } = await import("../db.ts");

type User = Parameters<typeof canAccessFile>[0];

function userWith(orgId: string, rolePermissions: string[] = [], groupPermissions: string[] = []): User {
  return {
    id: "user1",
    platformRole: null,
    staffRole: null,
    staffGroups: [],
    memberships: [{
      orgId,
      role: { locked: false, permissions: rolePermissions },
      groups: groupPermissions.length ? [{ group: { permissions: groupPermissions } }] : [],
      stores: [],
    }],
  } as unknown as User;
}

function replaceMethod(t: TestContext, object: object, key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { value, configurable: true, writable: true });
  t.after(() => previous ? Object.defineProperty(object, key, previous) : Reflect.deleteProperty(object, key));
}

function mockAccess(t: TestContext, modules: string[], suspended = false) {
  const plan = { id: "plan1", name: "Test", modules, pausedModules: [], storeCents: 0, devicePrices: {}, pausePercent: 100, pauseMaxDaysPerYear: 0 };
  replaceMethod(t, db.subscription, "findUnique", async () => ({ plan }));
  replaceMethod(t, db.store, "findMany", async () => []);
  replaceMethod(t, db.organization, "findUnique", async () => suspended ? { suspendedAt: new Date(), suspendedReason: null, closingAt: null, deleteAfter: null, subscription: null } : null);
}

test("saas-access: αρκεί δικαίωμα που προέρχεται μόνο από ομάδα", async (t) => {
  mockAccess(t, ["customers"]);
  const user = userWith("org-group", [], ["parties.edit"]);
  assert.equal(await canAccessFile(user, "org-group", "customer_document"), true);
});

test("saas-access: κλειστό module ακυρώνει δικαίωμα ρόλου και ομάδας", async (t) => {
  mockAccess(t, ["receipts"]);
  const byRole = userWith("org-closed", ["parties.edit"]);
  const byGroup = userWith("org-closed", [], ["parties.edit"]);
  assert.equal(await canAccessFile(byRole, "org-closed", "customer_document"), false);
  assert.equal(await canAccessFile(byGroup, "org-closed", "customer_document"), false);
});

test("saas-access: suspended tenant δεν ανοίγει το module customers", async (t) => {
  mockAccess(t, ["customers"], true);
  const user = userWith("org-suspended", ["parties.edit"]);
  assert.equal(await canAccessFile(user, "org-suspended", "customer_document"), false);
});

test("saas-access: ξένο tenant ID δεν κληρονομεί δικαιώματα από το membership", async () => {
  const user = userWith("org-own", ["parties.edit"]);
  assert.equal(await canAccessFile(user, "org-foreign", "customer_document"), false);
});

test("saas-access: PDF προσφοράς απαιτεί wholesale.read στον ίδιο tenant και ανοιχτό module", async (t) => {
  mockAccess(t, ["wholesale"]);
  assert.equal(await canAccessFile(userWith("org-own", ["wholesale.read"]), "org-own", "generated_wholesale_quote", false), true);
  assert.equal(await canAccessFile(userWith("org-own", ["parties.read"]), "org-own", "generated_wholesale_quote", false), false);
  assert.equal(await canAccessFile(userWith("org-own", ["wholesale.read"]), "org-foreign", "generated_wholesale_quote", false), false);
});
