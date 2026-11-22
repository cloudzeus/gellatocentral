import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  applyPlatformOverrides,
  canGrant,
  expandOrg,
  expandPlatform,
  normalize,
  orgPermissionsOf,
  parsePlatformOverrides,
  permissionFor,
  permissionLabel,
  PLATFORM_ROLES,
  platformCan,
  staffPermissions,
  staffRoleLabel,
  SYSTEM_ROLES,
} from "./permissions.ts";

test("δικαίωμα ανά σελίδα", () => {
  assert.equal(permissionFor("/pos"), "pos.use");
  assert.equal(permissionFor("/receipts/abc"), "receipts.read");
  assert.equal(permissionFor("/"), "dashboard.read");
  assert.equal(permissionFor("/recipes"), "recipes.read");
  assert.equal(permissionFor("/materials"), "items.read");
  assert.equal(permissionFor("/inventory/stock"), "stock.read");
  assert.equal(permissionFor("/inventory/stock/lots/abc"), "stock.read");
  assert.equal(permissionFor("/inventory/alerts"), "stock.read");
  assert.equal(permissionFor("/inventory/transfers/abc"), "stock.read");
  assert.equal(permissionFor("/inventory/warehouses/abc"), "warehouses.read");
  assert.equal(permissionFor("/counts/abc"), "counts.read");
  assert.equal(permissionFor("/haccp/checks"), "haccp.read");
  assert.equal(permissionFor("/invoices/abc"), "invoices.read");
  assert.equal(permissionFor("/posters"), "dashboard.read"); // όχι «ξεκινά με /pos»
  assert.equal(permissionFor("/customers/abc"), "parties.read");
  assert.equal(permissionFor("/gdpr/consents"), "gdpr.read");
});

test("ρόλοι συστήματος", () => {
  assert.deepEqual(SYSTEM_ROLES[0].permissions, ALL_PERMISSIONS);
  assert.ok(SYSTEM_ROLES[0].locked);
  assert.ok(!SYSTEM_ROLES[1].permissions.includes("users.read"));
  for (const p of ["stock.read", "stock.transfer", "stock.correct", "counts.read", "counts.add", "counts.edit", "counts.finalize"]) assert.ok(SYSTEM_ROLES[1].permissions.includes(p as (typeof ALL_PERMISSIONS)[number]));
  assert.ok(!SYSTEM_ROLES[1].permissions.includes("wholesale.read"));
  assert.deepEqual(SYSTEM_ROLES[2].permissions, ["pos.use", "receipts.read"]);
});

test("κάθε δικαίωμα ορίζεται μία φορά", () => {
  assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length);
});

test("normalize: άλλη ενέργεια σε περιοχή φέρνει αυτόματα το read της", () => {
  assert.deepEqual(normalize(["devices.edit"]), ["devices.edit", "devices.read"]);
  assert.deepEqual(normalize(["receipts.reissue"]), ["receipts.reissue", "receipts.read"]);
  assert.deepEqual(normalize(["stock.transfer"]), ["stock.transfer", "stock.read"]);
  assert.deepEqual(normalize(["counts.finalize"]), ["counts.finalize", "counts.read"]);
  assert.deepEqual(normalize(["pos.use"]), ["pos.use"]); // η περιοχή δεν έχει read
  assert.deepEqual(normalize(["άκυρο", "gdpr.edit"]), ["gdpr.edit", "gdpr.read"]); // άγνωστα πετιούνται
});

test("παλιά κλειδιά («έχει/δεν έχει») ανοίγουν στα νέα", () => {
  assert.deepEqual(expandOrg(["customers.manage"]), ["parties.read", "parties.add", "parties.edit", "parties.delete"]);
  assert.deepEqual(expandOrg(["receipts.view"]), ["receipts.read", "receipts.reissue"]);
  assert.deepEqual(expandOrg(["users.manage", "pos.use"]), ["users.read", "users.add", "users.edit", "users.delete", "pos.use"]);
  assert.deepEqual(expandOrg(["χαλασμένο"]), []);
  // μίξη παλιών και νέων
  assert.deepEqual(expandOrg(["devices.manage", "billing.read"]), ["devices.read", "devices.add", "devices.edit", "devices.delete", "billing.read"]);
});

test("κλειδωμένος ρόλος έχει πάντα όλα τα δικαιώματα", () => {
  assert.deepEqual(orgPermissionsOf({ locked: true, permissions: [] }), ALL_PERMISSIONS);
  assert.deepEqual(orgPermissionsOf({ locked: false, permissions: ["pos.use"] }), ["pos.use"]);
});

test("δεν δίνεις ό,τι δεν έχεις", () => {
  assert.equal(canGrant(["pos.use", "users.edit"], ["pos.use"]), true);
  assert.equal(canGrant(["pos.use", "users.edit"], ["pos.use", "billing.read"]), false);
  assert.equal(canGrant([], []), true);
});

