// Staged legacy import: όλες οι business εγγραφές και το reconciliation μαζί, ατομικά και tenant-scoped.
import { Prisma } from "./generated/prisma/client";
import type { MigrationCutoverStatus } from "./generated/prisma/enums";
import { db } from "./db";
import {
  expectedMigrationReconciliation, migrationBundleHash, migrationPayloadHash, parseMigrationBundle, reconciliationDifferences, rollbackCreatedIds,
  type MigrationBundle, type MigrationEntity, type MigrationReconciliation, type MigrationUnit,
} from "./legacy-migration";
import { assertTenantWriteAllowed } from "./migration-cutover";
import { stockCostCents } from "./reports";
import { assertGlobalStockScope, assertStockScope, type StockContext } from "./stock-scope";
import { stockTransaction } from "./stock-transaction";
import { auditWorkflow, cleanText, WorkflowError } from "./workflow-db";

export type MigrationMode = "dry-run" | "import";
export type MigrationRunKind = "BASELINE" | "DELTA";
export type LegacyMigrationOptions = {
  cutoverId: string;
  kind: MigrationRunKind;
  exportId: string;
  previousCursor?: string | null;
  sourceCursor: string;
  exportedAt: string | Date;
};
export type MigrationResult = { entityType: MigrationEntity; externalId: string; localId: string | null; status: "CREATED" | "UPDATED" | "SKIPPED" };
type Tx = Prisma.TransactionClient;
export type Summary = {
  mode: MigrationMode;
  results: MigrationResult[];
  expected: MigrationReconciliation;
  actual: MigrationReconciliation;
  differences: string[];
  note: string;
};
const json = <T,>(value: T) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const actor = (ctx: StockContext) => ({ id: ctx.userId, name: ctx.userName });
const entityOrder: MigrationEntity[] = ["party", "item", "stock_lot", "sales_document"];

type PreparedMigrationOptions = Omit<LegacyMigrationOptions, "exportedAt" | "previousCursor"> & { exportedAt: Date; previousCursor: string | null };
function prepareMigrationOptions(options?: LegacyMigrationOptions): PreparedMigrationOptions | null {
  if (!options) return null;
  const exportedAt = new Date(options.exportedAt);
  if (Number.isNaN(exportedAt.getTime())) throw new WorkflowError("Άκυρη ημερομηνία export");
  if (!["BASELINE", "DELTA"].includes(options.kind)) throw new WorkflowError("Άκυρο είδος migration run");
  return {
    cutoverId: cleanText(options.cutoverId, "Cutover", 80, true)!,
    kind: options.kind,
    exportId: cleanText(options.exportId, "Export ID", 120, true)!,
    previousCursor: cleanText(options.previousCursor, "Προηγούμενος cursor", 200),
    sourceCursor: cleanText(options.sourceCursor, "Source cursor", 200, true)!,
    exportedAt,
  };
}

function assertMigrationRunState(cutover: { status: MigrationCutoverStatus; baselineRunId: string | null; cursor: string | null } | null, options: PreparedMigrationOptions) {
  if (options.kind === "BASELINE") {
    if (cutover?.status !== "PREPARING" || cutover.baselineRunId || options.previousCursor) throw new WorkflowError("Το baseline απαιτεί PREPARING cutover χωρίς προηγούμενο baseline/cursor");
  } else if (!cutover || !["FROZEN", "DELTA_IMPORTED"].includes(cutover.status) || !cutover.baselineRunId || !options.previousCursor || options.previousCursor !== cutover.cursor) {
    throw new WorkflowError("Stale cursor: το delta πρέπει να ξεκινά από τον τρέχοντα cursor του frozen cutover");
  }
}

function recordsByEntity(bundle: MigrationBundle) {
  return [
    ...bundle.parties.map((payload) => ({ entityType: "party" as const, externalId: payload.externalId, payload })),
    ...bundle.items.map((payload) => ({ entityType: "item" as const, externalId: payload.externalId, payload })),
    ...bundle.stockLots.map((payload) => ({ entityType: "stock_lot" as const, externalId: payload.externalId, payload })),
    ...bundle.documents.map((payload) => ({ entityType: "sales_document" as const, externalId: payload.externalId, payload })),
  ];
}

async function migrationUnits(tx: Tx, bundle: MigrationBundle): Promise<MigrationUnit[]> {
  const codes = [...new Set(bundle.items.map((item) => item.baseUnitCode))];
  const units = await tx.unit.findMany({ where: { code: { in: codes }, active: true }, select: { code: true, dimension: true, toBase: true } });
  if (units.length !== codes.length) throw new WorkflowError("Λείπουν ενεργές μονάδες μέτρησης από το export");
  return units;
}

