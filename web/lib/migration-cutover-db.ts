// State machine cutover: κάθε μετάβαση κλειδώνει τον tenant και ξαναϋπολογίζει τα smoke δεδομένα.
import type { Prisma } from "./generated/prisma/client";
import { db } from "./db";
import { defaultLegacyCutoverAdapter, verifiedLegacyEvidence, type LegacyCutoverAdapter } from "./legacy-cutover-adapter";
import { canonicalJson } from "./legacy-migration";
import { recomputeCutoverSmoke } from "./legacy-migration-db";
import { assertTenantWriteAllowed, expectedActivationConfirmation } from "./migration-cutover";
import { assertGlobalStockScope, type StockContext } from "./stock-scope";
import { stockTransaction } from "./stock-transaction";
import { auditWorkflow, cleanText, WorkflowError } from "./workflow-db";

type Tx = Prisma.TransactionClient;
const json = <T,>(value: T) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const actor = (ctx: StockContext) => ({ id: ctx.userId, name: ctx.userName });
const transactionOptions = { timeout: 30_000, maxWait: 10_000 };

async function scopedCutover(tx: Tx, ctx: StockContext, id: string) {
  assertGlobalStockScope(ctx);
  const cutover = await tx.migrationCutover.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!cutover) throw new WorkflowError("Το cutover δεν βρέθηκε");
  return cutover;
}

async function assertNoPendingFiscalWork(tx: Tx, orgId: string) {
  const [viva, mydata] = await Promise.all([
    tx.sale.count({ where: { orgId, status: "AWAITING_PAYMENT" } }),
    tx.fiscalDocument.count({ where: { orgId, status: "PENDING" } }),
  ]);
  if (viva || mydata) throw new WorkflowError(`Υπάρχουν εκκρεμείς πληρωμές/διαβιβάσεις (Viva ${viva}, myDATA ${mydata})· ολοκληρώστε τις πριν από το cutover`);
}

export async function migrationCutover(ctx: StockContext) {
  assertGlobalStockScope(ctx);
  return db.migrationCutover.findUnique({ where: { orgId: ctx.orgId }, include: { baselineRun: { select: { id: true, sourceCursor: true, bundleHash: true } }, finalRun: { select: { id: true, sourceCursor: true, bundleHash: true } } } });
}

export async function createMigrationCutover(ctx: StockContext, sourceInput: string) {
  const source = cleanText(sourceInput, "Πηγή", 80, true)!;
  return stockTransaction(async (tx) => {
    await assertTenantWriteAllowed(tx, ctx.orgId, "MIGRATION");
    if (await tx.migrationCutover.findUnique({ where: { orgId: ctx.orgId }, select: { id: true } })) throw new WorkflowError("Υπάρχει ήδη cutover για την επιχείρηση· το ιστορικό του δεν αντικαθίσταται");
    const cutover = await tx.migrationCutover.create({ data: { orgId: ctx.orgId, source, createdById: ctx.userId, createdByName: ctx.userName } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "migration.cutover.create", entityType: "migration_cutover", entityId: cutover.id, metadata: { source } });
    return cutover;
  }, transactionOptions);
}

export async function freezeMigrationCutover(ctx: StockContext, id: string, adapter: LegacyCutoverAdapter = defaultLegacyCutoverAdapter) {
  return stockTransaction(async (tx) => {
    await assertTenantWriteAllowed(tx, ctx.orgId, "MIGRATION");
    const cutover = await scopedCutover(tx, ctx, id);
    if (cutover.status !== "PREPARING" || !cutover.baselineRunId || !cutover.cursor) throw new WorkflowError("Απαιτείται ολοκληρωμένο baseline πριν από το freeze");
    const baseline = await tx.migrationRun.findFirst({ where: { id: cutover.baselineRunId, orgId: ctx.orgId, cutoverId: id, kind: "BASELINE", status: "IMPORTED" } });
    if (!baseline || baseline.sourceCursor !== cutover.cursor) throw new WorkflowError("Το baseline δεν συμφωνεί με τον cursor του cutover");
    await assertNoPendingFiscalWork(tx, ctx.orgId);
    // Ο adapter είναι idempotent· αν η commit αποτύχει, η επανάληψη ξαναελέγχει το ίδιο cursor.
    const evidence = verifiedLegacyEvidence(await adapter.freeze({ orgId: ctx.orgId, source: cutover.source, cursor: cutover.cursor }), "FREEZE", cutover.cursor);
    const updated = await tx.migrationCutover.update({ where: { id: cutover.id }, data: { status: "FROZEN", adapterEvidence: json({ freeze: evidence }), frozenAt: new Date(), frozenById: ctx.userId, frozenByName: ctx.userName } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "migration.cutover.freeze", entityType: "migration_cutover", entityId: id, metadata: json({ cursor: cutover.cursor, evidenceId: evidence.evidenceId }) });
    return updated;
  }, transactionOptions);
}

