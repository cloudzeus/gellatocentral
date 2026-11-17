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

import { applyPlatformOverrides, parsePlatformOverrides, platformCan as can2 } from "./permissions.ts";
test("δικαιώματα ρόλων προσωπικού: αλλαγές από τις ρυθμίσεις", () => {
  const o = parsePlatformOverrides('{"SUPPORT":["orgs.view","άκυρο"],"SUPER_ADMIN":[],"ΑΛΛΟ":["orgs.view"]}');
  assert.deepEqual(o, { SUPPORT: ["orgs.view"] });
  assert.deepEqual(parsePlatformOverrides("χαλασμένο"), {});
  applyPlatformOverrides(o);
  assert.equal(can2("SUPPORT", "support.tickets"), false);
  assert.equal(can2("SUPPORT", "orgs.view"), true);
  assert.equal(can2("SUPER_ADMIN", "staff.manage"), true); // ο Super Admin δεν κλειδώνεται ποτέ έξω
  assert.equal(can2("STAFF", "setup.manage"), true); // ρόλος χωρίς αλλαγή κρατά τα αρχικά
  applyPlatformOverrides({});
  assert.equal(can2("SUPPORT", "support.tickets"), true);
});

import { staffPermissions, staffRoleLabel } from "./permissions.ts";
test("δικός σας ρόλος προσωπικού υπερισχύει του σταθερού, εκτός από τον Super Admin", () => {
  const acc = { platformRole: "STAFF" as const, staffRole: { name: "Λογιστήριο", permissions: ["orgs.view", "billing.manage", "άκυρο"] } };
  assert.deepEqual(staffPermissions(acc), ["orgs.view", "billing.manage"]);
  assert.equal(can2(acc, "setup.manage"), false); // δεν κληρονομεί τα δικαιώματα του STAFF
  assert.equal(staffRoleLabel(acc), "Λογιστήριο");
  assert.equal(can2({ platformRole: "SUPER_ADMIN", staffRole: { name: "x", permissions: [] } }, "staff.manage"), true);
  assert.equal(can2({ platformRole: null, staffRole: { name: "x", permissions: ["orgs.view"] } }, "orgs.view"), false); // όχι προσωπικό = τίποτα
});