async function validateReferences(tx: Tx, ctx: StockContext, bundle: MigrationBundle) {
  assertGlobalStockScope(ctx);
  const storeIds = [...new Set(bundle.documents.map((row) => row.storeId))];
  const warehouseIds = [...new Set([...bundle.stockLots.map((row) => row.warehouseId), ...bundle.documents.map((row) => row.warehouseId)])];
  await assertStockScope(tx, ctx, { warehouseIds, forWrite: true, writePurpose: "MIGRATION" });
  for (const storeId of storeIds) {
    const document = bundle.documents.find((row) => row.storeId === storeId)!;
    await assertStockScope(tx, ctx, { storeId, warehouseId: document.warehouseId, forWrite: true, writePurpose: "MIGRATION" });
  }
}

async function assertNaturalKeysAvailable(tx: Tx, ctx: StockContext, bundle: MigrationBundle, existing: Map<string, { localId: string | null; payloadHash: string; status: string }>) {
  for (const party of bundle.parties) {
    const key = `party:${party.externalId}`;
    if (existing.get(key)?.localId) continue;
    const clash = await tx.party.findFirst({ where: { orgId: ctx.orgId, ...(party.vatNumber ? { vatNumber: party.vatNumber } : { name: party.name }) }, select: { id: true } });
    if (clash) throw new WorkflowError(`Συναλλασσόμενος ${party.externalId}: υπάρχει ήδη εγγραφή χωρίς αυτό το external ID`);
  }
  for (const item of bundle.items) {
    if (existing.get(`item:${item.externalId}`)?.localId) continue;
    if (await tx.genericItem.findFirst({ where: { orgId: ctx.orgId, name: item.name }, select: { id: true } })) throw new WorkflowError(`Είδος ${item.externalId}: υπάρχει ήδη το όνομα χωρίς αυτό το external ID`);
  }
  const itemIds = new Map(bundle.items.map((item) => [item.externalId, existing.get(`item:${item.externalId}`)?.localId ?? null]));
  for (const lot of bundle.stockLots) {
    if (existing.get(`stock_lot:${lot.externalId}`)?.localId) continue;
    const genericItemId = itemIds.get(lot.itemExternalId);
    if (genericItemId && await tx.stockLot.findFirst({ where: { orgId: ctx.orgId, genericItemId, warehouseId: lot.warehouseId, batchNumber: lot.batchNumber }, select: { id: true } })) throw new WorkflowError(`Παρτίδα ${lot.externalId}: υπάρχει ήδη ο συνδυασμός είδους/αποθήκης/αρίθμησης`);
  }
  for (const document of bundle.documents) {
    if (existing.get(`sales_document:${document.externalId}`)?.localId) continue;
    if (await tx.salesDocument.findFirst({ where: { orgId: ctx.orgId, docType: document.docType, series: document.series, aa: document.aa }, select: { id: true } })) throw new WorkflowError(`Παραστατικό ${document.externalId}: υπάρχει ήδη ο τύπος/σειρά/ΑΑ`);
  }
}

