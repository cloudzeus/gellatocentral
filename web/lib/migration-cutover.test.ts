import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLegacyCutoverAdapter, UnsupportedLegacyCutoverAdapter, verifiedLegacyEvidence, type LegacyCutoverEvidence } from "./legacy-cutover-adapter.ts";
import { migrationBundleHash, parseMigrationBundle } from "./legacy-migration.ts";
import { expectedActivationConfirmation, tenantWriteBlocked } from "./migration-cutover.ts";

const evidence = (operation: LegacyCutoverEvidence["operation"], cursor = "cursor-1"): LegacyCutoverEvidence => ({
  operation,
  evidenceId: `evidence-${operation}`,
  cursor,
  observedAt: "2026-11-25T10:00:00.000Z",
});

test("cutover gate: μπλοκάρει μόνο τις business φάσεις freeze/ready/rollback", () => {
  for (const status of ["FROZEN", "DELTA_IMPORTED", "READY", "ROLLED_BACK"] as const) assert.equal(tenantWriteBlocked(status), true);
  for (const status of ["PREPARING", "ACTIVE"] as const) assert.equal(tenantWriteBlocked(status), false);
  assert.equal(tenantWriteBlocked(null), false);
  assert.equal(tenantWriteBlocked("FROZEN", "MIGRATION"), false);
  assert.equal(tenantWriteBlocked("ROLLED_BACK", "SETTLEMENT"), false);
  assert.equal(tenantWriteBlocked("ACTIVE", "BUSINESS"), false);
});

test("cutover adapter: default unsupported χωρίς ψεύτικο evidence", async () => {
  assert.ok(defaultLegacyCutoverAdapter instanceof UnsupportedLegacyCutoverAdapter);
  const adapter = new UnsupportedLegacyCutoverAdapter();
  await assert.rejects(adapter.freeze(), /Δεν έχει ρυθμιστεί legacy cutover adapter/);
  await assert.rejects(adapter.setReadOnly(), /Δεν έχει ρυθμιστεί legacy cutover adapter/);
  await assert.rejects(adapter.resumeWrites(), /Δεν έχει ρυθμιστεί legacy cutover adapter/);
});

test("cutover adapter: evidence δένει με operation και τρέχοντα cursor", () => {
  assert.deepEqual(verifiedLegacyEvidence(evidence("FREEZE"), "FREEZE", "cursor-1"), evidence("FREEZE"));
  assert.throws(() => verifiedLegacyEvidence(evidence("READ_ONLY"), "FREEZE", "cursor-1"), /άκυρο/);
  assert.throws(() => verifiedLegacyEvidence(evidence("FREEZE", "old"), "FREEZE", "cursor-1"), /τρέχοντα cursor/);
  assert.throws(() => verifiedLegacyEvidence({ ...evidence("FREEZE"), observedAt: "bad" }, "FREEZE", "cursor-1"), /άκυρο/);
});

test("cutover activation: typed confirmation περιέχει το ακριβές cutover ID", () => {
  assert.equal(expectedActivationConfirmation("cutover-123"), "ΕΝΕΡΓΟΠΟΙΗΣΗ cutover-123");
  assert.notEqual(expectedActivationConfirmation("cutover-123"), expectedActivationConfirmation("cutover-456"));
});

test("cutover export: bundle hash είναι canonical και αλλάζει με το περιεχόμενο", () => {
  const raw = { version: 1, source: "legacy", parties: [], items: [], stockLots: [], documents: [] };
  const parsed = parseMigrationBundle(raw);
  const reordered = parseMigrationBundle({ documents: [], stockLots: [], items: [], parties: [], source: "legacy", version: 1 });
  assert.equal(migrationBundleHash(parsed), migrationBundleHash(reordered));
  assert.match(migrationBundleHash(parsed), /^[0-9a-f]{64}$/);
  assert.notEqual(migrationBundleHash(parsed), migrationBundleHash(parseMigrationBundle({ ...raw, source: "other" })));
});
