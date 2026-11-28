import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { createCredit, createReturn, issueReturn, postImportedCredit } from "./purchase-returns.ts";
import { postPurchase } from "./purchases-db.ts";
import { genericStockBalance } from "./stock-db.ts";
import type { StockContext } from "./stock-scope.ts";

// Επιστροφές σε προμηθευτή και πιστωτικά σε πραγματική PostgreSQL: απόθεμα, όρια ποσότητας/αξίας, 9.3, απομόνωση.
const databaseOptions = { skip: !process.env.DATABASE_URL, timeout: 120_000 };
const KG = 1_000_000; // βασική μονάδα: mg
const PRICE = 500; // 5,00 € ανά κιλό, ΦΠΑ 24%
const lineTotal = (qty: number) => Math.round(qty * PRICE * 1.24);

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const suffix = randomUUID();
  const f = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: `RETURNS ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const foreign = await tx.organization.create({ data: { name: `RETURNS foreign ${suffix}`, vatNumber: `FOREIGN-${suffix}` } });
    const user = await tx.user.create({ data: { email: `returns-${suffix}@example.test`, name: "Επιστροφές integration" } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη επιστροφών" } });
    const store = await tx.store.create({ data: { orgId: org.id, name: "Κατάστημα επιστροφών", address: "Ερμού 1", city: "Αθήνα", postalCode: "10563" } });
    await tx.storeWarehouse.create({ data: { storeId: store.id, warehouseId: warehouse.id, isDefault: true } });
    const supplier = await tx.party.create({ data: { orgId: org.id, name: "Γαλακτοκομική Α.Ε.", roles: ["supplier"], vatNumber: "094014201", address: "Πειραιώς 10", city: "Αθήνα", postalCode: "11853" } });
    const other = await tx.party.create({ data: { orgId: org.id, name: "Άλλος προμηθευτής", roles: ["supplier"], vatNumber: "099999999" } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-returns-mg-${suffix}`, nameEL: "χιλιοστόγραμμο επιστροφών", dimension: "mass", toBase: 1 } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα επιστροφών", baseUnitId: unit.id } });
    const trade = await tx.tradeItem.create({ data: { name: `Γάλα 1kg ${suffix}`, contentQty: KG, contentUnitId: unit.id } });
    const series = await tx.documentSeries.create({ data: { orgId: org.id, docType: "9.3", code: `ΔΑ-${suffix.slice(0, 6)}`, storeId: store.id } });
    const invoice = await tx.purchaseDoc.create({ data: {
      orgId: org.id, supplierId: supplier.id, warehouseId: warehouse.id, number: `ΤΔΑ-${suffix}`, issuedAt: new Date("2026-11-20T09:00:00Z"), createdByName: user.name,
      lines: { create: [{ orgId: org.id, description: "Γάλα 1kg", quantity: 10, unitPriceCents: PRICE, vatRate: 24, genericItemId: generic.id, tradeItemId: trade.id, batchNumber: `L-${suffix}` }] },
    }, include: { lines: true } });
    return {
      orgId: org.id, foreignOrgId: foreign.id, userId: user.id, userName: user.name, warehouseId: warehouse.id, supplierId: supplier.id, otherSupplierId: other.id,
      genericId: generic.id, tradeId: trade.id, unitId: unit.id, ownsUnit: !existingUnit, seriesId: series.id, invoiceId: invoice.id, lineId: invoice.lines[0]!.id,
    };
  });
  await postPurchase(context(f), f.invoiceId);
  return f;
}

function context(f: Fixture, foreign = false): StockContext {
  const permissions: StockContext["permissions"] = ["purchases.read", "purchases.add", "purchases.edit"];
  return {
    orgId: foreign ? f.foreignOrgId : f.orgId, membershipId: "returns-integration", userId: f.userId, userName: f.userName,
    permissions, storeIds: [], warehouseIds: [], can: (p) => permissions.includes(p),
  };
}

const balance = (f: Fixture) => genericStockBalance(db, f.orgId, f.genericId); // μία αποθήκη, όλες οι παρτίδες
const invoiceCredit = async (f: Fixture) => (await db.purchaseDoc.findUniqueOrThrow({ where: { id: f.invoiceId } })).creditCents;

