import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { approveWaste, consumeSale, correctCountLine, customerReturn, recordWaste, reverseSale } from "./consumption.ts";
import { theoreticalVsActual } from "./consumption-reports.ts";
import { db } from "./db.ts";
import { completeCredit } from "./documents/credit.ts";
import { completeSale } from "./pos.ts";
import { postStockMovement, stockBalance } from "./stock-db.ts";
import { createStockCount, finalizeStockCount, updateStockCountMeasurements } from "./stock-counts.ts";
import type { StockContext } from "./stock-scope.ts";
import { stockTransaction } from "./stock-transaction.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const KG = 1_000_000;

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `CONS ${suffix}`, vatNumber: `CONS-${suffix}` } });
  const user = await db.user.create({ data: { email: `cons-${suffix}@example.test`, name: "Υπεύθυνος κατανάλωσης" } });
  const mg = await db.unit.findFirst({ where: { code: "mg", toBase: 1 } }) ?? await db.unit.create({ data: { code: `t-mg-${suffix}`, nameEL: "mg δοκιμής", dimension: "mass", toBase: 1 } });
  const pcs = await db.unit.findFirst({ where: { dimension: "count", toBase: 1 } }) ?? await db.unit.create({ data: { code: `t-pcs-${suffix}`, nameEL: "τεμ. δοκιμής", dimension: "count", toBase: 1 } });
  const ml = await db.unit.findFirst({ where: { dimension: "volume", toBase: 1 } }) ?? await db.unit.create({ data: { code: `t-ml-${suffix}`, nameEL: "ml δοκιμής", dimension: "volume", toBase: 1 } });
  const store = await db.store.create({ data: { orgId: org.id, name: "Κατάστημα κατανάλωσης" } });
  const warehouse = await db.warehouse.create({ data: { orgId: org.id, name: "Βιτρίνα" } });
  await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: warehouse.id, isDefault: true } });
  const device = await db.device.create({ data: { orgId: org.id, storeId: store.id, name: "Ταμείο", kind: "POS_ANDROID", series: `C${suffix.slice(0, 6)}` } });
  const generic = (name: string, unitId: string, extra: Record<string, unknown> = {}) => db.genericItem.create({ data: { orgId: org.id, name: `${name} ${suffix.slice(0, 4)}`, baseUnitId: unitId, avgCostHundredths: 1_000, ...extra } });
  const cup = await generic("Κύπελλο", pcs.id, { avgCostHundredths: 500_000 }); // 0,05 €/τεμ.
  const spoon = await generic("Κουτάλι", pcs.id, { avgCostHundredths: 100_000 });
  const sauce = await generic("Σάλτσα", mg.id, { avgCostHundredths: 80_000 }); // 8 €/kg
  const strawberry = await generic("Φράουλα", mg.id, { consumptionSource: "COUNT", avgCostHundredths: 60_000 });
  const crepe = await generic("Κρέπα", mg.id, { madeToOrder: true });
  const flour = await generic("Αλεύρι", mg.id, { avgCostHundredths: 10_000 });
  const milk = await generic("Γάλα", ml.id, { avgCostHundredths: 12_000 });
  const egg = await generic("Αυγό", pcs.id, { gramsPerPiece: 55, avgCostHundredths: 2_500_000 });
  const butter = await generic("Βούτυρο", mg.id, { avgCostHundredths: 90_000 });
  await db.recipe.create({ data: { orgId: org.id, name: `Κρέπα ${suffix}`, batchGrams: 1000, outputGenericItemId: crepe.id, items: { create: [{ orgId: org.id, genericItemId: flour.id, grams: 300 }, { orgId: org.id, genericItemId: milk.id, grams: 500 }, { orgId: org.id, genericItemId: egg.id, grams: 165 }, { orgId: org.id, genericItemId: butter.id, grams: 35 }] } } });
  const vat = await db.vatRate.upsert({ where: { name: "CONS 13%" }, update: {}, create: { name: "CONS 13%", rate: 13 } });
  const category = await db.category.create({ data: { orgId: org.id, name: "Παγωτά" } });
  const product = (name: string) => db.product.create({ data: { orgId: org.id, categoryId: category.id, vatRateId: vat.id, name, priceCents: 400 } });
  const cupProduct = await product("Κύπελλο 2 μπάλες");
  const crepeProduct = await product("Κρέπα");
  const noRecipe = await product("Χωρίς συνταγή");
  const flavours = await db.modifierGroup.create({ data: { orgId: org.id, name: "Γεύσεις", kind: "REQUIRED", options: { create: [{ name: "Φράουλα" }] } }, include: { options: true } });
  const toppings = await db.modifierGroup.create({ data: { orgId: org.id, name: "Έξτρα", kind: "EXTRA", options: { create: [{ name: "Σάλτσα", priceCents: 50 }] } }, include: { options: true } });
  await db.productModifierGroup.createMany({ data: [{ productId: cupProduct.id, groupId: flavours.id, pick: 2 }, { productId: cupProduct.id, groupId: toppings.id }] });
  const recipe = (data: { productId?: string; modifierOptionId?: string }, lines: [string, number][]) => db.salesRecipe.create({ data: { orgId: org.id, ...data, validFrom: new Date("2026-01-01T00:00:00Z"), createdByName: user.name, lines: { create: lines.map(([genericItemId, quantityBase]) => ({ orgId: org.id, genericItemId, quantityBase })) } } });
  await recipe({ productId: cupProduct.id }, [[cup.id, 1], [spoon.id, 1]]);
  await recipe({ modifierOptionId: flavours.options[0]!.id }, [[strawberry.id, 70_000]]);
  await recipe({ modifierOptionId: toppings.options[0]!.id }, [[sauce.id, 20_000]]);
  await recipe({ productId: crepeProduct.id }, [[crepe.id, 200_000]]);
  return { suffix, orgId: org.id, userId: user.id, userName: user.name, storeId: store.id, warehouseId: warehouse.id, deviceId: device.id, cup, spoon, sauce, strawberry, flour, milk, egg, butter, cupProduct, crepeProduct, noRecipe, strawberryOption: flavours.options[0]!, sauceOption: toppings.options[0]! };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
  await db.stockCountLine.deleteMany({ where: { orgId: f.orgId } });
  await db.stockCount.deleteMany({ where: { orgId: f.orgId } });
  await db.fiscalDocument.deleteMany({ where: { orgId: f.orgId } });
  await db.sale.deleteMany({ where: { orgId: f.orgId } }); // SaleLine → Product δεν σβήνει αλυσιδωτά
  await db.salesRecipe.deleteMany({ where: { orgId: f.orgId } }); // οι γραμμές κρατούν το είδος (Restrict)
  await db.recipeItem.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  await db.user.deleteMany({ where: { id: f.userId } });
}

