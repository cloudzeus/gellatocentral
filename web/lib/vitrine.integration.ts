import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";
import { publicVitrine, recordVitrineView, rotateVitrineToken, saveVitrineSetting, syncVitrineItems, updateVitrineItem } from "./vitrine-db.ts";
import { WorkflowError } from "./workflow-db.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `VIT integration ${suffix}`, vatNumber: `TEST-${suffix}`, subscription: { create: { status: "ACTIVE", currentPeriodEnd: new Date("2027-12-31T00:00:00.000Z") } } } });
  const foreign = await db.organization.create({ data: { name: `VIT foreign ${suffix}`, vatNumber: `FOREIGN-${suffix}`, subscription: { create: { status: "ACTIVE", currentPeriodEnd: new Date("2027-12-31T00:00:00.000Z") } } } });
  const user = await db.user.create({ data: { email: `vitrine-${suffix}@example.test`, name: "Βιτρίνα integration" } });
  const role = await db.orgRole.create({ data: { orgId: org.id, name: "Βιτρίνα integration", permissions: ["vitrine.read", "vitrine.edit", "items.read"] } });
  const membership = await db.membership.create({ data: { orgId: org.id, userId: user.id, roleId: role.id } });
  const store = await db.store.create({ data: { orgId: org.id, name: "Κατάστημα VIT" } });
  const otherStore = await db.store.create({ data: { orgId: org.id, name: "Άλλο κατάστημα VIT" } });
  const foreignStore = await db.store.create({ data: { orgId: foreign.id, name: "Ξένο κατάστημα VIT" } });
  const warehouse = await db.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη VIT" } });
  await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: warehouse.id } });
  await db.membershipStore.create({ data: { membershipId: membership.id, storeId: store.id } });
  await db.membershipWarehouse.create({ data: { orgId: org.id, membershipId: membership.id, warehouseId: warehouse.id } });
  const unit = await db.unit.findFirstOrThrow({ where: { code: "mg", toBase: 1 } });
  const vat = await db.vatRate.create({ data: { name: `VIT-${suffix}`, rate: 24 } });
  const raw = await db.genericItem.create({ data: { orgId: org.id, name: "Γάλα VIT", baseUnitId: unit.id, composition: { create: { orgId: org.id, fatPm: 3500, allergensContains: ["milk"], allergensTraces: ["nuts"], isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: false } } } });
  const base = await db.genericItem.create({ data: { orgId: org.id, name: "Βάση VIT", baseUnitId: unit.id } });
  const output = await db.genericItem.create({ data: { orgId: org.id, name: "Βανίλια VIT stock", baseUnitId: unit.id } });
  const empty = await db.genericItem.create({ data: { orgId: org.id, name: "Σοκολάτα VIT χωρίς stock", baseUnitId: unit.id } });
  const category = await db.category.create({ data: { orgId: org.id, name: "Παγωτά VIT" } });
  const availableProduct = await db.product.create({ data: { orgId: org.id, categoryId: category.id, vatRateId: vat.id, name: "Βανίλια VIT", priceCents: 350 } });
  const emptyProduct = await db.product.create({ data: { orgId: org.id, categoryId: category.id, vatRateId: vat.id, name: "Σοκολάτα VIT", priceCents: 400 } });
  await db.recipe.create({ data: { orgId: org.id, name: "Υποσυνταγή VIT", outputGenericItemId: base.id, batchGrams: 1000, items: { create: [{ orgId: org.id, genericItemId: raw.id, grams: 1000 }] } } });
  await db.recipe.create({ data: { orgId: org.id, name: "Τελική VIT", productId: availableProduct.id, outputGenericItemId: output.id, batchGrams: 1000, items: { create: [{ orgId: org.id, genericItemId: base.id, grams: 500, sortOrder: 0 }, { orgId: org.id, genericItemId: raw.id, grams: 500, sortOrder: 1 }] } } });
  await db.recipe.create({ data: { orgId: org.id, name: "Χωρίς απόθεμα VIT", productId: emptyProduct.id, outputGenericItemId: empty.id, batchGrams: 1000, items: { create: [{ orgId: org.id, genericItemId: raw.id, grams: 1000 }] } } });
  const lot = await db.stockLot.create({ data: { orgId: org.id, warehouseId: warehouse.id, genericItemId: output.id, batchNumber: `VIT-${suffix}` } });
  await db.stockMovement.create({ data: { orgId: org.id, warehouseId: warehouse.id, genericItemId: output.id, lotId: lot.id, quantity: 2_000_000, unitCostHundredths: 50_000, source: "manual" } });
  return { orgId: org.id, foreignOrgId: foreign.id, userId: user.id, membershipId: membership.id, storeId: store.id, otherStoreId: otherStore.id, foreignStoreId: foreignStore.id, warehouseId: warehouse.id, availableProductId: availableProduct.id, emptyProductId: emptyProduct.id, lotId: lot.id, vatId: vat.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture, restricted = false): StockContext {
  return { orgId: f.orgId, membershipId: f.membershipId, userId: f.userId, userName: "Βιτρίνα integration", permissions: ["vitrine.read", "vitrine.edit", "items.read"], storeIds: restricted ? [f.storeId] : [], warehouseIds: restricted ? [f.warehouseId] : [], can: () => true };
}
const settings = (f: Fixture) => ({ storeId: f.storeId, published: true, selectionMode: "auto", warehouseId: f.warehouseId, languages: ["el", "en"], showPrices: true, showAllergens: true, tvPageSeconds: 8 });