async function cleanup(f: Fixture) {
  const orgIds = [f.orgId, f.foreignOrgId];
  await db.stockMovement.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.purchaseLine.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.purchaseDoc.updateMany({ where: { orgId: { in: orgIds } }, data: { relatedId: null, returnId: null, fiscalDocumentId: null } });
  await db.purchaseDoc.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.fiscalDocument.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.tradeItem.deleteMany({ where: { id: f.tradeId } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

test("μερική επιστροφή: 9.3 σε σειρά, απόθεμα έξω, πιστωτικό που την κλείνει μία φορά", databaseOptions, async () => {
  const f = await fixture();
  try {
    assert.equal(await balance(f), 10 * KG);
    const draft = await createReturn(context(f), f.invoiceId, [{ lineId: f.lineId, quantity: 4 }], "Χαλασμένα");
    assert.equal(await balance(f), 10 * KG, "η πρόχειρη επιστροφή δεν κινεί απόθεμα");

    const issued = await issueReturn(context(f), draft.id, f.seriesId);
    assert.equal(await balance(f), 6 * KG);
    const fiscal = await db.fiscalDocument.findUniqueOrThrow({ where: { id: issued.fiscalId } });
    assert.equal(fiscal.docType, "9.3");
    assert.equal(fiscal.aa, 1);
    assert.equal(fiscal.status, "NOT_SENT");
    assert.equal((await db.documentSeries.findUniqueOrThrow({ where: { id: f.seriesId } })).nextAa, 2);
    await assert.rejects(issueReturn(context(f), draft.id, f.seriesId), /έχει ήδη εκδοθεί/);

    await createCredit(context(f), { invoiceId: f.invoiceId, mydataType: "5.1", number: "ΠΙΣ-1", issuedAt: new Date(), stockMode: "returned", returnId: draft.id });
    assert.equal(await invoiceCredit(f), lineTotal(4));
    assert.equal(await balance(f), 6 * KG, "το πιστωτικό επιστροφής δεν ξαναβγάζει απόθεμα");
    await assert.rejects(
      createCredit(context(f), { invoiceId: f.invoiceId, mydataType: "5.1", number: "ΠΙΣ-2", issuedAt: new Date(), stockMode: "returned", returnId: draft.id }),
      /ήδη πιστωτικό/,
    );
  } finally { await cleanup(f); }
});

test("όριο ποσότητας: υπέρβαση και ταυτόχρονες επιστροφές στην ίδια γραμμή", databaseOptions, async () => {
  const f = await fixture();
  try {
    await assert.rejects(createReturn(context(f), f.invoiceId, [{ lineId: f.lineId, quantity: 11 }], null));
    const results = await Promise.allSettled([
      createReturn(context(f), f.invoiceId, [{ lineId: f.lineId, quantity: 6 }], null),
      createReturn(context(f), f.invoiceId, [{ lineId: f.lineId, quantity: 6 }], null),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "μόνο μία από τις δύο δεσμεύει τα 6 από τα 10");
    // Το πιστωτικό «τώρα» μετρά στο ίδιο όριο: απομένουν 4.
    await assert.rejects(createCredit(context(f), { invoiceId: f.invoiceId, mydataType: "5.1", number: "ΠΙΣ-Χ", issuedAt: new Date(), stockMode: "now", quantities: [{ lineId: f.lineId, quantity: 5 }] }));
  } finally { await cleanup(f); }
});

test("πιστωτικό «τώρα» βγάζει απόθεμα· «μόνο αξία» όχι· όριο υπολοίπου και διπλό MARK", databaseOptions, async () => {
  const f = await fixture();
  try {
    await createCredit(context(f), { invoiceId: f.invoiceId, mydataType: "5.1", number: "ΠΙΣ-Τ", issuedAt: new Date(), stockMode: "now", quantities: [{ lineId: f.lineId, quantity: 3 }], mark: "400000000000001" });
    assert.equal(await balance(f), 7 * KG);
    assert.equal(await invoiceCredit(f), lineTotal(3));

    await createCredit(context(f), { invoiceId: f.invoiceId, mydataType: "5.1", number: "ΠΙΣ-Α", issuedAt: new Date(), stockMode: "value", amountCents: 1000, vatRate: 24 });
    assert.equal(await balance(f), 7 * KG, "το πιστωτικό αξίας δεν αγγίζει το απόθεμα");
    assert.equal(await invoiceCredit(f), lineTotal(3) + 1240);

    const room = lineTotal(10) - lineTotal(3) - 1240;
    await assert.rejects(
      createCredit(context(f), { invoiceId: f.invoiceId, mydataType: "5.1", number: "ΠΙΣ-Υ", issuedAt: new Date(), stockMode: "value", amountCents: room, vatRate: 24 }),
      /ξεπερνά ό,τι απομένει/,
    );
    await assert.rejects(
      createCredit(context(f), { invoiceId: f.invoiceId, mydataType: "5.1", number: "ΠΙΣ-Μ", issuedAt: new Date(), stockMode: "value", amountCents: 100, mark: "400000000000001" }),
      /ίδιο MARK|αυτό το MARK/,
    );
  } finally { await cleanup(f); }
});

test("απομόνωση: ξένη επιχείρηση δεν βλέπει το τιμολόγιο· πιστωτικό myDATA άλλου προμηθευτή απορρίπτεται", databaseOptions, async () => {
  const f = await fixture();
  try {
    await assert.rejects(createReturn(context(f, true), f.invoiceId, [{ lineId: f.lineId, quantity: 1 }], null), /δεν βρέθηκε/);
    await assert.rejects(createCredit(context(f, true), { invoiceId: f.invoiceId, mydataType: "5.1", number: "Χ", issuedAt: new Date(), stockMode: "value", amountCents: 100 }), /δεν βρέθηκε/);

    const imported = await db.purchaseDoc.create({ data: {
      orgId: f.orgId, supplierId: f.otherSupplierId, warehouseId: f.warehouseId, kind: "CREDIT", status: "DRAFT", source: "mydata", mydataType: "5.1", createdByName: "myDATA",
      lines: { create: [{ orgId: f.orgId, description: "Πιστωτικό", quantity: 1, unitPriceCents: 100, vatRate: 24 }] },
    } });
    await assert.rejects(postImportedCredit(context(f), imported.id, f.invoiceId, null), /άλλου προμηθευτή/);
    assert.equal(await invoiceCredit(f), 0);
  } finally { await cleanup(f); }
});
