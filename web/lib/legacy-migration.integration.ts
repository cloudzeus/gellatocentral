import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { rollbackLegacyMigration, runLegacyMigration } from "./legacy-migration-db.ts";
import type { StockContext } from "./stock-scope.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL, timeout: 120_000 };

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `Migration ${suffix}`, vatNumber: `TEST-${suffix}` } });
  const user = await db.user.create({ data: { email: `migration-${suffix}@example.test`, name: "Migration test" } });
  const store = await db.store.create({ data: { orgId: org.id, name: "Κατάστημα migration" } });
  const warehouse = await db.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη migration" } });
  await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: warehouse.id, isDefault: true } });
  return { orgId: org.id, userId: user.id, storeId: store.id, warehouseId: warehouse.id, userName: user.name };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture): StockContext {
  return { orgId: f.orgId, membershipId: "migration-integration", userId: f.userId, userName: f.userName, permissions: ["migration.read", "migration.add"], storeIds: [], warehouseIds: [], can: (permission) => permission.startsWith("migration.") };
}
function bundle(f: Fixture) {
  return {
    version: 1, source: "integration-legacy",
    parties: [{ externalId: "customer:1", name: "Πελάτης legacy", roles: ["customer"], countryCode: "GR" }],
    items: [{ externalId: "item:1", name: "Παγωτό legacy", baseUnitCode: "mg", avgCostHundredths: 500 }],
    stockLots: [{ externalId: "lot:1", itemExternalId: "item:1", warehouseId: f.warehouseId, batchNumber: "LEGACY-L1", quantityBase: 2_000_000, unitCostHundredths: 500, occurredAt: "2026-11-01T10:00:00.000Z" }],
    documents: [{ externalId: "doc:1", customerExternalId: "customer:1", storeId: f.storeId, warehouseId: f.warehouseId, docType: "1.1", series: "OLD", aa: 42, issuedAt: "2026-11-01T10:00:00.000Z", dueAt: "2026-12-01T10:00:00.000Z", paidCents: 500, netCents: 2000, vatCents: 480, totalCents: 2480, lines: [{ itemExternalId: "item:1", quantityBase: 2_000_000, unitPriceCents: 1000, vatRate: 24, costHundredths: 100000 }] }],
  };
}
async function cleanup(fixtures: readonly Fixture[]) {
  const orgIds = fixtures.map((f) => f.orgId);
  await db.stockMovement.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.customerPayment.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.salesDocument.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: { in: fixtures.map((f) => f.userId) } } });
}

test("PostgreSQL MIG-02..06: dry-run, idempotent import, reconciliation, tenant isolation και selective rollback", databaseOptions, async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    const source = bundle(f);
    const dry = await runLegacyMigration(context(f), source, "dry-run");
    assert.equal(dry.run.status, "DRY_RUN");
    assert.equal(dry.summary.results.every((row) => row.status === "CREATED"), true);
    assert.equal(await db.party.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 0);

    const imported = await runLegacyMigration(context(f), source, "import");
    assert.equal(imported.run.status, "IMPORTED");
    assert.deepEqual(imported.summary.differences, []);
    assert.deepEqual(imported.summary.expected.money, { netCents: 2000, vatCents: 480, totalCents: 2480, outstandingCents: 1980 });
    assert.deepEqual(imported.summary.actual.stock, [{ key: `item:1:${f.warehouseId}`, quantityBase: 2_000_000, costCents: 10 }]);
    assert.equal(await db.fiscalDocument.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.salesDocument.count({ where: { orgId: f.orgId, series: "OLD", aa: 42 } }), 1);

    const repeated = await runLegacyMigration(context(f), source, "import");
    assert.equal(repeated.summary.results.every((row) => row.status === "SKIPPED"), true);
    assert.equal(await db.party.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 1);

    const changed = structuredClone(source);
    changed.parties[0]!.name = "Πελάτης legacy ενημερωμένος";
    const updated = await runLegacyMigration(context(f), changed, "import");
    assert.equal(updated.summary.results.find((row) => row.entityType === "party")?.status, "UPDATED");
    assert.equal(updated.summary.results.filter((row) => row.status === "SKIPPED").length, 3);

    await assert.rejects(rollbackLegacyMigration(context(other), imported.run.id, "ξένος tenant"), /δεν βρέθηκε/);
    const rolledBack = await rollbackLegacyMigration(context(f), imported.run.id, "Έλεγχος επιστροφής isolated fixture");
    assert.equal(rolledBack.protectedUpdated, 1);
    assert.equal(await db.party.count({ where: { orgId: f.orgId, name: "Πελάτης legacy ενημερωμένος" } }), 1);
    assert.equal(await db.genericItem.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.stockLot.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.salesDocument.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.customerPayment.count({ where: { orgId: f.orgId } }), 0);
    assert.equal(await db.migrationRun.findUnique({ where: { id: imported.run.id } }).then((run) => run?.status), "ROLLED_BACK");

    const otherImport = await runLegacyMigration(context(other), bundle(other), "import");
    assert.equal(otherImport.summary.differences.length, 0);
    assert.equal(await db.party.count({ where: { orgId: other.orgId } }), 1);
    assert.equal(await db.salesDocument.count({ where: { orgId: other.orgId } }), 1);
  } finally {
    await cleanup([f, other]);
  }
});