const actor = (f: Fixture) => ({ id: f.userId, name: f.userName });
async function stock(f: Fixture, genericItemId: string, quantity: number, extra: { lotId?: string | null; unitCostHundredths?: number } = {}) {
  await stockTransaction((tx) => postStockMovement(tx, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId, lotId: extra.lotId ?? null, quantity, unitCostHundredths: extra.unitCostHundredths, source: "manual", actor: actor(f) }));
}
const balance = (f: Fixture, genericItemId: string, lotId: string | null = null) => stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId, lotId });
const total = async (f: Fixture, genericItemId: string) => (await db.stockMovement.aggregate({ where: { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId }, _sum: { quantity: true } }))._sum.quantity ?? 0;
const demand = (f: Fixture, genericItemId: string, day: string) => db.demandDaily.findUnique({ where: { orgId_warehouseId_genericItemId_day: { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId, day: new Date(`${day}T00:00:00Z`) } } });

async function sale(f: Fixture, lines: { productId: string; quantity: number; options?: { id?: string; name: string; priceCents: number }[]; kind?: string }[], issuedAt = new Date("2026-11-20T10:00:00Z"), status: "COMPLETED" | "AWAITING_PAYMENT" = "COMPLETED") {
  return db.sale.create({
    data: { orgId: f.orgId, storeId: f.storeId, deviceId: f.deviceId, status, issuedAt, series: "C", aa: Math.floor(Math.random() * 1e9), totalCents: 400,
      lines: { create: lines.map((line) => ({ productId: line.productId, name: "γραμμή", quantity: line.quantity, unitPriceCents: 400, vatRate: 13, options: line.options, kind: line.kind ?? "SALE" })) } },
    include: { lines: true },
  });
}
const ctx = (f: Fixture): StockContext => ({ orgId: f.orgId, membershipId: "consumption-integration", userId: f.userId, userName: f.userName, permissions: [], storeIds: [], warehouseIds: [], can: () => true });

