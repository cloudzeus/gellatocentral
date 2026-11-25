// Κάθε loader ξεκινά με orgId από authenticated context· entityId από URL δεν αρκεί ποτέ για πρόσβαση.
import { db } from "../db";
import { euro } from "../money";
import { analyzeRecipe, RECIPE_TYPES, type MaterialComposition } from "../recipe-analysis";
import { expandRecipe } from "../recipe-graph";
import type { StockContext } from "../stock-scope";
import { stockCostScale } from "../units";
import { buildVitrineSnapshot } from "../vitrine";
import { scheduleShifts } from "../schedule-export";
import type { DocumentBrand, DocumentEntity, DocumentModel, LoadedDocument } from "./model";

const date = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });
const number = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 6 });
const ALLERGENS: Record<string, string> = { milk: "Γάλα", eggs: "Αυγά", nuts: "Ξηροί καρποί", peanuts: "Φιστίκια", gluten: "Γλουτένη", soy: "Σόγια", sesame: "Σουσάμι", celery: "Σέλινο", mustard: "Σινάπι", fish: "Ψάρι", crustaceans: "Οστρακοειδή", molluscs: "Μαλάκια", lupin: "Λούπινο", sulphites: "Θειώδη" };
const brand = (org: DocumentBrand): DocumentBrand => org;
const document = (entityType: DocumentEntity, entityId: string, filename: string, title: string, org: DocumentBrand, sections: DocumentModel["sections"], subtitle?: string): DocumentModel => ({ entityType, entityId, filename, title, subtitle, brand: brand(org), sections });
const quantity = (base: number, dimension: string) => `${number.format(base / stockCostScale(dimension))} ${dimension === "mass" ? "kg" : dimension === "volume" ? "l" : "1000 τεμ."}`;

async function purchaseOrder(ctx: StockContext, id: string): Promise<LoadedDocument | null> {
  const order = await db.purchaseOrder.findFirst({ where: { id, orgId: ctx.orgId }, include: { org: true, lines: true } });
  if (!order) return null;
  const [supplier, warehouse, items] = await Promise.all([
    db.party.findFirst({ where: { id: order.supplierId, orgId: ctx.orgId }, select: { name: true, vatNumber: true } }),
    db.warehouse.findFirst({ where: { id: order.warehouseId, orgId: ctx.orgId }, select: { name: true } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: order.lines.map((line) => line.genericItemId) } }, include: { baseUnit: true } }),
  ]);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  return {
    scope: { warehouseId: order.warehouseId },
    model: document("purchase_order", id, `purchase-order-${order.number}`, `Παραγγελία προμηθευτή ${order.number}`, order.org, [
      { title: "Στοιχεία παραγγελίας", fields: [
        { label: "Προμηθευτής", value: supplier?.name ?? "Προμηθευτής" },
        { label: "ΑΦΜ προμηθευτή", value: supplier?.vatNumber ?? "—" },
        { label: "Αποθήκη", value: warehouse?.name ?? "—" },
        { label: "Αναμενόμενη παράδοση", value: order.expectedAt ? date.format(order.expectedAt) : "—" },
        { label: "Κατάσταση", value: order.status },
      ], ...(order.note ? { paragraphs: [order.note] } : {}) },
      { title: "Είδη", table: { headers: ["Είδος", "Ποσότητα", "Τιμή", "ΦΠΑ"], rows: order.lines.map((line) => { const item = itemMap.get(line.genericItemId); return [item?.name ?? "Είδος", quantity(line.orderedBaseQty, item?.baseUnit.dimension ?? "count"), euro(line.unitPriceCents), `${line.vatRate}%`]; }) } },
      { title: "Σύνολα", fields: [{ label: "Καθαρή αξία", value: euro(order.netCents) }, { label: "ΦΠΑ", value: euro(order.vatCents) }, { label: "Σύνολο", value: euro(order.totalCents) }] },
    ]),
  };
}

