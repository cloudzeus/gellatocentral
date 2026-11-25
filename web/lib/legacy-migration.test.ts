import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson, expectedMigrationReconciliation, migrationPayloadHash, parseMigrationBundle, reconciliationDifferences, rollbackCreatedIds } from "./legacy-migration.ts";

const units = [{ code: "mg", dimension: "mass", toBase: 1 }];
const bundle = {
  version: 1,
  source: "legacy-test",
  parties: [{ externalId: "customer:1", name: "Πελάτης", roles: ["customer"] }],
  items: [{ externalId: "item:1", name: "Παγωτό", baseUnitCode: "mg", avgCostHundredths: 0 }],
  stockLots: [{ externalId: "lot:1", itemExternalId: "item:1", warehouseId: "warehouse-1", batchNumber: "L1", quantityBase: 2_000_000, unitCostHundredths: 500, occurredAt: "2026-11-01T10:00:00.000Z" }],
  documents: [{ externalId: "doc:1", customerExternalId: "customer:1", storeId: "store-1", warehouseId: "warehouse-1", docType: "1.1", series: "OLD", aa: 42, issuedAt: "2026-11-01T10:00:00.000Z", dueAt: "2026-12-01T10:00:00.000Z", paidCents: 500, netCents: 2000, vatCents: 480, totalCents: 2480, lines: [{ itemExternalId: "item:1", quantityBase: 2_000_000, unitPriceCents: 1000, vatRate: 24, costHundredths: 100000 }] }],
};

test("legacy migration: canonical JSON αγνοεί undefined και ταξινομεί keys", () => {
  assert.equal(canonicalJson({ b: 1, a: 2, omitted: undefined }), '{"a":2,"b":1}');
  assert.equal(migrationPayloadHash("party", "p1", { b: 1, a: 2 }), migrationPayloadHash("party", "p1", { a: 2, b: 1 }));
  assert.notEqual(migrationPayloadHash("party", "p1", { a: 2 }), migrationPayloadHash("item", "p1", { a: 2 }));
});

test("legacy migration: hand-computed totals, stock cost και outstanding", () => {
  const parsed = parseMigrationBundle(bundle, units);
  const result = expectedMigrationReconciliation(parsed, units);
  assert.deepEqual(result.counts, { party: 1, item: 1, stock_lot: 1, sales_document: 1 });
  assert.deepEqual(result.money, { netCents: 2000, vatCents: 480, totalCents: 2480, outstandingCents: 1980 });
  assert.deepEqual(result.stock, [{ key: "item:1:warehouse-1", quantityBase: 2_000_000, costCents: 10 }]);
  assert.deepEqual(reconciliationDifferences(result, structuredClone(result)), []);
});

test("legacy migration: απορρίπτει ασυμφωνία ποσών πριν από εγγραφή", () => {
  const invalid = structuredClone(bundle);
  invalid.documents[0]!.totalCents = 9999;
  assert.throws(() => parseMigrationBundle(invalid, units), /ασυμφωνία συνόλων/);
});

test("legacy migration: απορρίπτει διπλά external IDs και dangling references", () => {
  const duplicated = structuredClone(bundle);
  duplicated.items.push(duplicated.items[0]!);
  assert.throws(() => parseMigrationBundle(duplicated), /διπλά external IDs/);
  const dangling = structuredClone(bundle);
  dangling.stockLots[0]!.itemExternalId = "missing";
  assert.throws(() => parseMigrationBundle(dangling), /άγνωστο itemExternalId/);
});

test("legacy migration: απορρίπτει υπερβολική είσπραξη και unknown fields", () => {
  const paid = structuredClone(bundle);
  paid.documents[0]!.paidCents = 3000;
  assert.throws(() => parseMigrationBundle(paid), /υπερβαίνει/);
  assert.throws(() => parseMigrationBundle({ ...bundle, passwordHash: "not-allowed" }), /Μη έγκυρο legacy export/);
});

test("legacy migration: rollback επιλέγει μόνο CREATED του ίδιου run", () => {
  const records = [
    { runId: "run-1", status: "CREATED", localId: "created" },
    { runId: "run-1", status: "UPDATED", localId: "updated" },
    { runId: "run-2", status: "CREATED", localId: "other-run" },
    { runId: "run-1", status: "CREATED", localId: null },
  ];
  assert.deepEqual(rollbackCreatedIds(records, "run-1"), ["created"]);
});
