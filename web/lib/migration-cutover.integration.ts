import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import type { LegacyAdapterOperation, LegacyCutoverAdapter, LegacyCutoverRequest } from "./legacy-cutover-adapter.ts";
import { rollbackLegacyMigration, runLegacyMigration, type LegacyMigrationOptions } from "./legacy-migration-db.ts";
import {
  activateMigrationCutover,
  createMigrationCutover,
  freezeMigrationCutover,
  markMigrationCutoverReady,
  rollbackMigrationCutover,
} from "./migration-cutover-db.ts";
import { expectedActivationConfirmation, tenantWriteTransaction } from "./migration-cutover.ts";
import type { StockContext } from "./stock-scope.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL, timeout: 120_000 };

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `Cutover ${suffix}`, vatNumber: `TEST-${suffix}` } });
  const user = await db.user.create({ data: { email: `cutover-${suffix}@example.test`, name: "Cutover test" } });
  const store = await db.store.create({ data: { orgId: org.id, name: "Κατάστημα cutover" } });
  const warehouse = await db.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη cutover" } });
  await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: warehouse.id, isDefault: true } });
  return { suffix, orgId: org.id, userId: user.id, storeId: store.id, warehouseId: warehouse.id, userName: user.name };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function context(f: Fixture): StockContext {
  return { orgId: f.orgId, membershipId: "cutover-integration", userId: f.userId, userName: f.userName, permissions: ["migration.read", "migration.add"], storeIds: [], warehouseIds: [], can: (permission) => permission.startsWith("migration.") };
}

function bundle(f: Fixture) {
  return {
    version: 1, source: "integration-legacy",
    parties: [{ externalId: "customer:1", name: "Πελάτης baseline", roles: ["customer"], countryCode: "GR" }],
    items: [{ externalId: "item:1", name: "Παγωτό cutover", baseUnitCode: "mg", avgCostHundredths: 500 }],
    stockLots: [{ externalId: "lot:1", itemExternalId: "item:1", warehouseId: f.warehouseId, batchNumber: "CUTOVER-L1", quantityBase: 2_000_000, unitCostHundredths: 500, occurredAt: "2026-11-01T10:00:00.000Z" }],
    documents: [{ externalId: "doc:1", customerExternalId: "customer:1", storeId: f.storeId, warehouseId: f.warehouseId, docType: "1.1", series: "OLD", aa: 42, issuedAt: "2026-11-01T10:00:00.000Z", dueAt: "2026-12-01T10:00:00.000Z", paidCents: 500, netCents: 2000, vatCents: 480, totalCents: 2480, lines: [{ itemExternalId: "item:1", quantityBase: 2_000_000, unitPriceCents: 1000, vatRate: 24, costHundredths: 100000 }] }],
  };
}

function emptyBundle(): ReturnType<typeof bundle> {
  return { version: 1, source: "integration-legacy", parties: [], items: [], stockLots: [], documents: [] };
}

function options(cutoverId: string, kind: LegacyMigrationOptions["kind"], exportId: string, previousCursor: string | null, sourceCursor: string): LegacyMigrationOptions {
  return { cutoverId, kind, exportId, previousCursor, sourceCursor, exportedAt: "2026-11-25T10:00:00.000Z" };
}

function recordingAdapter() {
  const calls: { operation: LegacyAdapterOperation; request: LegacyCutoverRequest }[] = [];
  const record = (operation: LegacyAdapterOperation, request: LegacyCutoverRequest) => {
    calls.push({ operation, request: { ...request } });
    return { operation, evidenceId: `evidence-${operation}-${calls.length}`, cursor: request.cursor, observedAt: new Date().toISOString() };
  };
  const adapter: LegacyCutoverAdapter = {
    freeze: async (request) => record("FREEZE", request),
    setReadOnly: async (request) => record("READ_ONLY", request),
    resumeWrites: async (request) => record("RESUME_WRITES", request),
  };
  return { adapter, calls };
}

function writeStore(f: Fixture, name: string) {
  return tenantWriteTransaction(f.orgId, (tx) => tx.store.update({ where: { id: f.storeId }, data: { name } }));
}

async function businessCounts(orgId: string) {
  const [party, item, stockLot, salesDocument, customerPayment] = await Promise.all([
    db.party.count({ where: { orgId } }),
    db.genericItem.count({ where: { orgId } }),
    db.stockLot.count({ where: { orgId } }),
    db.salesDocument.count({ where: { orgId } }),
    db.customerPayment.count({ where: { orgId } }),
  ]);
  return { party, item, stockLot, salesDocument, customerPayment };
}

async function cleanup(fixtures: readonly Fixture[]) {
  const orgIds = fixtures.map((f) => f.orgId);
  await db.fiscalDocument.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.sale.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.device.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.stockMovement.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.customerPayment.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.salesDocument.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: { in: fixtures.map((f) => f.userId) } } });
}