async function productionBatch(ctx: StockContext, id: string): Promise<LoadedDocument | null> {
  const batch = await db.productionBatch.findFirst({ where: { id, orgId: ctx.orgId }, include: { org: true, recipe: true, warehouse: true, items: { include: { genericItem: { include: { baseUnit: true, composition: true } } } } } });
  if (!batch) return null;
  const output = batch.outputLotId ? await db.stockLot.findFirst({ where: { id: batch.outputLotId, orgId: ctx.orgId }, include: { genericItem: true } }) : null;
  const lines = new Map<string, { name: string; quantity: number; dimension: string }>();
  const contains = new Set<string>(), traces = new Set<string>();
  for (const item of batch.items) {
    const row = lines.get(item.genericItemId) ?? { name: item.genericItem.name, quantity: 0, dimension: item.genericItem.baseUnit.dimension };
    row.quantity += item.quantity;
    lines.set(item.genericItemId, row);
    item.genericItem.composition?.allergensContains.forEach((key) => contains.add(key));
    item.genericItem.composition?.allergensTraces.forEach((key) => traces.add(key));
  }
  contains.forEach((key) => traces.delete(key));
  return {
    scope: { warehouseIds: [batch.warehouseId, batch.destinationWarehouseId ?? batch.warehouseId] },
    model: document("production_batch", id, `batch-${batch.batchNumber}`, `Ετικέτα παρτίδας ${batch.batchNumber}`, batch.org, [
      { title: "Στοιχεία παρτίδας", fields: [
        { label: "Συνταγή", value: batch.recipe.name }, { label: "Αποθήκη", value: batch.warehouse.name },
        { label: "Παραγωγή", value: date.format(batch.producedAt) }, { label: "Πραγματική απόδοση", value: `${number.format(batch.quantityGrams)} g` },
        { label: "Λήξη", value: output?.expiresAt ? date.format(output.expiresAt) : "Δεν έχει οριστεί" },
        { label: "Ποιοτική κατάσταση", value: output?.holdStatus ?? "Χωρίς output lot" },
      ], ...(output ? { paragraphs: [`Παραγόμενο είδος: ${output.genericItem.name}`] } : {}) },
      { title: "Συστατικά που καταναλώθηκαν", table: { headers: ["Είδος", "Ποσότητα"], rows: [...lines.values()].map((line) => [line.name, quantity(line.quantity, line.dimension)]) } },
      { title: "Αλλεργιογόνα", paragraphs: [`Περιέχει: ${contains.size ? [...contains].map((key) => ALLERGENS[key] ?? key).join(", ") : "Δεν έχει δηλωθεί αλλεργιογόνο στα τεκμηριωμένα συστατικά."}`, ...(traces.size ? [`Μπορεί να περιέχει ίχνη: ${[...traces].map((key) => ALLERGENS[key] ?? key).join(", ")}`] : [])] },
    ]),
  };
}

const percentageFields = { fatPm: "fatPct", msnfPm: "msnfPct", sucrosePm: "sucrosePct", dextrosePm: "dextrosePct", glucoseSyrupPm: "glucoseSyrupPct", invertSugarPm: "invertSugarPct", fructosePm: "fructosePct", lactosePm: "lactosePct", cocoaNonfatPm: "cocoaNonfatPct", stabilizerPm: "stabilizerPct", emulsifierPm: "emulsifierPct", saltPm: "saltPct", alcoholPm: "alcoholPct", otherSolidsPm: "otherSolidsPct", proteinAvailablePm: "proteinAvailablePct", otherProteinPm: "otherProteinPct", fiberPm: "fiberPct", pacOverridePm: "pacOverride", podOverridePm: "podOverride", totalSolidsOverridePm: "totalSolidsOverride" } as const;
function composition(input: Record<string, unknown> | null | undefined): MaterialComposition {
  const result: MaterialComposition = { acidityLevel: String(input?.acidityLevel ?? "none"), containsStarch: input?.containsStarch === true, containsCocoa: input?.containsCocoa === true, glucoseDe: typeof input?.glucoseDe === "number" ? input.glucoseDe : null };
  for (const [source, target] of Object.entries(percentageFields)) { const value = input?.[source]; (result as Record<string, unknown>)[target] = typeof value === "number" ? value / 100 : null; }
  return result;
}

