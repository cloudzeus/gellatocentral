// Κανονικό, ελεγχόμενο export παλιού συστήματος. Χρήματα σε λεπτά και ποσότητες στη βασική μονάδα.
import { createHash } from "node:crypto";
import { z } from "zod";
import { stockCostCents } from "./reports.ts";

const externalId = z.string().trim().min(1).max(100).regex(/^[\w.:-]+$/, "Μόνο γράμματα, αριθμοί, τελεία, άνω-κάτω παύλα και παύλα");
const text = (maximum: number) => z.string().trim().max(maximum);
const cents = z.number().int().nonnegative().max(2_000_000_000);
const quantity = z.number().int().positive().max(2_000_000_000);
const isoDate = z.string().datetime({ offset: true });
const nullableDate = isoDate.nullish();
const lineSchema = z.object({
  itemExternalId: externalId,
  quantityBase: quantity,
  unitPriceCents: cents,
  vatRate: z.number().int().min(0).max(100),
  costHundredths: cents,
}).strict();
const partySchema = z.object({
  externalId,
  name: text(180).min(1),
  roles: z.array(z.enum(["customer", "supplier", "franchisee", "partner"])).min(1).max(8),
  vatNumber: text(30).nullish(),
  countryCode: z.string().trim().length(2).regex(/^[A-Z]{2}$/).default("GR"),
  email: z.string().trim().email().max(160).nullish(),
  phone: text(40).nullish(),
  address: text(200).nullish(),
  city: text(100).nullish(),
  postalCode: text(20).nullish(),
  active: z.boolean().default(true),
}).strict();
const itemSchema = z.object({
  externalId,
  name: text(180).min(1),
  baseUnitCode: text(20).min(1),
  avgCostHundredths: cents.default(0),
  trackStock: z.boolean().default(true),
  gramsPerPiece: quantity.nullish(),
  active: z.boolean().default(true),
}).strict();
const lotSchema = z.object({
  externalId,
  itemExternalId: externalId,
  warehouseId: text(80).min(1),
  batchNumber: text(100).min(1),
  expiresAt: nullableDate,
  quantityBase: quantity,
  unitCostHundredths: cents,
  occurredAt: isoDate,
}).strict();
const documentSchema = z.object({
  externalId,
  customerExternalId: externalId,
  storeId: text(80).min(1),
  warehouseId: text(80).min(1),
  docType: z.enum(["1.1", "5.1"]),
  series: text(30).min(1),
  aa: z.number().int().positive().max(2_000_000_000),
  issuedAt: isoDate,
  dueAt: nullableDate,
  paidCents: cents.default(0),
  netCents: cents,
  vatCents: cents,
  totalCents: cents,
  lines: z.array(lineSchema).min(1).max(500),
}).strict();
export const migrationBundleSchema = z.object({
  version: z.literal(1),
  source: text(80).min(1).max(80),
  parties: z.array(partySchema).max(10_000).default([]),
  items: z.array(itemSchema).max(10_000).default([]),
  stockLots: z.array(lotSchema).max(20_000).default([]),
  documents: z.array(documentSchema).max(10_000).default([]),
}).strict();

export type MigrationBundle = z.infer<typeof migrationBundleSchema>;
export type MigrationUnit = { code: string; dimension: string; toBase: number };
export type MigrationEntity = "party" | "item" | "stock_lot" | "sales_document";
export type MigrationCounts = Record<MigrationEntity, number>;
export type MigrationMoney = { netCents: number; vatCents: number; totalCents: number; outstandingCents: number };
export type MigrationStockRow = { key: string; quantityBase: number; costCents: number };
export type MigrationReconciliation = {
  counts: MigrationCounts;
  money: MigrationMoney;
  stock: MigrationStockRow[];
};

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((row) => canonicalJson(row)).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).filter((key) => row[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function migrationPayloadHash(entityType: MigrationEntity, externalIdValue: string, payload: unknown) {
  return createHash("sha256").update(canonicalJson({ entityType, externalId: externalIdValue, payload })).digest("hex");
}

function duplicates(values: readonly string[], label: string) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    else seen.add(value);
  }
  if (repeated.size) throw new Error(`${label}: διπλά external IDs (${[...repeated].slice(0, 5).join(", ")})`);
}