async function actualReconciliation(tx: Tx, ctx: StockContext, bundle: MigrationBundle, units: readonly MigrationUnit[]): Promise<MigrationReconciliation> {
  const expected = expectedMigrationReconciliation(bundle, units);
  const records = await tx.migrationRecord.findMany({ where: { orgId: ctx.orgId, OR: entityOrder.flatMap((entityType) => {
    const ids = recordsByEntity(bundle).filter((row) => row.entityType === entityType).map((row) => row.externalId);
    return ids.length ? [{ entityType, externalId: { in: ids } }] : [];
  }) } });
  const recordMap = new Map(records.map((record) => [`${record.entityType}:${record.externalId}`, record]));
  const local = (entityType: MigrationEntity, externalId: string) => recordMap.get(`${entityType}:${externalId}`)?.localId ?? null;
  const partyIds = bundle.parties.map((row) => local("party", row.externalId)).filter((id): id is string => Boolean(id));
  const itemIds = bundle.items.map((row) => local("item", row.externalId)).filter((id): id is string => Boolean(id));
  const lotIds = bundle.stockLots.map((row) => local("stock_lot", row.externalId)).filter((id): id is string => Boolean(id));
  const documentIds = bundle.documents.map((row) => local("sales_document", row.externalId)).filter((id): id is string => Boolean(id));
  const [parties, items, lots, documents] = await Promise.all([
    tx.party.findMany({ where: { orgId: ctx.orgId, id: { in: partyIds } }, select: { id: true } }),
    tx.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: itemIds } }, include: { baseUnit: true } }),
    tx.stockLot.findMany({ where: { orgId: ctx.orgId, id: { in: lotIds } }, select: { id: true } }),
    tx.salesDocument.findMany({ where: { orgId: ctx.orgId, id: { in: documentIds } }, include: { allocations: { select: { amountCents: true } } } }),
  ]);
  const itemLocalByExternal = new Map(bundle.items.map((item) => [item.externalId, local("item", item.externalId)]));
  const unitByItem = new Map(items.map((item) => [item.id, item.baseUnit]));
  const stock: MigrationReconciliation["stock"] = [];
  for (const expectedRow of expected.stock) {
    const separator = expectedRow.key.lastIndexOf(":");
    const itemExternalId = expectedRow.key.slice(0, separator);
    const warehouseId = expectedRow.key.slice(separator + 1);
    const genericItemId = itemLocalByExternal.get(itemExternalId ?? "");
    const unit = genericItemId ? unitByItem.get(genericItemId) : null;
    const relevantLotIds = bundle.stockLots.filter((lot) => lot.itemExternalId === itemExternalId && lot.warehouseId === warehouseId).map((lot) => local("stock_lot", lot.externalId)).filter((id): id is string => Boolean(id));
    const movements = genericItemId && unit && relevantLotIds.length ? await tx.stockMovement.findMany({ where: { orgId: ctx.orgId, warehouseId, genericItemId, lotId: { in: relevantLotIds } }, select: { quantity: true, unitCostHundredths: true } }) : [];
    stock.push({ key: expectedRow.key, quantityBase: movements.reduce((sum, row) => sum + row.quantity, 0), costCents: movements.reduce((sum, row) => sum + (row.unitCostHundredths == null || !unit ? 0 : stockCostCents(row.quantity, row.unitCostHundredths, unit.dimension)), 0) });
  }
  const actualByDocument = new Map(documents.map((document) => [document.id, document]));
  const money = { netCents: 0, vatCents: 0, totalCents: 0, outstandingCents: 0 };
  for (const source of bundle.documents) {
    const document = actualByDocument.get(local("sales_document", source.externalId) ?? "");
    if (!document) continue;
    const sign = document.docType === "5.1" ? -1 : 1;
    money.netCents += sign * document.netCents;
    money.vatCents += sign * document.vatCents;
    money.totalCents += sign * document.totalCents;
    if (document.status === "ISSUED" && document.docType === "1.1") money.outstandingCents += Math.max(0, document.totalCents - document.allocations.reduce((sum, row) => sum + row.amountCents, 0));
  }
  return { counts: { party: parties.length, item: items.length, stock_lot: lots.length, sales_document: documents.length }, money, stock };
}

async function saveRecord(tx: Tx, ctx: StockContext, runId: string, entityType: MigrationEntity, externalId: string, localId: string, payload: object, status: "CREATED" | "UPDATED") {
  const payloadHash = migrationPayloadHash(entityType, externalId, payload);
  const existing = await tx.migrationRecord.findUnique({ where: { orgId_entityType_externalId: { orgId: ctx.orgId, entityType, externalId } } });
  if (existing) {
    // Το runId δείχνει τον run που δημιούργησε/υιοθέτησε πρώτος την εγγραφή· έτσι παλιό rollback δεν αγγίζει νεότερη ενημέρωση.
    await tx.migrationRecord.update({ where: { id: existing.id }, data: { ...(existing.localId ? {} : { runId }), localId, payloadHash, payload: json(payload), status, error: null } });
  } else {
    await tx.migrationRecord.create({ data: { orgId: ctx.orgId, runId, entityType, externalId, localId, payloadHash, payload: json(payload), status } });
  }
}