async function recipe(ctx: StockContext, id: string): Promise<LoadedDocument | null> {
  const recipes = await db.recipe.findMany({ where: { orgId: ctx.orgId }, include: { org: true, items: { include: { genericItem: { include: { composition: true } } }, orderBy: { sortOrder: "asc" } } } });
  const root = recipes.find((row) => row.id === id);
  if (!root) return null;
  const expanded = expandRecipe(recipes, root.id, root.batchGrams);
  const byGeneric = new Map(recipes.flatMap((row) => row.items.map((item) => [item.genericItemId, item.genericItem] as const)));
  const lines = expanded.lines.map((line) => { const generic = byGeneric.get(line.genericItemId)!; return { name: generic.name, grams: line.grams, material: composition(generic.composition as unknown as Record<string, unknown> | null) }; });
  const analysis = analyzeRecipe(lines, root.type);
  const snapshot = buildVitrineSnapshot({ productName: root.name, recipeName: root.name, batchGrams: root.batchGrams, priceCents: 0, lines });
  return { model: document("recipe", id, `recipe-${root.id}`, `Τεχνικό δελτίο — ${root.name}`, root.org, [
    { title: "Συστατικά μετά την ανάπτυξη υποσυνταγών", table: { headers: ["Α΄ ύλη", "Ποσότητα", "% δόσης"], rows: lines.map((line) => [line.name, `${number.format(line.grams)} g`, `${number.format(line.grams * 100 / root.batchGrams)}%`]) } },
    { title: "Τεχνική ανάλυση δόσης", fields: [{ label: "Ολικά στερεά", value: `${number.format(analysis.totalSolids)}%` }, { label: "Λιπαρά", value: `${number.format(analysis.fat)}%` }, { label: "Σάκχαρα", value: `${number.format(analysis.sugars)}%` }, { label: "PAC / POD", value: `${number.format(analysis.pac)} / ${number.format(analysis.pod)}` }] },
    { title: "Δήλωση αλλεργιογόνων", paragraphs: [`Περιέχει: ${snapshot.allergensContains.length ? snapshot.allergensContains.map((key) => ALLERGENS[key] ?? key).join(", ") : "Δεν έχει δηλωθεί αλλεργιογόνο στα τεκμηριωμένα συστατικά."}`, ...(snapshot.allergensTraces.length ? [`Μπορεί να περιέχει ίχνη: ${snapshot.allergensTraces.map((key) => ALLERGENS[key] ?? key).join(", ")}`] : []), "Η δήλωση προέρχεται από τα αποθηκευμένα δεδομένα σύνθεσης. Ελέγχεται πριν από κάθε αλλαγή προμηθευτή ή συνταγής."] },
    ...(root.notes ? [{ title: "Σημειώσεις παραγωγής", paragraphs: [root.notes] }] : []),
  ], `${RECIPE_TYPES.find((row) => row.value === root.type)?.label ?? root.type} · δόση ${number.format(root.batchGrams)} g`) };
}

function athensMonthStart(year: number, month: number) {
  const utc = Date.UTC(year, month - 1, 1);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utc));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
  return new Date(utc - (asUtc - utc));
}

export function monthBounds(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]);
  if (year < 2000 || year > 2200) return null;
  const fromAt = athensMonthStart(year, month);
  const toAt = athensMonthStart(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
  return { fromAt, toAt };
}