test("PostgreSQL 4α: κύπελλο 2 μπάλες + topping κινεί κύπελλο, κουτάλι, σάλτσα με FEFO· η γεύση μένει θεωρητική· idempotent", databaseOptions, async () => {
  const f = await fixture();
  try {
    await stock(f, f.cup.id, 10);
    await stock(f, f.spoon.id, 10);
    await stock(f, f.strawberry.id, 4 * KG);
    const late = await db.stockLot.create({ data: { orgId: f.orgId, genericItemId: f.sauce.id, warehouseId: f.warehouseId, batchNumber: "L2", expiresAt: new Date("2027-03-01") } });
    const early = await db.stockLot.create({ data: { orgId: f.orgId, genericItemId: f.sauce.id, warehouseId: f.warehouseId, batchNumber: "L1", expiresAt: new Date("2027-01-01") } });
    await stock(f, f.sauce.id, 15_000, { lotId: early.id });
    await stock(f, f.sauce.id, 100_000, { lotId: late.id });
    const s = await sale(f, [{ productId: f.cupProduct.id, quantity: 1, options: [{ id: f.strawberryOption.id, name: "Φράουλα", priceCents: 0 }, { id: f.strawberryOption.id, name: "Φράουλα", priceCents: 0 }, { name: "Σάλτσα", priceCents: 50 }] }]);
    const [result] = await db.$transaction((tx) => consumeSale(tx, { orgId: f.orgId, saleId: s.id }));
    assert.equal(result!.status, "POSTED");
    assert.equal(await total(f, f.cup.id), 9);
    assert.equal(await total(f, f.spoon.id), 9);
    assert.equal(await balance(f, f.sauce.id, early.id), 0, "FEFO: πρώτα η παρτίδα που λήγει νωρίτερα");
    assert.equal(await balance(f, f.sauce.id, late.id), 95_000);
    assert.equal(await total(f, f.strawberry.id), 4 * KG, "η γεύση (COUNT) δεν κινείται στην πώληση");
    assert.equal((await demand(f, f.strawberry.id, "2026-11-20"))?.theoreticalBase, 140_000);
    assert.equal((await demand(f, f.cup.id, "2026-11-20"))?.consumedBase, 1);
    assert.equal(result!.costCents, 5 + 1 + 16, "κύπελλο 0,05 + κουτάλι 0,01 + σάλτσα 20 g × 8 €/kg");
    // ξανά η ίδια πώληση (π.χ. retry): καμία διπλή κίνηση ή ζήτηση
    await db.$transaction((tx) => consumeSale(tx, { orgId: f.orgId, saleId: s.id }));
    assert.equal(await total(f, f.cup.id), 9);
    assert.equal((await demand(f, f.strawberry.id, "2026-11-20"))?.theoreticalBase, 140_000);

    // 11.4: ίδιες παρτίδες, ίδιο κόστος, ζήτηση πίσω στο μηδέν· δεύτερο 11.4 δεν ξαναγράφει
    await db.$transaction((tx) => reverseSale(tx, { orgId: f.orgId, saleId: s.id }));
    await db.$transaction((tx) => reverseSale(tx, { orgId: f.orgId, saleId: s.id }));
    assert.equal(await total(f, f.cup.id), 10);
    assert.equal(await balance(f, f.sauce.id, early.id), 15_000);
    const original = await db.stockMovement.findFirst({ where: { orgId: f.orgId, genericItemId: f.sauce.id, lotId: early.id, quantity: -15_000 } });
    const reversed = await db.stockMovement.findFirst({ where: { orgId: f.orgId, genericItemId: f.sauce.id, lotId: early.id, quantity: 15_000, source: "consumption" } });
    assert.equal(reversed?.unitCostHundredths, original?.unitCostHundredths);
    assert.equal((await demand(f, f.strawberry.id, "2026-11-20"))?.theoreticalBase, 0);
    assert.equal((await demand(f, f.cup.id, "2026-11-20"))?.consumedBase, 0);
    assert.equal(await db.consumptionEvent.count({ where: { orgId: f.orgId, kind: "VOID" } }), 1);
  } finally { await cleanup(f); }
});