async function importBusiness(tx: Tx, ctx: StockContext, runId: string, bundle: MigrationBundle) {
  const results: MigrationResult[] = [];
  const partyIds = new Map<string, string>();
  const itemIds = new Map<string, string>();
  for (const party of bundle.parties) {
    const existing = await tx.migrationRecord.findUnique({ where: { orgId_entityType_externalId: { orgId: ctx.orgId, entityType: "party", externalId: party.externalId } } });
    const hash = migrationPayloadHash("party", party.externalId, party);
    if (existing?.localId && existing.payloadHash === hash) {
      const current = await tx.party.findFirst({ where: { id: existing.localId, orgId: ctx.orgId }, select: { id: true } });
      if (!current) throw new WorkflowError(`Συναλλασσόμενος ${party.externalId}: το staging δείχνει σε εγγραφή που λείπει`);
      partyIds.set(party.externalId, current.id); results.push({ entityType: "party", externalId: party.externalId, localId: current.id, status: "SKIPPED" }); continue;
    }
    const values = { roles: party.roles, name: party.name, vatNumber: party.vatNumber ?? null, countryCode: party.countryCode, email: party.email ?? null, phone: party.phone ?? null, address: party.address ?? null, city: party.city ?? null, postalCode: party.postalCode ?? null, active: party.active };
    const saved = existing?.localId
      ? await tx.party.update({ where: { id: existing.localId }, data: values })
      : await tx.party.create({ data: { orgId: ctx.orgId, ...values } });
    const status = existing?.localId ? "UPDATED" : "CREATED";
    await saveRecord(tx, ctx, runId, "party", party.externalId, saved.id, party, status);
    partyIds.set(party.externalId, saved.id); results.push({ entityType: "party", externalId: party.externalId, localId: saved.id, status });
  }
  for (const item of bundle.items) {
    const existing = await tx.migrationRecord.findUnique({ where: { orgId_entityType_externalId: { orgId: ctx.orgId, entityType: "item", externalId: item.externalId } } });
    const hash = migrationPayloadHash("item", item.externalId, item);
    if (existing?.localId && existing.payloadHash === hash) {
      const current = await tx.genericItem.findFirst({ where: { id: existing.localId, orgId: ctx.orgId }, include: { baseUnit: true } });
      if (!current || current.baseUnit.code !== item.baseUnitCode) throw new WorkflowError(`Είδος ${item.externalId}: το staging ή η μονάδα δεν συμφωνεί`);
      itemIds.set(item.externalId, current.id); results.push({ entityType: "item", externalId: item.externalId, localId: current.id, status: "SKIPPED" }); continue;
    }
    const unit = await tx.unit.findFirst({ where: { code: item.baseUnitCode, active: true }, select: { id: true } });
    if (!unit) throw new WorkflowError(`Είδος ${item.externalId}: η μονάδα δεν είναι ενεργή`);
    const values = { name: item.name, baseUnitId: unit.id, avgCostHundredths: item.avgCostHundredths, trackStock: item.trackStock, gramsPerPiece: item.gramsPerPiece ?? null, active: item.active };
    const saved = existing?.localId ? await tx.genericItem.update({ where: { id: existing.localId }, data: values }) : await tx.genericItem.create({ data: { orgId: ctx.orgId, ...values } });
    const status = existing?.localId ? "UPDATED" : "CREATED";
    await saveRecord(tx, ctx, runId, "item", item.externalId, saved.id, item, status);
    itemIds.set(item.externalId, saved.id); results.push({ entityType: "item", externalId: item.externalId, localId: saved.id, status });
  }
  for (const lot of bundle.stockLots) {
    const existing = await tx.migrationRecord.findUnique({ where: { orgId_entityType_externalId: { orgId: ctx.orgId, entityType: "stock_lot", externalId: lot.externalId } } });
    const hash = migrationPayloadHash("stock_lot", lot.externalId, lot);
    if (existing?.localId && existing.payloadHash === hash) {
      const current = await tx.stockLot.findFirst({ where: { id: existing.localId, orgId: ctx.orgId }, select: { id: true } });
      if (!current) throw new WorkflowError(`Παρτίδα ${lot.externalId}: το staging δείχνει σε εγγραφή που λείπει`);
      results.push({ entityType: "stock_lot", externalId: lot.externalId, localId: current.id, status: "SKIPPED" }); continue;
    }
    if (existing?.localId) throw new WorkflowError(`Παρτίδα ${lot.externalId}: το άνοιγμα αποθέματος είναι αμετάβλητο· χρησιμοποίησε νέο external ID ή διόρθωση αποθέματος`);
    const genericItemId = itemIds.get(lot.itemExternalId)!;
    const created = await tx.stockLot.create({ data: { orgId: ctx.orgId, genericItemId, warehouseId: lot.warehouseId, batchNumber: lot.batchNumber, expiresAt: lot.expiresAt ? new Date(lot.expiresAt) : null, movements: { create: { orgId: ctx.orgId, warehouseId: lot.warehouseId, genericItemId, quantity: lot.quantityBase, unitCostHundredths: lot.unitCostHundredths, source: "legacy_import", note: `Αρχικό απόθεμα ${lot.externalId}`, occurredAt: new Date(lot.occurredAt), createdById: ctx.userId, createdByName: ctx.userName } } } });
    await saveRecord(tx, ctx, runId, "stock_lot", lot.externalId, created.id, lot, "CREATED");
    results.push({ entityType: "stock_lot", externalId: lot.externalId, localId: created.id, status: "CREATED" });
  }
  for (const document of bundle.documents) {
    const existing = await tx.migrationRecord.findUnique({ where: { orgId_entityType_externalId: { orgId: ctx.orgId, entityType: "sales_document", externalId: document.externalId } } });
    const hash = migrationPayloadHash("sales_document", document.externalId, document);
    if (existing?.localId && existing.payloadHash === hash) {
      const current = await tx.salesDocument.findFirst({ where: { id: existing.localId, orgId: ctx.orgId }, select: { id: true } });
      if (!current) throw new WorkflowError(`Παραστατικό ${document.externalId}: το staging δείχνει σε εγγραφή που λείπει`);
      results.push({ entityType: "sales_document", externalId: document.externalId, localId: current.id, status: "SKIPPED" }); continue;
    }
    if (existing?.localId) throw new WorkflowError(`Παραστατικό ${document.externalId}: το ιστορικό snapshot είναι αμετάβλητο`);
    const customerId = partyIds.get(document.customerExternalId)!;
    const order = await tx.wholesaleOrder.create({ data: {
      orgId: ctx.orgId, customerId, storeId: document.storeId, warehouseId: document.warehouseId, number: `LEGACY-${document.externalId}`, status: "INVOICED", neededAt: new Date(document.issuedAt), deliveredAt: new Date(document.issuedAt),
      note: "Ιστορικό legacy παραστατικό — δεν ξαναεκδίδεται και δεν αποστέλλεται σε myDATA", netCents: document.netCents, vatCents: document.vatCents, totalCents: document.totalCents, source: "legacy_import", externalKey: document.externalId, createdByName: ctx.userName,
      lines: { create: document.lines.map((line) => ({ orgId: ctx.orgId, genericItemId: itemIds.get(line.itemExternalId)!, quantityBase: line.quantityBase, unitPriceCents: line.unitPriceCents, vatRate: line.vatRate })) },
    } });
    const saved = await tx.salesDocument.create({ data: {
      orgId: ctx.orgId, orderId: order.id, customerId, storeId: document.storeId, warehouseId: document.warehouseId, docType: document.docType, series: document.series, aa: document.aa, issuedAt: new Date(document.issuedAt), dueAt: document.dueAt ? new Date(document.dueAt) : null,
      netCents: document.netCents, vatCents: document.vatCents, totalCents: document.totalCents, customerSnapshot: json({ externalId: document.customerExternalId, legacy: true }), createdByName: ctx.userName,
      lines: { create: document.lines.map((line) => ({ orgId: ctx.orgId, genericItemId: itemIds.get(line.itemExternalId)!, quantityBase: line.quantityBase, unitPriceCents: line.unitPriceCents, vatRate: line.vatRate, costHundredths: line.costHundredths })) },
    } });
    if (document.paidCents) await tx.customerPayment.create({ data: { orgId: ctx.orgId, customerId, amountCents: document.paidCents, paidAt: new Date(document.issuedAt), reference: `LEGACY-${document.externalId}`, note: "Ιστορική είσπραξη χωρίς νέα κίνηση τραπεζικού λογαριασμού", createdByName: ctx.userName, allocations: { create: { orgId: ctx.orgId, documentId: saved.id, amountCents: document.paidCents } } } });
    await saveRecord(tx, ctx, runId, "sales_document", document.externalId, saved.id, document, "CREATED");
    results.push({ entityType: "sales_document", externalId: document.externalId, localId: saved.id, status: "CREATED" });
  }
  return results;
}