async function haccpMonthly(ctx: StockContext, id: string): Promise<LoadedDocument | null> {
  const bounds = monthBounds(id);
  if (!bounds) return null;
  const org = await db.organization.findFirst({ where: { id: ctx.orgId } });
  if (!org) return null;
  const scope = ctx.storeIds.length ? { OR: [{ storeId: { in: [...ctx.storeIds] } }, { storeId: null }] } : {};
  const [records, lotChecks] = await Promise.all([
    db.haccpRecord.findMany({ where: { orgId: ctx.orgId, occurredAt: { gte: bounds.fromAt, lt: bounds.toAt }, ...scope }, include: { store: { select: { name: true } } }, orderBy: { occurredAt: "asc" } }),
    // Το HaccpLotCheck δεν έχει storeId· σε μερικό scope αποκλείεται αντί να διαρρεύσουν καθολικές μετρήσεις.
    ctx.storeIds.length || ctx.warehouseIds.length ? Promise.resolve([]) : db.haccpLotCheck.findMany({ where: { orgId: ctx.orgId, createdAt: { gte: bounds.fromAt, lt: bounds.toAt } }, orderBy: { createdAt: "asc" } }),
  ]);
  const deviations = records.filter((record) => record.result === "DEVIATION").length + lotChecks.filter((check) => !check.conforming).length;
  return { model: document("haccp_monthly", id, `haccp-${id}`, `Μηνιαία αναφορά HACCP ${id}`, org, [
    { title: "Σύνοψη", fields: [{ label: "Περίοδος", value: `${date.format(bounds.fromAt)} — ${date.format(bounds.toAt)}` }, { label: "Καταχωρίσεις", value: String(records.length) }, { label: "Έλεγχοι παρτίδων", value: String(lotChecks.length) }, { label: "Αποκλίσεις", value: String(deviations) }] },
    { title: "Ημερολόγιο τεκμηρίωσης", table: { headers: ["Ημερομηνία", "Έντυπο", "Κατάστημα", "Υπεύθυνος", "Αποτέλεσμα"], rows: records.map((record) => [date.format(record.occurredAt), record.templateId, record.store?.name ?? "Όλη η επιχείρηση", record.responsibleName, record.result]) } },
    { title: "Έλεγχοι παρτίδων", table: { headers: ["Ημερομηνία", "Είδος", "Μέτρηση", "Κατάσταση", "Διορθωτική ενέργεια"], rows: lotChecks.map((check) => [date.format(check.createdAt), check.kind, `${check.measuredValue ?? "—"} ${check.unit ?? ""}`, check.conforming ? "Συμμορφούμενο" : "Απόκλιση", check.correctiveAction ?? "—"]) } },
  ]) };
}

async function salesDocument(ctx: StockContext, id: string): Promise<LoadedDocument | null> {
  const doc = await db.salesDocument.findFirst({ where: { id, orgId: ctx.orgId }, include: { org: true, lines: true, order: { select: { number: true } } } });
  if (!doc) return null;
  const items = await db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: doc.lines.map((line) => line.genericItemId) } }, include: { baseUnit: true } });
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const snapshot = doc.customerSnapshot && typeof doc.customerSnapshot === "object" && !Array.isArray(doc.customerSnapshot) ? doc.customerSnapshot as Record<string, unknown> : {};
  const types: Record<string, string> = { "1.1": "Τιμολόγιο πώλησης", "5.1": "Πιστωτικό τιμολόγιο", "9.3": "Δελτίο αποστολής" };
  return {
    scope: { storeId: doc.storeId, warehouseId: doc.warehouseId },
    model: document("sales_document", id, `sales-${doc.series}-${doc.aa}`, `${types[doc.docType] ?? "Παραστατικό"} ${doc.series}-${doc.aa}`, doc.org, [
      { title: "Στοιχεία παραστατικού", fields: [{ label: "Πελάτης", value: String(snapshot.name ?? "Πελάτης") }, { label: "ΑΦΜ πελάτη", value: String(snapshot.vatNumber ?? "—") }, { label: "Παραγγελία", value: doc.order.number }, { label: "Έκδοση", value: date.format(doc.issuedAt) }, { label: "Κατάσταση", value: doc.status === "CANCELLED" ? "Ακυρωμένο" : "Ενεργό" }] },
      { title: "Γραμμές", table: { headers: ["Είδος", "Ποσότητα", "Τιμή", "ΦΠΑ"], rows: doc.lines.map((line) => { const item = itemMap.get(line.genericItemId); return [item?.name ?? "Είδος", quantity(line.quantityBase, item?.baseUnit.dimension ?? "count"), euro(line.unitPriceCents), `${line.vatRate}%`]; }) } },
      { title: "Σύνολα", fields: [{ label: "Καθαρή αξία", value: euro(doc.netCents) }, { label: "ΦΠΑ", value: euro(doc.vatCents) }, { label: "Σύνολο", value: euro(doc.totalCents) }] },
      ...(doc.cancellationReason ? [{ title: "Ακύρωση", paragraphs: [doc.cancellationReason] }] : []),
    ]),
  };
}