test("PostgreSQL 4α: κρέπα σπάει σε υλικά· χωρίς συνταγή και έλλειμμα → NEEDS_REVIEW χωρίς να μπλοκάρει", databaseOptions, async () => {
  const f = await fixture();
  try {
    await stock(f, f.flour.id, 1 * KG);
    await stock(f, f.milk.id, 1000);
    await stock(f, f.butter.id, 100_000);
    // κανένα αυγό: έλλειμμα
    const s = await sale(f, [{ productId: f.crepeProduct.id, quantity: 2 }, { productId: f.noRecipe.id, quantity: 1 }]);
    const results = await db.$transaction((tx) => consumeSale(tx, { orgId: f.orgId, saleId: s.id }));
    assert.equal(await total(f, f.flour.id), KG - 120_000);
    assert.equal(await total(f, f.milk.id), 800);
    assert.equal(await total(f, f.butter.id), 100_000 - 14_000);
    assert.equal(await total(f, f.egg.id), 0, "ποτέ αρνητικό απόθεμα");
    assert.equal(results[0]!.status, "NEEDS_REVIEW");
    assert.equal(results[0]!.shortfall, 1);
    assert.equal(results[1]!.status, "NEEDS_REVIEW");
    assert.match((await db.consumptionEvent.findUnique({ where: { id: results[1]!.id } }))!.note!, /συνταγή/);
  } finally { await cleanup(f); }
});

test("PostgreSQL 4α: η ολοκλήρωση πώλησης γράφει κατανάλωση, και αποτυχία κατανάλωσης δεν μπλοκάρει την πώληση", databaseOptions, async () => {
  const f = await fixture();
  try {
    await stock(f, f.cup.id, 5);
    await stock(f, f.spoon.id, 5);
    const method = await db.paymentMethod.create({ data: { code: `cons-${f.suffix}`, name: "Κάρτα CONS", provider: "MANUAL", ledgerKind: "CARD_CLEARING" } });
    const s = await sale(f, [{ productId: f.cupProduct.id, quantity: 2 }], new Date(), "AWAITING_PAYMENT");
    await db.payment.create({ data: { saleId: s.id, methodId: method.id, amountCents: 800 } });
    await db.fiscalDocument.create({ data: { saleId: s.id, orgId: f.orgId, receiptReference: randomUUID(), status: "PENDING", request: {} } });
    await completeSale(f.deviceId, s.id, {}, "tx-1", f.orgId);
    assert.equal((await db.sale.findUnique({ where: { id: s.id } }))?.status, "COMPLETED");
    assert.equal(await total(f, f.cup.id), 3);

    // 11.4 μέσω completeCredit: αντίστροφη κίνηση
    const fiscal = await db.fiscalDocument.findUniqueOrThrow({ where: { saleId: s.id } });
    const credit = await db.fiscalDocument.create({ data: { orgId: f.orgId, docType: "11.4", relatedId: fiscal.id, receiptReference: randomUUID(), status: "PENDING", request: {} } });
    await completeCredit(credit.id, {}, f.orgId);
    assert.equal(await total(f, f.cup.id), 5);

    // χωρίς αποθήκη για το κατάστημα: η πώληση ολοκληρώνεται, η κατανάλωση απλώς δεν γράφεται
    await db.storeWarehouse.deleteMany({ where: { storeId: f.storeId } });
    const broken = await sale(f, [{ productId: f.cupProduct.id, quantity: 1 }], new Date(), "AWAITING_PAYMENT");
    await db.payment.create({ data: { saleId: broken.id, methodId: method.id, amountCents: 400 } });
    await db.fiscalDocument.create({ data: { saleId: broken.id, orgId: f.orgId, receiptReference: randomUUID(), status: "PENDING", request: {} } });
    await completeSale(f.deviceId, broken.id, {}, "tx-2", f.orgId);
    assert.equal((await db.sale.findUnique({ where: { id: broken.id } }))?.status, "COMPLETED");
    assert.equal(await db.consumptionEvent.count({ where: { orgId: f.orgId, saleId: broken.id } }), 0);
  } finally { await cleanup(f); }
});