export async function runLegacyMigration(ctx: StockContext, raw: unknown, mode: MigrationMode, rawOptions?: LegacyMigrationOptions) {
  const initial = parseMigrationBundle(raw);
  const options = prepareMigrationOptions(rawOptions);
  const bundleHash = migrationBundleHash(initial);
  return stockTransaction(async (tx) => {
    assertGlobalStockScope(ctx);
    // Ακόμη και η standalone συμβατή ροή δεν μπορεί να παρακάμψει υπάρχον cutover.
    await assertTenantWriteAllowed(tx, ctx.orgId, "MIGRATION");
    const existingCutover = await tx.migrationCutover.findUnique({ where: { orgId: ctx.orgId } });
    if (!options && existingCutover) throw new WorkflowError("Υπάρχει cutover· η εισαγωγή απαιτεί export ID, είδος run και cursors");
    if (options && (!existingCutover || existingCutover.id !== options.cutoverId || existingCutover.source !== initial.source)) throw new WorkflowError("Το cutover ή η πηγή του export δεν συμφωνούν με τον tenant");

    const previous = options ? await tx.migrationRun.findUnique({ where: { orgId_exportId: { orgId: ctx.orgId, exportId: options.exportId } } }) : null;
    if (previous) {
      if (previous.bundleHash !== bundleHash) throw new WorkflowError("Conflict: το ίδιο export ID έχει διαφορετικό bundle hash");
      const sameIdentity = options && previous.cutoverId === options.cutoverId && previous.kind === options.kind && previous.sourceCursor === options.sourceCursor && previous.previousCursor === options.previousCursor && previous.exportedAt?.getTime() === options.exportedAt.getTime();
      if (!sameIdentity) throw new WorkflowError("Conflict: το export ID επαναχρησιμοποιείται με διαφορετικά metadata");
      if (previous.status === "IMPORTED" && mode === "import") return { run: previous, summary: previous.summary as unknown as Summary, replayed: true };
      if (previous.status === "DRY_RUN" && mode === "dry-run") return { run: previous, summary: previous.summary as unknown as Summary, replayed: true };
      if (!(previous.status === "DRY_RUN" && mode === "import")) throw new WorkflowError("Το ιστορικό export δεν μπορεί να επαναχρησιμοποιηθεί για αυτή τη λειτουργία");
    }
    // Η αναβάθμιση dry-run σε import ξαναελέγχει τον cursor· τα ακριβή replay παραμένουν idempotent.
    if (options && (!previous || (previous.status === "DRY_RUN" && mode === "import"))) assertMigrationRunState(existingCutover, options);

    await validateReferences(tx, ctx, initial);
    const units = await migrationUnits(tx, initial);
    const bundle = parseMigrationBundle(initial, units);
    const rows = recordsByEntity(bundle);
    const existingRecords = await tx.migrationRecord.findMany({ where: { orgId: ctx.orgId, OR: entityOrder.flatMap((entityType) => {
      const ids = rows.filter((row) => row.entityType === entityType).map((row) => row.externalId);
      return ids.length ? [{ entityType, externalId: { in: ids } }] : [];
    }) } });
    const existing = new Map(existingRecords.map((record) => [`${record.entityType}:${record.externalId}`, record]));
    await assertNaturalKeysAvailable(tx, ctx, bundle, existing);
    const expected = expectedMigrationReconciliation(bundle, units);
    const identity = options ? {
      cutoverId: options.cutoverId, kind: options.kind, exportId: options.exportId, previousCursor: options.previousCursor,
      sourceCursor: options.sourceCursor, exportedAt: options.exportedAt, bundleHash,
    } : {};
    if (mode === "dry-run") {
      const results: MigrationResult[] = rows.map((row) => {
        const record = existing.get(`${row.entityType}:${row.externalId}`);
        const same = record?.localId && record.payloadHash === migrationPayloadHash(row.entityType, row.externalId, row.payload);
        return { entityType: row.entityType, externalId: row.externalId, localId: record?.localId ?? null, status: same ? "SKIPPED" : record?.localId ? "UPDATED" : "CREATED" };
      });
      const actual = await actualReconciliation(tx, ctx, bundle, units);
      const summary: Summary = { mode, results, expected, actual, differences: reconciliationDifferences(expected, actual), note: "Dry-run: δεν γράφτηκε κανένα επιχειρησιακό δεδομένο. Οι αποκλίσεις δείχνουν την τρέχουσα εικόνα πριν από την εισαγωγή." };
      const run = await tx.migrationRun.create({ data: { orgId: ctx.orgId, source: cleanText(bundle.source, "Πηγή", 80, true)!, status: "DRY_RUN", summary: json(summary), createdByName: ctx.userName, ...identity } });
      return { run, summary, replayed: false };
    }
    const run = previous ?? await tx.migrationRun.create({ data: { orgId: ctx.orgId, source: cleanText(bundle.source, "Πηγή", 80, true)!, status: "DRY_RUN", summary: json({ mode, results: [], expected, actual: expected, differences: [], note: "Εισαγωγή σε εξέλιξη" }), createdByName: ctx.userName, ...identity } });
    const results = await importBusiness(tx, ctx, run.id, bundle);
    const actual = await actualReconciliation(tx, ctx, bundle, units);
    const differences = reconciliationDifferences(expected, actual);
    if (differences.length) throw new WorkflowError(`Reconciliation απέτυχε και έγινε rollback: ${differences.slice(0, 8).join(" · ")}`);
    const summary: Summary = { mode, results, expected, actual, differences, note: "Τα ποσά, τα απλήρωτα, οι ποσότητες και το κόστος συμφωνούν με το canonical export. Δεν δημιουργήθηκε νέα φορολογική αρίθμηση ή διαβίβαση myDATA." };
    await tx.migrationRun.update({ where: { id: run.id }, data: { status: "IMPORTED", summary: json(summary) } });
    if (options) {
      await tx.migrationCutover.update({ where: { id: options.cutoverId }, data: options.kind === "BASELINE"
        ? { baselineRunId: run.id, cursor: options.sourceCursor }
        : { status: "DELTA_IMPORTED", finalRunId: run.id, cursor: options.sourceCursor, smoke: Prisma.DbNull, readyAt: null } });
    }
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "migration.import", entityType: "migration_run", entityId: run.id, metadata: json({ source: bundle.source, kind: options?.kind ?? "BASELINE", exportId: options?.exportId ?? null, cursor: options?.sourceCursor ?? null, counts: expected.counts, results: results.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {}) }) });
    return { run: { ...run, status: "IMPORTED" as const }, summary, replayed: false };
  }, { timeout: 120_000, maxWait: 10_000 });
}