export async function markMigrationCutoverReady(ctx: StockContext, id: string) {
  return stockTransaction(async (tx) => {
    await assertTenantWriteAllowed(tx, ctx.orgId, "MIGRATION");
    const cutover = await scopedCutover(tx, ctx, id);
    if (cutover.status !== "DELTA_IMPORTED" || !cutover.finalRunId || !cutover.adapterEvidence) throw new WorkflowError("Απαιτούνται τελικό delta και τεκμηριωμένο legacy freeze");
    await assertNoPendingFiscalWork(tx, ctx.orgId);
    const smoke = await recomputeCutoverSmoke(tx, ctx, id);
    if (smoke.differences.length) throw new WorkflowError(`Το smoke reconciliation απέτυχε: ${smoke.differences.slice(0, 5).join(" · ")}`);
    const updated = await tx.migrationCutover.update({ where: { id }, data: { status: "READY", smoke: json(smoke), readyAt: new Date() } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "migration.cutover.ready", entityType: "migration_cutover", entityId: id, metadata: json({ finalRunId: cutover.finalRunId, counts: smoke.actual.counts }) });
    return updated;
  }, transactionOptions);
}

export async function activateMigrationCutover(ctx: StockContext, id: string, confirmation: string, adapter: LegacyCutoverAdapter = defaultLegacyCutoverAdapter) {
  if (confirmation.trim() !== expectedActivationConfirmation(id)) throw new WorkflowError(`Πληκτρολόγησε ακριβώς «${expectedActivationConfirmation(id)}»`);
  return stockTransaction(async (tx) => {
    await assertTenantWriteAllowed(tx, ctx.orgId, "MIGRATION");
    const cutover = await scopedCutover(tx, ctx, id);
    if (cutover.status !== "READY" || !cutover.cursor || !cutover.adapterEvidence || !cutover.smoke) throw new WorkflowError("Το cutover δεν είναι έτοιμο προς ενεργοποίηση");
    await assertNoPendingFiscalWork(tx, ctx.orgId);
    const smoke = await recomputeCutoverSmoke(tx, ctx, id);
    if (smoke.differences.length || canonicalJson(smoke) !== canonicalJson(cutover.smoke)) throw new WorkflowError("Τα δεδομένα άλλαξαν μετά το smoke check· απαιτείται νέα προετοιμασία");
    const evidence = verifiedLegacyEvidence(await adapter.setReadOnly({ orgId: ctx.orgId, source: cutover.source, cursor: cutover.cursor }), "READ_ONLY", cutover.cursor);
    const previous = cutover.adapterEvidence && typeof cutover.adapterEvidence === "object" && !Array.isArray(cutover.adapterEvidence) ? cutover.adapterEvidence : {};
    const updated = await tx.migrationCutover.update({ where: { id }, data: { status: "ACTIVE", activatedAt: new Date(), activatedById: ctx.userId, activatedByName: ctx.userName, adapterEvidence: json({ ...previous, readOnly: evidence }) } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "migration.cutover.activate", entityType: "migration_cutover", entityId: id, metadata: json({ cursor: cutover.cursor, evidenceId: evidence.evidenceId }) });
    return updated;
  }, transactionOptions);
}

/** Μη καταστροφικό rollback φάσης· δεν διαγράφει runs ή business ιστορικό και το νέο tenant μένει frozen. */
export async function rollbackMigrationCutover(ctx: StockContext, id: string, reasonInput: string, adapter: LegacyCutoverAdapter = defaultLegacyCutoverAdapter) {
  const reason = cleanText(reasonInput, "Αιτιολογία rollback", 300, true)!;
  return stockTransaction(async (tx) => {
    await assertTenantWriteAllowed(tx, ctx.orgId, "MIGRATION");
    const cutover = await scopedCutover(tx, ctx, id);
    if (["ACTIVE", "ROLLED_BACK"].includes(cutover.status)) throw new WorkflowError("Το ενεργό ή ήδη αναιρεμένο cutover δεν μπορεί να αναιρεθεί ξανά");
    let resume: unknown = null;
    if (cutover.status !== "PREPARING") {
      if (!cutover.cursor) throw new WorkflowError("Λείπει ο cursor· το παλιό σύστημα δεν επανήλθε");
      resume = verifiedLegacyEvidence(await adapter.resumeWrites({ orgId: ctx.orgId, source: cutover.source, cursor: cutover.cursor }), "RESUME_WRITES", cutover.cursor);
    }
    const previous = cutover.adapterEvidence && typeof cutover.adapterEvidence === "object" && !Array.isArray(cutover.adapterEvidence) ? cutover.adapterEvidence : {};
    const updated = await tx.migrationCutover.update({ where: { id }, data: { status: "ROLLED_BACK", rollbackReason: reason, rolledBackAt: new Date(), rolledBackById: ctx.userId, rolledBackByName: ctx.userName, ...(resume ? { adapterEvidence: json({ ...previous, resumeWrites: resume }) } : {}) } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "migration.cutover.rollback", entityType: "migration_cutover", entityId: id, reason, metadata: { previousStatus: cutover.status } });
    return updated;
  }, transactionOptions);
}