test("ετικέτα δικαιώματος: «περιοχή — ενέργεια», μονο-ενεργειακές σκέτες", () => {
  assert.equal(permissionLabel("devices.edit"), "Συσκευές — Επεξεργασία");
  assert.equal(permissionLabel("pos.use"), "Ταμείο");
  assert.equal(permissionLabel("άγνωστο"), "άγνωστο");
});

test("ρόλοι πλατφόρμας", () => {
  assert.equal(platformCan("SUPER_ADMIN", "staff.delete"), true);
  assert.equal(platformCan("MANAGER", "billing.edit"), true);
  assert.equal(platformCan("MANAGER", "settings.edit"), false);
  assert.equal(platformCan("STAFF", "billing.read"), false);
  assert.equal(platformCan("STAFF", "setup.edit"), true);
  assert.equal(platformCan("SUPPORT", "setup.edit"), false);
  assert.equal(platformCan("SUPER_ADMIN", "support.tenant"), true);
  assert.equal(platformCan("SUPPORT", "support.tenant"), true);
  assert.equal(platformCan("MANAGER", "support.tenant"), false);
  assert.equal(platformCan("STAFF", "support.tenant"), false);
  assert.equal(platformCan(null, "orgs.read"), false);
  for (const r of Object.values(PLATFORM_ROLES)) assert.ok(r.permissions.includes("orgs.read"));
  assert.deepEqual(PLATFORM_ROLES.SUPER_ADMIN.permissions, ALL_PLATFORM_PERMISSIONS);
});

test("δικαιώματα ρόλων προσωπικού: αλλαγές από τις ρυθμίσεις", () => {
  const o = parsePlatformOverrides('{"SUPPORT":["orgs.read","support.kb","άκυρο"],"SUPER_ADMIN":[],"ΑΛΛΟ":["orgs.read"]}');
  assert.deepEqual(o, { SUPPORT: ["orgs.read", "support.kb"] });
  assert.deepEqual(parsePlatformOverrides("χαλασμένο"), {});
  applyPlatformOverrides(o);
  assert.equal(platformCan("SUPPORT", "support.tickets"), false);
  assert.equal(platformCan("SUPPORT", "orgs.read"), true);
  assert.equal(platformCan("SUPER_ADMIN", "staff.edit"), true); // ο Super Admin δεν κλειδώνεται ποτέ έξω
  assert.equal(platformCan("STAFF", "setup.edit"), true); // ρόλος χωρίς αλλαγή κρατά τα αρχικά
  applyPlatformOverrides({});
  assert.equal(platformCan("SUPPORT", "support.tickets"), true);
});

test("δικός σας ρόλος προσωπικού αντικαθιστά τον σταθερό, εκτός από τον Super Admin", () => {
  const acc = { platformRole: "STAFF" as const, staffRole: { name: "Λογιστήριο", permissions: ["orgs.read", "billing.edit", "άκυρο"] } };
  assert.deepEqual(staffPermissions(acc), ["orgs.read", "billing.edit", "billing.read"]); // το edit φέρνει το read
  assert.equal(platformCan(acc, "setup.edit"), false); // δεν κληρονομεί τα δικαιώματα του STAFF
  assert.equal(staffRoleLabel(acc), "Λογιστήριο");
  assert.equal(platformCan({ platformRole: "SUPER_ADMIN", staffRole: { name: "x", permissions: [] } }, "staff.read"), true);
  assert.equal(platformCan({ platformRole: null, staffRole: { name: "x", permissions: ["orgs.read"] } }, "orgs.read"), false); // όχι προσωπικό = τίποτα
});

test("ομάδες προσωπικού: ένωση με τον ρόλο, ποτέ αφαίρεση", () => {
  const acc = { platformRole: "SUPPORT" as const, staffGroups: [{ permissions: ["billing.edit"] }, { permissions: ["staff.read"] }] };
  const p = staffPermissions(acc);
  assert.ok(p.includes("support.tickets")); // από τον σταθερό ρόλο
  assert.ok(p.includes("billing.edit") && p.includes("billing.read")); // από ομάδα (+ αυτόματο read)
  assert.ok(p.includes("staff.read"));
  assert.equal(staffRoleLabel(acc), "Υπάλληλος υποστήριξης"); // χωρίς δικό σας ρόλο δείχνει τον σταθερό
});

test("παλιά κλειδιά πλατφόρμας ανοίγουν στα νέα", () => {
  assert.deepEqual(expandPlatform(["orgs.view"]), ["orgs.read"]);
  assert.deepEqual(expandPlatform(["billing.manage"]), ["billing.read", "billing.edit"]);
  assert.deepEqual(expandPlatform(["users.manage"]), ["users.read", "users.add", "users.edit", "users.delete"]);
  assert.deepEqual(expandPlatform(["parties.view"]), ["parties.read"]);
});
