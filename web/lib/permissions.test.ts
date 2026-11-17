import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_PERMISSIONS, canGrant, permissionFor, PLATFORM_ROLES, platformCan, SYSTEM_ROLES } from "./permissions.ts";

test("δικαίωμα ανά σελίδα", () => {
  assert.equal(permissionFor("/pos"), "pos.use");
  assert.equal(permissionFor("/receipts/abc"), "receipts.view");
  assert.equal(permissionFor("/"), "dashboard.view");
  assert.equal(permissionFor("/recipes"), "dashboard.view");
  assert.equal(permissionFor("/posters"), "dashboard.view"); // όχι «ξεκινά με /pos»
});

test("ρόλοι συστήματος", () => {
  assert.deepEqual(SYSTEM_ROLES[0].permissions, ALL_PERMISSIONS);
  assert.ok(!SYSTEM_ROLES[1].permissions.includes("users.manage"));
  assert.deepEqual(SYSTEM_ROLES[2].permissions, ["pos.use", "receipts.view"]);
});

test("δεν δίνεις ό,τι δεν έχεις", () => {
  assert.equal(canGrant(["pos.use", "users.manage"], ["pos.use"]), true);
  assert.equal(canGrant(["pos.use", "users.manage"], ["pos.use", "billing.view"]), false);
  assert.equal(canGrant([], []), true);
});

test("ρόλοι πλατφόρμας", () => {
  assert.equal(platformCan("SUPER_ADMIN", "staff.manage"), true);
  assert.equal(platformCan("MANAGER", "billing.manage"), true);
  assert.equal(platformCan("MANAGER", "settings.manage"), false);
  assert.equal(platformCan("STAFF", "billing.manage"), false);
  assert.equal(platformCan("SUPPORT", "setup.manage"), false);
  assert.equal(platformCan(null, "orgs.view"), false);
  for (const r of Object.values(PLATFORM_ROLES)) assert.ok(r.permissions.includes("orgs.view"));
});