/** Το smoke ξαναδιαβάζει payloads και business rows· δεν αρκείται το stored summary του τελευταίου delta. */
export async function recomputeCutoverSmoke(tx: Tx, ctx: StockContext, cutoverId: string) {
  const cutover = await tx.migrationCutover.findFirst({ where: { id: cutoverId, orgId: ctx.orgId } });
  if (!cutover?.baselineRunId || !cutover.finalRunId || !cutover.cursor) throw new WorkflowError("Λείπει baseline, τελικό delta ή cursor από το smoke check");
  const runs = await tx.migrationRun.findMany({ where: { orgId: ctx.orgId, cutoverId, status: "IMPORTED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!runs.some((run) => run.id === cutover.baselineRunId && run.kind === "BASELINE") || !runs.some((run) => run.id === cutover.finalRunId && run.kind === "DELTA")) throw new WorkflowError("Τα συνδεδεμένα runs δεν συμφωνούν με το cutover");
  const references = runs.flatMap((run) => {
    const summary = run.summary as unknown as Partial<Summary>;
    return Array.isArray(summary.results) ? summary.results : [];
  });
  const records = references.length ? await tx.migrationRecord.findMany({ where: { orgId: ctx.orgId, OR: entityOrder.flatMap((entityType) => {
    const ids = references.filter((row) => row.entityType === entityType).map((row) => row.externalId);
    return ids.length ? [{ entityType, externalId: { in: [...new Set(ids)] } }] : [];
  }) } }) : [];
  const byKey = new Map(records.map((record) => [`${record.entityType}:${record.externalId}`, record]));
  for (const reference of references) {
    const record = byKey.get(`${reference.entityType}:${reference.externalId}`);
    if (!record?.localId || record.status === "ROLLED_BACK") throw new WorkflowError(`Λείπει staged εγγραφή ${reference.entityType}:${reference.externalId}`);
  }
  const payloads = (entityType: MigrationEntity) => records.filter((record) => record.entityType === entityType).map((record) => record.payload);
  const initial = parseMigrationBundle({ version: 1, source: cutover.source, parties: payloads("party"), items: payloads("item"), stockLots: payloads("stock_lot"), documents: payloads("sales_document") });
  const units = await migrationUnits(tx, initial);
  const bundle = parseMigrationBundle(initial, units);
  const expected = expectedMigrationReconciliation(bundle, units);
  const actual = await actualReconciliation(tx, ctx, bundle, units);
  return {
    baselineRunId: cutover.baselineRunId,
    finalRunId: cutover.finalRunId,
    cursor: cutover.cursor,
    runIds: runs.map((run) => run.id),
    expected,
    actual,
    differences: reconciliationDifferences(expected, actual),
  };
}

export async function rollbackLegacyMigration(ctx: StockContext, runId: string, reason: string) {
  const cleanReason = cleanText(reason, "Αιτιολογία rollback", 300, true)!;
  return stockTransaction(async (tx) => {
    assertGlobalStockScope(ctx);
    await assertTenantWriteAllowed(tx, ctx.orgId, "BUSINESS");
    const run = await tx.migrationRun.findFirst({ where: { id: runId, orgId: ctx.orgId } });
    if (!run || run.status !== "IMPORTED") throw new WorkflowError("Ο run δεν βρέθηκε ή δεν είναι ενεργός για rollback");
    if (run.cutoverId) throw new WorkflowError("Run που ανήκει σε cutover αναιρείται μόνο με μη καταστροφικό cutover rollback");
    const records = await tx.migrationRecord.findMany({ where: { orgId: ctx.orgId, runId: run.id } });
    const createdIds = new Set(rollbackCreatedIds(records, run.id));
    const created = records.filter((record) => record.localId && createdIds.has(record.localId));
    const documentIds = created.filter((row) => row.entityType === "sales_document").map((row) => row.localId!);
    const lotIds = created.filter((row) => row.entityType === "stock_lot").map((row) => row.localId!);
    const itemIds = created.filter((row) => row.entityType === "item").map((row) => row.localId!);
    const partyIds = created.filter((row) => row.entityType === "party").map((row) => row.localId!);
    const payments = documentIds.length ? await tx.customerPayment.findMany({ where: { orgId: ctx.orgId, allocations: { some: { documentId: { in: documentIds } } } }, include: { allocations: true } }) : [];
    const legacyReference = new Map(created.filter((row) => row.entityType === "sales_document").map((row) => [row.localId!, `LEGACY-${row.externalId}`]));
    if (payments.some((payment) => payment.allocations.length !== 1 || payment.allocations.some((allocation) => !documentIds.includes(allocation.documentId)))) throw new WorkflowError("Ιστορική είσπραξη έχει συνδεθεί και με άλλο παραστατικό· το rollback ακυρώθηκε");
    // Μεταγενέστερες εισπράξεις δεν διαγράφονται, ακόμη κι αν δείχνουν μόνο στο legacy παραστατικό.
    if (payments.some((payment) => payment.reference !== legacyReference.get(payment.allocations[0]?.documentId ?? "") || payment.note !== "Ιστορική είσπραξη χωρίς νέα κίνηση τραπεζικού λογαριασμού")) throw new WorkflowError("Βρέθηκε μεταγενέστερη ή τροποποιημένη πληρωμή· το rollback ακυρώθηκε");
    const extraMovements = lotIds.length ? await tx.stockMovement.count({ where: { orgId: ctx.orgId, lotId: { in: lotIds }, source: { not: "legacy_import" } } }) : 0;
    if (extraMovements) throw new WorkflowError("Οι παρτίδες έχουν μεταγενέστερες επιχειρησιακές κινήσεις· το rollback ακυρώθηκε");
    if (payments.length && (await tx.customerPayment.deleteMany({ where: { orgId: ctx.orgId, id: { in: payments.map((row) => row.id) } } })).count !== payments.length) throw new WorkflowError("Οι ιστορικές εισπράξεις άλλαξαν· το rollback ακυρώθηκε");
    const documents = documentIds.length ? await tx.salesDocument.findMany({ where: { orgId: ctx.orgId, id: { in: documentIds } }, select: { id: true, orderId: true } }) : [];
    if (documents.length !== documentIds.length) throw new WorkflowError("Τα ιστορικά παραστατικά άλλαξαν· το rollback ακυρώθηκε");
    if (documentIds.length) await tx.salesDocument.deleteMany({ where: { orgId: ctx.orgId, id: { in: documentIds } } });
    const orderIds = documents.map((row) => row.orderId);
    if (orderIds.length) await tx.wholesaleOrder.deleteMany({ where: { orgId: ctx.orgId, id: { in: orderIds }, source: "legacy_import", documents: { none: {} } } });
    if (lotIds.length) {
      await tx.stockMovement.deleteMany({ where: { orgId: ctx.orgId, lotId: { in: lotIds }, source: "legacy_import" } });
      if ((await tx.stockLot.deleteMany({ where: { orgId: ctx.orgId, id: { in: lotIds } } })).count !== lotIds.length) throw new WorkflowError("Οι παρτίδες άλλαξαν· το rollback ακυρώθηκε");
    }
    const deletedItems = itemIds.length ? await tx.genericItem.deleteMany({ where: { orgId: ctx.orgId, id: { in: itemIds }, lots: { none: {} }, purchaseLines: { none: {} }, recipeItems: { none: {} }, productionItems: { none: {} } } }) : { count: 0 };
    const deletedParties = partyIds.length ? await tx.party.deleteMany({ where: { orgId: ctx.orgId, id: { in: partyIds }, purchaseDocs: { none: {} } } }) : { count: 0 };
    const remainingItems = new Set((await tx.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: itemIds } }, select: { id: true } })).map((row) => row.id));
    const remainingParties = new Set((await tx.party.findMany({ where: { orgId: ctx.orgId, id: { in: partyIds } }, select: { id: true } })).map((row) => row.id));
    const deletedBusinessIds = new Set([...documentIds, ...lotIds, ...itemIds.filter((id) => !remainingItems.has(id)), ...partyIds.filter((id) => !remainingParties.has(id))]);
    if (deletedItems.count + deletedParties.count + documentIds.length + lotIds.length !== deletedBusinessIds.size) throw new WorkflowError("Ασυμφωνία καταμέτρησης rollback");
    await tx.migrationRecord.updateMany({ where: { orgId: ctx.orgId, runId: run.id, status: "CREATED", localId: { in: [...deletedBusinessIds] } }, data: { status: "ROLLED_BACK", localId: null } });
    const summary = { ...(run.summary as object), rollback: { at: new Date().toISOString(), reason: cleanReason, deleted: deletedBusinessIds.size, protectedUpdated: records.filter((row) => row.status === "UPDATED").length } };
    await tx.migrationRun.update({ where: { id: run.id }, data: { status: "ROLLED_BACK", rolledBackAt: new Date(), summary: json(summary) } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "migration.rollback", entityType: "migration_run", entityId: run.id, reason: cleanReason, metadata: json({ deleted: deletedBusinessIds.size }) });
    return { deleted: deletedBusinessIds.size, protectedUpdated: records.filter((row) => row.status === "UPDATED").length };
  }, { timeout: 120_000, maxWait: 10_000 });
}

export async function migrationRuns(ctx: StockContext) {
  assertGlobalStockScope(ctx);
  return db.migrationRun.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 50 });
}