function safeDate(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Άκυρη ημερομηνία ${label}`);
  return date;
}

/** Validation και υπολογισμοί γίνονται πριν από οποιαδήποτε business εγγραφή. */
export function parseMigrationBundle(input: unknown, units: readonly MigrationUnit[] = []): MigrationBundle {
  const parsed = migrationBundleSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 12).map((issue) => `${issue.path.join(".") || "bundle"}: ${issue.message}`).join(" · ");
    throw new Error(`Μη έγκυρο legacy export: ${details}`);
  }
  const bundle = parsed.data;
  duplicates(bundle.parties.map((row) => row.externalId), "Συναλλασσόμενοι");
  duplicates(bundle.items.map((row) => row.externalId), "Γενικά είδη");
  duplicates(bundle.stockLots.map((row) => row.externalId), "Παρτίδες");
  duplicates(bundle.documents.map((row) => row.externalId), "Παραστατικά");
  const partyIds = new Set(bundle.parties.map((row) => row.externalId));
  const itemIds = new Set(bundle.items.map((row) => row.externalId));
  for (const lot of bundle.stockLots) {
    if (!itemIds.has(lot.itemExternalId)) throw new Error(`Παρτίδα ${lot.externalId}: άγνωστο itemExternalId ${lot.itemExternalId}`);
    safeDate(lot.occurredAt, lot.externalId);
    if (lot.expiresAt) safeDate(lot.expiresAt, lot.externalId);
  }
  const unitByCode = new Map(units.map((unit) => [unit.code, unit]));
  const itemByExternal = new Map(bundle.items.map((item) => [item.externalId, item]));
  for (const item of bundle.items) {
    if (units.length && !unitByCode.has(item.baseUnitCode)) throw new Error(`Είδος ${item.externalId}: άγνωστη ή ανενεργή μονάδα ${item.baseUnitCode}`);
    if (item.baseUnitCode === "pcs" && !item.gramsPerPiece) {
      // Τα τεμάχια δεν απαιτούν βάρος· το πεδίο χρειάζεται μόνο σε μετατροπές παραγωγής.
    }
  }
  for (const document of bundle.documents) {
    if (!partyIds.has(document.customerExternalId)) throw new Error(`Παραστατικό ${document.externalId}: άγνωστος πελάτης ${document.customerExternalId}`);
    safeDate(document.issuedAt, document.externalId);
    if (document.dueAt) safeDate(document.dueAt, document.externalId);
    if (document.paidCents > document.totalCents) throw new Error(`Παραστατικό ${document.externalId}: η είσπραξη υπερβαίνει το σύνολο`);
    if (document.docType === "5.1" && document.paidCents) throw new Error(`Πιστωτικό ${document.externalId}: δεν δέχεται είσπραξη κατά την αρχική μεταφορά`);
    const seenItems = new Set<string>();
    let netCents = 0, vatCents = 0;
    for (const line of document.lines) {
      if (seenItems.has(line.itemExternalId)) throw new Error(`Παραστατικό ${document.externalId}: διπλή γραμμή είδους ${line.itemExternalId}`);
      seenItems.add(line.itemExternalId);
      const item = itemByExternal.get(line.itemExternalId);
      if (!item) throw new Error(`Παραστατικό ${document.externalId}: άγνωστο είδος ${line.itemExternalId}`);
      const unit = unitByCode.get(item.baseUnitCode);
      if (!unit) {
        if (units.length) throw new Error(`Παραστατικό ${document.externalId}: λείπει μονάδα ${item.baseUnitCode}`);
        continue;
      }
      const lineNet = stockCostCents(line.quantityBase, line.unitPriceCents * 100, unit.dimension);
      netCents += lineNet;
      vatCents += Math.round(lineNet * line.vatRate / 100);
    }
    if (units.length && (document.netCents !== netCents || document.vatCents !== vatCents || document.totalCents !== netCents + vatCents)) {
      throw new Error(`Παραστατικό ${document.externalId}: ασυμφωνία συνόλων, αναμενόμενα net ${netCents}, ΦΠΑ ${vatCents}, σύνολο ${netCents + vatCents}`);
    }
  }
  return bundle;
}

export function expectedMigrationReconciliation(bundle: MigrationBundle, units: readonly MigrationUnit[]): MigrationReconciliation {
  const unitByCode = new Map(units.map((unit) => [unit.code, unit]));
  const itemByExternal = new Map(bundle.items.map((item) => [item.externalId, item]));
  const stock = new Map<string, MigrationStockRow>();
  for (const lot of bundle.stockLots) {
    const item = itemByExternal.get(lot.itemExternalId)!;
    const unit = unitByCode.get(item.baseUnitCode);
    if (!unit) throw new Error(`Λείπει μονάδα ${item.baseUnitCode}`);
    const key = `${lot.itemExternalId}:${lot.warehouseId}`;
    const row = stock.get(key) ?? { key, quantityBase: 0, costCents: 0 };
    row.quantityBase += lot.quantityBase;
    row.costCents += stockCostCents(lot.quantityBase, lot.unitCostHundredths, unit.dimension);
    stock.set(key, row);
  }
  const money = { netCents: 0, vatCents: 0, totalCents: 0, outstandingCents: 0 };
  for (const document of bundle.documents) {
    const sign = document.docType === "5.1" ? -1 : 1;
    money.netCents += sign * document.netCents;
    money.vatCents += sign * document.vatCents;
    money.totalCents += sign * document.totalCents;
    if (document.docType === "1.1") money.outstandingCents += document.totalCents - document.paidCents;
  }
  return {
    counts: { party: bundle.parties.length, item: bundle.items.length, stock_lot: bundle.stockLots.length, sales_document: bundle.documents.length },
    money,
    stock: [...stock.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function reconciliationDifferences(expected: MigrationReconciliation, actual: MigrationReconciliation) {
  const differences: string[] = [];
  for (const key of Object.keys(expected.counts) as MigrationEntity[]) {
    if (expected.counts[key] !== actual.counts[key]) differences.push(`${key}: expected ${expected.counts[key]}, actual ${actual.counts[key]}`);
  }
  for (const key of Object.keys(expected.money) as (keyof MigrationMoney)[]) {
    if (expected.money[key] !== actual.money[key]) differences.push(`${key}: expected ${expected.money[key]}, actual ${actual.money[key]}`);
  }
  const actualStock = new Map(actual.stock.map((row) => [row.key, row]));
  for (const row of expected.stock) {
    const found = actualStock.get(row.key);
    if (!found || found.quantityBase !== row.quantityBase || found.costCents !== row.costCents) differences.push(`${row.key}: expected ${row.quantityBase}/${row.costCents}, actual ${found?.quantityBase ?? 0}/${found?.costCents ?? 0}`);
    actualStock.delete(row.key);
  }
  for (const row of actualStock.values()) differences.push(`${row.key}: unexpected ${row.quantityBase}/${row.costCents}`);
  return differences;
}

/** Μόνο εγγραφές που δημιούργησε ο συγκεκριμένος run και δεν έχουν ξαναλλάξει επιτρέπεται να διαγραφούν. */
export function rollbackCreatedIds(records: readonly { runId: string; status: string; localId: string | null }[], runId: string) {
  return records.filter((record) => record.runId === runId && record.status === "CREATED" && record.localId).map((record) => record.localId!);
}