test("PostgreSQL 4α: επιστροφή πελάτη με και χωρίς επανεισαγωγή, καταστροφή με όριο έγκρισης", databaseOptions, async () => {
  const f = await fixture();
  try {
    await stock(f, f.cup.id, 5);
    await stock(f, f.spoon.id, 5);
    const at = new Date("2026-11-21T12:00:00Z");
    const back = await db.$transaction((tx) => customerReturn(tx, { orgId: f.orgId, storeId: f.storeId, productId: f.cupProduct.id, quantity: 1, restock: true, clientKey: `${f.suffix}:r1`, occurredAt: at, actor: actor(f) }));
    assert.equal(back.waste, null);
    assert.equal(await total(f, f.cup.id), 6);
    const again = await db.$transaction((tx) => customerReturn(tx, { orgId: f.orgId, storeId: f.storeId, productId: f.cupProduct.id, quantity: 1, restock: true, clientKey: `${f.suffix}:r1`, occurredAt: at, actor: actor(f) }));
    assert.equal(again.returned.replayed, true);
    assert.equal(await total(f, f.cup.id), 6);
    const spoiled = await db.$transaction((tx) => customerReturn(tx, { orgId: f.orgId, storeId: f.storeId, productId: f.cupProduct.id, quantity: 1, restock: false, clientKey: `${f.suffix}:r2`, occurredAt: at, actor: actor(f) }));
    assert.ok(spoiled.waste);
    assert.equal(await total(f, f.cup.id), 6, "είσοδος και καταστροφή μαζί: το απόθεμα δεν αλλάζει");
    assert.equal((await demand(f, f.cup.id, "2026-11-21"))?.wasteBase, 1);
    assert.equal((await demand(f, f.cup.id, "2026-11-21"))?.consumedBase, -2);

    // καταστροφή: 100 κύπελλα × 0,05 = 5 € ≤ όριο· 2.000 × 0,05 = 100 € > όριο → αναμονή
    await stock(f, f.cup.id, 3000);
    const small = await db.$transaction((tx) => recordWaste(tx, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.cup.id, quantity: 100, reason: "BROKEN", clientKey: `${f.suffix}:w1`, actor: actor(f), canApprove: false }));
    assert.equal(small.status, "POSTED");
    const big = await db.$transaction((tx) => recordWaste(tx, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.cup.id, quantity: 2000, reason: "QUALITY", clientKey: `${f.suffix}:w2`, actor: actor(f), canApprove: false }));
    assert.equal(big.status, "PENDING_APPROVAL");
    assert.equal(await total(f, f.cup.id), 2906);
    await db.$transaction((tx) => approveWaste(tx, { orgId: f.orgId, eventId: big.id, actor: actor(f) }));
    await db.$transaction((tx) => approveWaste(tx, { orgId: f.orgId, eventId: big.id, actor: actor(f) }));
    assert.equal(await total(f, f.cup.id), 906);
  } finally { await cleanup(f); }
});

async function countDay(f: Fixture, day: string, actualQty: number, wasteQty = 0) {
  const created = await createStockCount(ctx(f), { clientKey: randomUUID(), storeId: f.storeId, warehouseId: f.warehouseId, countedOn: day });
  const lines = await db.stockCountLine.findMany({ where: { orgId: f.orgId, countId: created.id } });
  const line = lines.find((row) => row.genericItemId === f.strawberry.id)!;
  // τα υπόλοιπα είδη μετρήθηκαν όσα έπρεπε
  await updateStockCountMeasurements(ctx(f), created.id, lines.map((row) => row.id === line.id ? { lineId: row.id, actualQty, wasteQty } : { lineId: row.id, actualQty: row.expectedQty }));
  await finalizeStockCount(ctx(f), created.id);
  return line.id;
}

test("PostgreSQL 4α: απογραφή βιτρίνας 4,0 + 5,0 − 3,2 − 0,3 = 5,5 kg σε δύο κινήσεις, υπερμερίδα 0,6 kg (12%)", databaseOptions, async () => {
  const f = await fixture();
  try {
    await stock(f, f.strawberry.id, 4 * KG);
    await countDay(f, "2026-11-19", 4 * KG); // χθεσινή: ίδια με το απόθεμα
    await stock(f, f.strawberry.id, 5 * KG); // εισαγωγή από το εργαστήριο
    // 70 μπάλες στο ταμείο × 70 g
    const s = await sale(f, [{ productId: f.cupProduct.id, quantity: 35, options: [{ id: f.strawberryOption.id, name: "Φράουλα", priceCents: 0 }, { id: f.strawberryOption.id, name: "Φράουλα", priceCents: 0 }] }]);
    await stock(f, f.cup.id, 100); await stock(f, f.spoon.id, 100);
    await db.$transaction((tx) => consumeSale(tx, { orgId: f.orgId, saleId: s.id }));
    const lineId = await countDay(f, "2026-11-20", 3_200_000, 300_000);
    assert.equal(await total(f, f.strawberry.id), 3_200_000);
    const moves = await db.stockMovement.findMany({ where: { orgId: f.orgId, genericItemId: f.strawberry.id, source: { in: ["consumption", "waste"] } }, orderBy: { source: "asc" } });
    assert.deepEqual(moves.map((m) => [m.source, m.quantity]), [["consumption", -5_500_000], ["waste", -300_000]]);
    const line = await db.stockCountLine.findUniqueOrThrow({ where: { id: lineId } });
    assert.equal(line.consumptionQty, 5_500_000);
    assert.equal(line.inflowQty, 5 * KG);
    const day = await demand(f, f.strawberry.id, "2026-11-20");
    assert.equal(day?.consumedBase, 5_500_000);
    assert.equal(day?.wasteBase, 300_000);
    assert.equal(day?.theoreticalBase, 4_900_000);
    const [report] = await theoreticalVsActual(db, { orgId: f.orgId, warehouseId: f.warehouseId, from: new Date("2026-11-20"), to: new Date("2026-11-20") });
    assert.equal(report!.overBase, 600_000);
    assert.equal(report!.overPctTenths, 122); // 12,2%
    assert.equal(report!.overCents, 360); // 0,6 kg × 6 €/kg

    // διόρθωση οριστικοποιημένης: μετρήθηκαν 3,0 kg αντί 3,2 → +0,2 kg κατανάλωση
    await stockTransaction((tx) => correctCountLine(tx, { orgId: f.orgId, countLineId: lineId, actualQty: 3 * KG, wasteQty: 300_000, actor: actor(f), reason: "λάθος ζύγισμα" }));
    assert.equal(await total(f, f.strawberry.id), 3 * KG);
    assert.equal((await demand(f, f.strawberry.id, "2026-11-20"))?.consumedBase, 5_700_000);
  } finally { await cleanup(f); }
});