async function schedulePublication(ctx: StockContext, id: string): Promise<LoadedDocument | null> {
  const publication = await db.schedulePublication.findFirst({ where: { id, orgId: ctx.orgId }, include: { org: true } });
  if (!publication || (!publication.storeId && (ctx.storeIds.length || ctx.warehouseIds.length))) return null;
  const shifts = scheduleShifts(publication.snapshot);
  return {
    scope: publication.storeId ? { storeId: publication.storeId } : {},
    schedule: { snapshot: publication.snapshot, version: publication.version, fromAt: publication.fromAt, toAt: publication.toAt },
    model: document("schedule_publication", id, `schedule-v${publication.version}`, `Πρόγραμμα βαρδιών · έκδοση ${publication.version}`, publication.org, [
      { title: "Δημοσίευση", fields: [{ label: "Περίοδος", value: `${date.format(publication.fromAt)} — ${date.format(publication.toAt)}` }, { label: "Δημοσιεύθηκε από", value: publication.publishedByName }, { label: "Ημερομηνία", value: date.format(publication.publishedAt) }] },
      { title: "Βάρδιες", table: { headers: ["Εργαζόμενος", "Έναρξη", "Λήξη", "Διάλειμμα", "Τμήμα / κατάστημα"], rows: shifts.map((shift) => [shift.employeeName, date.format(new Date(shift.startsAt)), date.format(new Date(shift.endsAt)), `${shift.breakMinutes} λεπτά`, [shift.departmentName, shift.storeName].filter(Boolean).join(" / ") || "—"]) } },
    ]),
  };
}

const WHOLESALE_QUOTE_STATUS = { DRAFT: "Πρόχειρη", SENT: "Σημειώθηκε ως απεσταλμένη", ACCEPTED: "Αποδεκτή", REJECTED: "Απορριφθείσα", EXPIRED: "Ληγμένη" } as const;

export type WholesaleQuoteDocumentData = {
  id: string;
  storeId: string;
  warehouseId: string;
  number: string;
  status: keyof typeof WHOLESALE_QUOTE_STATUS;
  validUntil: Date;
  neededAt: Date | null;
  note: string | null;
  netCents: number;
  vatCents: number;
  totalCents: number;
  customerSnapshot: unknown;
  sentAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  expiredAt: Date | null;
  convertedAt: Date | null;
  createdAt: Date;
  org: DocumentBrand;
  storeName: string | null;
  warehouseName: string | null;
  lines: readonly { description: string; unitLabel: string; unitScale: number; quantityBase: number; unitPriceCents: number; vatRate: number }[];
};

const quoteSnapshotText = (snapshot: unknown, key: string) => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "";
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
};