test("PostgreSQL MIG-05/06: πλήρες cutover, replay, stale dry-run import, tenant isolation και activation", databaseOptions, async () => {
  const f = await fixture();
  const other = await fixture();
  const { adapter, calls } = recordingAdapter();
  try {
    const cutover = await createMigrationCutover(context(f), "integration-legacy");
    const baselineOptions = options(cutover.id, "BASELINE", "export-baseline", null, "cursor-1");
    const baseline = await runLegacyMigration(context(f), bundle(f), "import", baselineOptions);
    assert.equal(baseline.run.status, "IMPORTED");
    assert.equal(baseline.replayed, false);

    const baselineReplay = await runLegacyMigration(context(f), bundle(f), "import", baselineOptions);
    assert.equal(baselineReplay.replayed, true);
    assert.equal(baselineReplay.run.id, baseline.run.id);
    const changedBaseline = bundle(f);
    changedBaseline.parties[0]!.name = "Αλλαγμένο ίδιο export";
    await assert.rejects(runLegacyMigration(context(f), changedBaseline, "import", baselineOptions), /ίδιο export ID έχει διαφορετικό bundle hash/);

    // Μόνο τοπικά fixtures· ελέγχουν τα guards χωρίς καμία κλήση Viva/myDATA.
    const device = await db.device.create({ data: { orgId: f.orgId, storeId: f.storeId, name: "POS cutover test", kind: "POS_WEB" } });
    const pendingSale = await db.sale.create({ data: { orgId: f.orgId, storeId: f.storeId, deviceId: device.id, status: "AWAITING_PAYMENT", totalCents: 100 } });
    await assert.rejects(freezeMigrationCutover(context(f), cutover.id, adapter), /Viva 1, myDATA 0/);
    await db.sale.update({ where: { id: pendingSale.id }, data: { status: "COMPLETED" } });
    const pendingFiscal = await db.fiscalDocument.create({ data: { orgId: f.orgId, saleId: pendingSale.id, receiptReference: `cutover-${f.suffix}`, status: "PENDING", request: {} } });
    await assert.rejects(freezeMigrationCutover(context(f), cutover.id, adapter), /Viva 0, myDATA 1/);
    await db.fiscalDocument.update({ where: { id: pendingFiscal.id }, data: { status: "FAILED" } });
    assert.equal(calls.length, 0);

    const frozen = await freezeMigrationCutover(context(f), cutover.id, adapter);
    assert.equal(frozen.status, "FROZEN");
    assert.equal(frozen.cursor, "cursor-1");
    await assert.rejects(writeStore(f, "Απαγορευμένη εγγραφή"), /παγωμένη/);
    assert.equal(await db.store.findUnique({ where: { id: f.storeId } }).then((store) => store?.name), "Κατάστημα cutover");
    await writeStore(other, "Άλλος tenant γράφει");
    assert.equal(await db.store.findUnique({ where: { id: other.storeId } }).then((store) => store?.name), "Άλλος tenant γράφει");

    const deltaOne = emptyBundle();
    deltaOne.parties.push({ externalId: "customer:1", name: "Πελάτης delta 1", roles: ["customer"], countryCode: "GR" });
    const deltaOneOptions = options(cutover.id, "DELTA", "export-delta-1", "cursor-1", "cursor-2");
    const importedDelta = await runLegacyMigration(context(f), deltaOne, "import", deltaOneOptions);
    assert.equal(importedDelta.summary.results[0]?.status, "UPDATED");
    assert.equal(importedDelta.summary.differences.length, 0);
    assert.equal((await runLegacyMigration(context(f), deltaOne, "import", deltaOneOptions)).replayed, true);
    await assert.rejects(runLegacyMigration(context(f), emptyBundle(), "import", options(cutover.id, "DELTA", "export-stale", "cursor-1", "cursor-9")), /Stale cursor/);

    // Το dry-run δένει στο cursor-2. Άλλο export προωθεί πρώτα τον cursor· το παλιό dry-run δεν επιτρέπεται πλέον ως import.
    const deltaDry = emptyBundle();
    deltaDry.parties.push({ externalId: "customer:1", name: "Πελάτης delta 2", roles: ["customer"], countryCode: "GR" });
    const deltaDryOptions = options(cutover.id, "DELTA", "export-delta-dry", "cursor-2", "cursor-3");
    const dryRun = await runLegacyMigration(context(f), deltaDry, "dry-run", deltaDryOptions);
    assert.equal(dryRun.run.status, "DRY_RUN");
    const deltaTwoOptions = options(cutover.id, "DELTA", "export-delta-2", "cursor-2", "cursor-3");
    await runLegacyMigration(context(f), deltaDry, "import", deltaTwoOptions);
    assert.equal((await runLegacyMigration(context(f), deltaDry, "dry-run", deltaDryOptions)).replayed, true);
    await assert.rejects(runLegacyMigration(context(f), deltaDry, "import", deltaDryOptions), /Stale cursor/);
    assert.equal(await db.migrationRun.findUnique({ where: { id: dryRun.run.id } }).then((run) => run?.status), "DRY_RUN");

    const finalOptions = options(cutover.id, "DELTA", "export-final-empty", "cursor-3", "cursor-4");
    const finalDelta = await runLegacyMigration(context(f), emptyBundle(), "import", finalOptions);
    assert.equal(finalDelta.summary.results.length, 0);
    const ready = await markMigrationCutoverReady(context(f), cutover.id);
    assert.equal(ready.status, "READY");
    const smoke = ready.smoke as unknown as { cursor: string; runIds: string[]; differences: string[] };
    assert.equal(smoke.cursor, "cursor-4");
    assert.equal(smoke.runIds.length, 4);
    assert.deepEqual(smoke.differences, []);
    assert.deepEqual((await businessCounts(f.orgId)), { party: 1, item: 1, stockLot: 1, salesDocument: 1, customerPayment: 1 });

    await assert.rejects(activateMigrationCutover(context(f), cutover.id, "λάθος επιβεβαίωση", adapter), /Πληκτρολόγησε ακριβώς/);
    const active = await activateMigrationCutover(context(f), cutover.id, expectedActivationConfirmation(cutover.id), adapter);
    assert.equal(active.status, "ACTIVE");
    const activeEvidence = active.adapterEvidence as unknown as { readOnly: { operation: string; cursor: string } };
    assert.deepEqual(activeEvidence.readOnly, { ...activeEvidence.readOnly, operation: "READ_ONLY", cursor: "cursor-4" });
    assert.deepEqual(calls.map((call) => [call.operation, call.request.cursor]), [["FREEZE", "cursor-1"], ["READ_ONLY", "cursor-4"]]);
    await writeStore(f, "Business write μετά το ACTIVE");

    const history = await db.migrationRun.findMany({ where: { orgId: f.orgId, cutoverId: cutover.id } });
    assert.equal(history.length, 5);
    assert.equal(history.filter((run) => run.status === "IMPORTED").length, 4);
    assert.equal(history.filter((run) => run.status === "DRY_RUN").length, 1);
    assert.equal(history.some((run) => run.id === baseline.run.id), true);
    assert.equal(history.some((run) => run.id === finalDelta.run.id), true);
  } finally {
    await cleanup([f, other]);
  }
});