test("PostgreSQL VIT: snapshots, auto stock, tokens, views, pause/subscription και tenant isolation", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  try {
    await saveVitrineSetting(ctx, settings(f));
    assert.equal((await syncVitrineItems(ctx, f.storeId)).products, 2);
    const rotated = await rotateVitrineToken(ctx, f.storeId);
    const token = rotated.token;
    assert.equal(await db.vitrineSetting.count({ where: { orgId: f.orgId, tokenHash: token } }), 0);
    const initial = await publicVitrine(token);
    assert.deepEqual(initial.items.map((item) => item.productId), [f.availableProductId]);
    const snapshot = initial.items[0]?.snapshot as { allergensContains?: string[]; allergensTraces?: string[]; ingredients?: { name: string }[]; dietary?: { vegan: boolean } };
    assert.deepEqual(snapshot.allergensContains, ["milk"]);
    assert.deepEqual(snapshot.allergensTraces, ["nuts"]);
    assert.equal(snapshot.ingredients?.length, 1);
    assert.equal(snapshot.dietary?.vegan, false);
    assert.equal(JSON.stringify(snapshot).includes("avgCost"), false);

    await Promise.all(Array.from({ length: 4 }, () => recordVitrineView(token)));
    assert.equal((await db.vitrineDailyView.findFirstOrThrow({ where: { orgId: f.orgId, storeId: f.storeId } })).views, 4);
    await db.stockMovement.create({ data: { orgId: f.orgId, warehouseId: f.warehouseId, lotId: f.lotId, genericItemId: (await db.stockLot.findUniqueOrThrow({ where: { id: f.lotId } })).genericItemId, quantity: -2_000_000, source: "manual" } });
    assert.equal((await publicVitrine(token)).items.length, 0);
    await syncVitrineItems(ctx, f.storeId);
    assert.equal(await db.vitrineItem.count({ where: { orgId: f.orgId, selected: true } }), 0);

    await saveVitrineSetting(ctx, { ...settings(f), selectionMode: "manual" });
    const item = await db.vitrineItem.findFirstOrThrow({ where: { orgId: f.orgId, productId: f.availableProductId } });
    await updateVitrineItem(ctx, { itemId: item.id, selected: true, soldOut: false, position: 0, priceCents: 375 });
    assert.equal((await publicVitrine(token)).items[0]?.priceCents, 375);
    await updateVitrineItem(ctx, { itemId: item.id, selected: true, soldOut: true, position: 0 });
    assert.equal((await publicVitrine(token)).items.length, 0);
    await updateVitrineItem(ctx, { itemId: item.id, selected: true, soldOut: false, position: 0 });

    const next = await rotateVitrineToken(ctx, f.storeId);
    await assert.rejects(publicVitrine(token), WorkflowError);
    assert.equal((await publicVitrine(next.token)).items.length, 1);
    await db.storePause.create({ data: { orgId: f.orgId, storeId: f.storeId, maxDays: 10, startedByName: "VIT integration" } });
    await assert.rejects(publicVitrine(next.token), /εκτός λειτουργίας/);
    await db.storePause.updateMany({ where: { orgId: f.orgId, storeId: f.storeId }, data: { endedAt: new Date() } });
    await db.subscription.update({ where: { orgId: f.orgId }, data: { status: "CANCELLED" } });
    await assert.rejects(publicVitrine(next.token), WorkflowError);

    await saveVitrineSetting(context(f, true), settings(f));
    await assert.rejects(saveVitrineSetting(context(f, true), { ...settings(f), storeId: f.otherStoreId }), StockScopeError);
    await assert.rejects(saveVitrineSetting(context(f, true), { ...settings(f), storeId: f.foreignStoreId }), StockScopeError);
    assert.equal(await db.vitrineSetting.count({ where: { orgId: f.foreignOrgId } }), 0);
  } finally {
    await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
    await db.organization.deleteMany({ where: { id: { in: [f.orgId, f.foreignOrgId] } } });
    await db.user.deleteMany({ where: { id: f.userId } });
    await db.vatRate.deleteMany({ where: { id: f.vatId } });
  }
});