test("PostgreSQL 4α: απογραφή που λείπει μοιράζει την κατανάλωση με τις πωλήσεις· εξάντληση και αρνητική κατανάλωση", databaseOptions, async () => {
  const f = await fixture();
  try {
    await stock(f, f.strawberry.id, 4 * KG);
    await stock(f, f.cup.id, 100); await stock(f, f.spoon.id, 100);
    await countDay(f, "2026-11-17", 4 * KG);
    // καμία απογραφή στις 18: πωλήσεις 1 μπάλα στις 18, 3 μπάλες στις 19
    const option = [{ id: f.strawberryOption.id, name: "Φράουλα", priceCents: 0 }];
    for (const [day, n] of [["2026-11-18", 1], ["2026-11-19", 3]] as const) {
      const s = await sale(f, [{ productId: f.cupProduct.id, quantity: n, options: option }], new Date(`${day}T12:00:00Z`));
      await db.$transaction((tx) => consumeSale(tx, { orgId: f.orgId, saleId: s.id }));
    }
    await countDay(f, "2026-11-19", 0); // όλα πουλήθηκαν: εξάντληση
    assert.equal((await demand(f, f.strawberry.id, "2026-11-18"))?.consumedBase, 1 * KG);
    assert.equal((await demand(f, f.strawberry.id, "2026-11-19"))?.consumedBase, 3 * KG);
    assert.equal((await demand(f, f.strawberry.id, "2026-11-19"))?.stockedOut, true);
    // εισαγωγή που δεν καταχωρήθηκε: μετρούν 1 kg ενώ το σύστημα ξέρει 0 → έλεγχος, εκτός πρόβλεψης
    await countDay(f, "2026-11-20", 1 * KG);
    const day = await demand(f, f.strawberry.id, "2026-11-20");
    assert.equal(day?.consumedBase, 0);
    assert.equal(day?.reviewBase, 1 * KG);
    assert.equal(await db.consumptionEvent.count({ where: { orgId: f.orgId, kind: "COUNT_CONSUMPTION", status: "NEEDS_REVIEW" } }), 1);
    assert.equal(await total(f, f.strawberry.id), 1 * KG);
  } finally { await cleanup(f); }
});

test("PostgreSQL 4α: ξένος orgId δεν καταναλώνει ούτε καταστρέφει", databaseOptions, async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    await stock(f, f.cup.id, 5);
    const s = await sale(f, [{ productId: f.cupProduct.id, quantity: 1 }]);
    assert.deepEqual(await db.$transaction((tx) => consumeSale(tx, { orgId: other.orgId, saleId: s.id })), []);
    await assert.rejects(db.$transaction((tx) => recordWaste(tx, { orgId: other.orgId, warehouseId: other.warehouseId, genericItemId: f.cup.id, quantity: 1, reason: "BROKEN", clientKey: randomUUID(), actor: actor(other), canApprove: true })));
    assert.equal(await total(f, f.cup.id), 5);
  } finally { await cleanup(f); await cleanup(other); }
});