test("PostgreSQL MIG-05/06: μη καταστροφικό rollback, resume evidence και μόνιμο write block", databaseOptions, async () => {
  const f = await fixture();
  const { adapter, calls } = recordingAdapter();
  try {
    const cutover = await createMigrationCutover(context(f), "integration-legacy");
    const baseline = await runLegacyMigration(context(f), bundle(f), "import", options(cutover.id, "BASELINE", "rollback-baseline", null, "rollback-cursor-1"));
    await freezeMigrationCutover(context(f), cutover.id, adapter);
    const before = await businessCounts(f.orgId);

    const rolledBack = await rollbackMigrationCutover(context(f), cutover.id, "Ελεγχόμενη επιστροφή στο legacy", adapter);
    assert.equal(rolledBack.status, "ROLLED_BACK");
    assert.equal(rolledBack.rollbackReason, "Ελεγχόμενη επιστροφή στο legacy");
    const evidence = rolledBack.adapterEvidence as unknown as { resumeWrites: { operation: string; cursor: string } };
    assert.equal(evidence.resumeWrites.operation, "RESUME_WRITES");
    assert.equal(evidence.resumeWrites.cursor, "rollback-cursor-1");
    assert.deepEqual(calls.map((call) => [call.operation, call.request.cursor]), [["FREEZE", "rollback-cursor-1"], ["RESUME_WRITES", "rollback-cursor-1"]]);

    assert.deepEqual(await businessCounts(f.orgId), before);
    const history = await db.migrationRun.findMany({ where: { orgId: f.orgId, cutoverId: cutover.id } });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.id, baseline.run.id);
    assert.equal(history[0]?.status, "IMPORTED");
    await assert.rejects(writeStore(f, "Απαγορευμένο μετά το rollback"), /παγωμένη/);
    await assert.rejects(rollbackLegacyMigration(context(f), baseline.run.id, "Δεν επιτρέπεται destructive rollback"), /παγωμένη/);
    assert.deepEqual(await businessCounts(f.orgId), before);
    assert.equal(await db.migrationRun.findUnique({ where: { id: baseline.run.id } }).then((run) => run?.status), "IMPORTED");
  } finally {
    await cleanup([f]);
  }
});