/** Το έντυπο διαβάζει μόνο τα παγωμένα δεδομένα της προσφοράς, όχι μελλοντικούς τιμοκαταλόγους ή είδη. */
export function buildWholesaleQuoteDocument(quote: WholesaleQuoteDocumentData): LoadedDocument {
  const customerAddress = [quoteSnapshotText(quote.customerSnapshot, "address"), [quoteSnapshotText(quote.customerSnapshot, "postalCode"), quoteSnapshotText(quote.customerSnapshot, "city")].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—";
  return {
    scope: { storeId: quote.storeId, warehouseId: quote.warehouseId },
    model: document("wholesale_quote", quote.id, `wholesale-quote-${quote.number}`, `Προσφορά χονδρικής ${quote.number}`, quote.org, [
      { title: "Στοιχεία προσφοράς", fields: [
        { label: "Αριθμός", value: quote.number }, { label: "Κατάσταση", value: WHOLESALE_QUOTE_STATUS[quote.status] },
        { label: "Δημιουργία", value: date.format(quote.createdAt) }, { label: "Ισχύς έως", value: date.format(quote.validUntil) },
        { label: "Επιθυμητή παράδοση", value: quote.neededAt ? date.format(quote.neededAt) : "—" },
        { label: "Κατάστημα", value: quote.storeName ?? "—" }, { label: "Αποθήκη", value: quote.warehouseName ?? "—" },
        ...(quote.sentAt ? [{ label: "Σήμανση ως απεσταλμένη", value: date.format(quote.sentAt) }] : []),
        ...(quote.acceptedAt ? [{ label: "Αποδοχή", value: date.format(quote.acceptedAt) }] : []),
        ...(quote.rejectedAt ? [{ label: "Απόρριψη", value: date.format(quote.rejectedAt) }] : []),
        ...(quote.expiredAt ? [{ label: "Καταχώριση λήξης", value: date.format(quote.expiredAt) }] : []),
        ...(quote.convertedAt ? [{ label: "Μετατροπή σε παραγγελία", value: date.format(quote.convertedAt) }] : []),
      ] },
      { title: "Πελάτης", fields: [
        { label: "Επωνυμία", value: quoteSnapshotText(quote.customerSnapshot, "name") || "Πελάτης" },
        { label: "ΑΦΜ", value: quoteSnapshotText(quote.customerSnapshot, "vatNumber") || "—" },
        { label: "Χώρα", value: quoteSnapshotText(quote.customerSnapshot, "countryCode") || "—" },
        { label: "Διεύθυνση", value: customerAddress },
      ] },
      { title: "Γραμμές προσφοράς", table: { headers: ["Είδος", "Ποσότητα", "Τιμή προ ΦΠΑ", "ΦΠΑ", "Καθαρή αξία", "Αξία ΦΠΑ", "Σύνολο"], rows: quote.lines.map((line) => {
        const netCents = Math.round(line.quantityBase * line.unitPriceCents / line.unitScale);
        const vatCents = Math.round(netCents * line.vatRate / 100);
        return [line.description, `${number.format(line.quantityBase / line.unitScale)} ${line.unitLabel}`, `${euro(line.unitPriceCents)} / ${line.unitLabel}`, `${line.vatRate}%`, euro(netCents), euro(vatCents), euro(netCents + vatCents)];
      }) } },
      { title: "Σύνολα", fields: [{ label: "Καθαρή αξία", value: euro(quote.netCents) }, { label: "ΦΠΑ", value: euro(quote.vatCents) }, { label: "Σύνολο", value: euro(quote.totalCents) }] },
      ...(quote.note ? [{ title: "Σημειώσεις", paragraphs: [quote.note] }] : []),
      ...(quote.rejectionReason ? [{ title: "Αιτιολογία απόρριψης", paragraphs: [quote.rejectionReason] }] : []),
    ], [quote.storeName, quote.warehouseName].filter(Boolean).join(" · ") || undefined),
  };
}

async function wholesaleQuote(ctx: StockContext, id: string): Promise<LoadedDocument | null> {
  const quote = await db.wholesaleQuote.findFirst({ where: { id, orgId: ctx.orgId }, include: { org: true, lines: { orderBy: { id: "asc" } } } });
  if (!quote) return null;
  const [store, warehouse] = await Promise.all([
    db.store.findFirst({ where: { id: quote.storeId, orgId: ctx.orgId }, select: { name: true } }),
    db.warehouse.findFirst({ where: { id: quote.warehouseId, orgId: ctx.orgId }, select: { name: true } }),
  ]);
  return buildWholesaleQuoteDocument({ ...quote, storeName: store?.name ?? null, warehouseName: warehouse?.name ?? null });
}

export async function loadDocument(ctx: StockContext, entityType: DocumentEntity, entityId: string): Promise<LoadedDocument | null> {
  if (!entityId || entityId.length > 120) return null;
  switch (entityType) {
    case "purchase_order": return purchaseOrder(ctx, entityId);
    case "production_batch": return productionBatch(ctx, entityId);
    case "recipe": return recipe(ctx, entityId);
    case "haccp_monthly": return haccpMonthly(ctx, entityId);
    case "sales_document": return salesDocument(ctx, entityId);
    case "schedule_publication": return schedulePublication(ctx, entityId);
    case "wholesale_quote": return wholesaleQuote(ctx, entityId);
  }
}
