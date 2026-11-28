import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { productionForecast } from "./forecast-db.ts";
import { mrpV2Suggestions, productionSuggestions, refreshWeather } from "./planning/planning-db.ts";
import { postStockMovement } from "./stock-db.ts";
import type { StockContext } from "./stock-scope.ts";
import { stockTransaction } from "./stock-transaction.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const KG = 1_000_000;
const TUESDAY = "2026-11-10";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `PLAN ${suffix}`, vatNumber: `PLAN-${suffix}` } });
  const user = await db.user.create({ data: { email: `plan-${suffix}@example.test`, name: "Υπεύθυνος παραγωγής" } });
  const mg = await db.unit.findFirst({ where: { dimension: "mass", toBase: 1 } }) ?? await db.unit.create({ data: { code: `t-mg-${suffix}`, nameEL: "mg δοκιμής", dimension: "mass", toBase: 1 } });
  const store = await db.store.create({ data: { orgId: org.id, name: "Βιτρίνα κέντρο", latitude: 37.98381, longitude: 23.72754 } });
  const shop = await db.warehouse.create({ data: { orgId: org.id, name: "Βιτρίνα" } });
  const lab = await db.warehouse.create({ data: { orgId: org.id, name: "Εργαστήριο" } });
  await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: shop.id, isDefault: true } });
  const generic = (name: string, extra: Record<string, unknown> = {}) => db.genericItem.create({ data: { orgId: org.id, name: `${name} ${suffix.slice(0, 4)}`, baseUnitId: mg.id, avgCostHundredths: 10_000, ...extra } });
  const strawberry = await generic("Φράουλα", { consumptionSource: "COUNT", minDisplayBase: KG });
  const milk = await generic("Γάλα");
  const paste = await generic("Πάστα φράουλας");
  const recipe = await db.recipe.create({ data: { orgId: org.id, name: `Φράουλα ${suffix}`, batchGrams: 1000, outputGenericItemId: strawberry.id, machineCapacityGrams: 4500, normalWastePct: 4, items: { create: [{ orgId: org.id, genericItemId: milk.id, grams: 700 }, { orgId: org.id, genericItemId: paste.id, grams: 300 }] } } });
  const customer = await db.party.create({ data: { orgId: org.id, name: "Ξενοδοχείο", roles: ["customer"], vatNumber: `PC-${suffix}` } });
  return { suffix, orgId: org.id, userId: user.id, userName: user.name, storeId: store.id, shopId: shop.id, labId: lab.id, strawberry, milk, paste, recipe, customerId: customer.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
  await db.productionPlan.deleteMany({ where: { orgId: f.orgId } });
  await db.wholesaleOrder.deleteMany({ where: { orgId: f.orgId } });
  await db.recipeItem.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  await db.user.deleteMany({ where: { id: f.userId } });
}

const ctx = (f: Fixture): StockContext => ({ orgId: f.orgId, membershipId: "planning-integration", userId: f.userId, userName: f.userName, permissions: [], storeIds: [], warehouseIds: [], can: () => true });
const stock = (f: Fixture, warehouseId: string, genericItemId: string, quantity: number) => stockTransaction((tx) => postStockMovement(tx, { orgId: f.orgId, warehouseId, genericItemId, lotId: null, quantity, source: "manual", actor: { id: f.userId, name: f.userName } }));
const demandRow = (f: Fixture, iso: string, data: { consumedBase?: number; wholesaleBase?: number; reviewBase?: number; stockedOut?: boolean }) => db.demandDaily.create({ data: { orgId: f.orgId, warehouseId: f.shopId, genericItemId: f.strawberry.id, day: day(iso), ...data } });

test("PostgreSQL 4α΄: πρόταση παραγωγής από DemandDaily — μ.ο. Τρίτης 6,2 − 1,8 + 1,0 + χονδρική 3,0 → 2 καραπίνες, μίγμα 9,38 kg", databaseOptions, async () => {
  const f = await fixture();
  try {
    for (let w = 1; w <= 4; w++) await demandRow(f, addDays(TUESDAY, -7 * w), { consumedBase: 6_200_000, wholesaleBase: w === 1 ? 10 * KG : 0 }); // ιστορική χονδρική: εκτός
    await demandRow(f, addDays(TUESDAY, -35), { consumedBase: 0, reviewBase: 50 * KG }); // ημέρα προς έλεγχο: εκτός
    await stock(f, f.shopId, f.strawberry.id, 1_800_000);
    await db.wholesaleOrder.create({ data: { orgId: f.orgId, customerId: f.customerId, storeId: f.storeId, warehouseId: f.labId, status: "CONFIRMED", neededAt: new Date(`${TUESDAY}T08:00:00Z`), number: `W-${f.suffix.slice(0, 6)}`, createdByName: f.userName, lines: { create: [{ orgId: f.orgId, genericItemId: f.strawberry.id, quantityBase: 3 * KG, unitPriceCents: 1000, vatRate: 13 }] } } });
    // καιρός για τις ημέρες του ιστορικού και την ημέρα παραγωγής (ζέστη την Τρίτη)
    const key = "37.9838,23.7275";
    for (let i = 0; i <= 35; i++) await db.weatherDaily.create({ data: { orgId: f.orgId, locationKey: key, day: day(addDays(TUESDAY, -i)), tMaxC10: i === 0 ? 300 : 180, rainMm10: 0, source: "met-no" } });

    const [row] = await db.$transaction((tx) => productionSuggestions(tx, ctx(f), { shopWarehouseId: f.shopId, labWarehouseId: f.labId, day: TUESDAY }));
    assert.ok(row);
    assert.deepEqual(row.coverage, [TUESDAY]);
    assert.equal(row.suggestion.need, 8_400_000);
    assert.equal(row.suggestion.containers, 2);
    assert.equal(row.suggestion.output, 9 * KG);
    assert.equal(row.suggestion.mix, 9_380_000);
    assert.deepEqual(row.suggestion.parts.map((p) => p.key), ["avg", "stock", "min", "wholesale"]);
    assert.ok(row.withWeather, "υπάρχει καιρός: δίπλα και η πρόταση με καιρό");
    assert.equal(row.withWeather.lowData, true, "4 εβδομάδες ιστορικό = εκτίμηση");
    assert.ok(row.withWeather.suggestion.need > row.suggestion.need, "30 °C την Τρίτη → μεγαλύτερη ζήτηση");

    // ήδη προγραμματισμένο μίγμα 5 kg για την ημέρα: μετά τη φύρα 4,8 kg αφαιρούνται
    await db.productionPlan.create({ data: { orgId: f.orgId, recipeId: f.recipe.id, sourceWarehouseId: f.labId, destinationWarehouseId: f.shopId, plannedFor: new Date(`${TUESDAY}T06:00:00Z`), quantityGrams: 5000, createdByName: f.userName } });
    const [again] = await db.$transaction((tx) => productionSuggestions(tx, ctx(f), { shopWarehouseId: f.shopId, labWarehouseId: f.labId, day: TUESDAY }));
    assert.equal(again!.suggestion.need, 3_600_000);
    assert.equal(again!.suggestion.containers, 1);

    // ιστορικό της 7ήμερης πρόβλεψης από το DemandDaily (όχι από κινήσεις «sale»)
    const forecast = await db.$transaction((tx) => productionForecast(tx, ctx(f), f.shopId, new Date(`${TUESDAY}T12:00:00Z`)));
    assert.equal(forecast.find((r) => r.genericItemId === f.strawberry.id)?.historicalBase, 4 * 6_200_000);
  } finally { await cleanup(f); }
});

test("PostgreSQL 4α΄: MRP v2 — βέβαιη ζήτηση Α΄ υλών από το πλάνο παραγωγής και την επιβεβαιωμένη χονδρική, χωρίς διπλή μέτρηση", databaseOptions, async () => {
  const f = await fixture();
  try {
    const today = TUESDAY;
    await stock(f, f.labId, f.milk.id, 2 * KG);
    await stock(f, f.labId, f.strawberry.id, 2 * KG); // έτοιμο: καλύπτει μέρος της χονδρικής
    await db.mrpItemSetting.create({ data: { orgId: f.orgId, warehouseId: f.labId, genericItemId: f.milk.id, leadDays: 1, coverDays: 2, orderMultipleBase: 1000 } });
    await db.productionPlan.create({ data: { orgId: f.orgId, recipeId: f.recipe.id, sourceWarehouseId: f.labId, destinationWarehouseId: f.shopId, plannedFor: new Date(`${addDays(today, 1)}T06:00:00Z`), quantityGrams: 10_000, createdByName: f.userName } });
    await db.wholesaleOrder.create({ data: { orgId: f.orgId, customerId: f.customerId, storeId: f.storeId, warehouseId: f.labId, status: "CONFIRMED", neededAt: new Date(`${today}T16:00:00Z`), number: `W-${f.suffix.slice(0, 6)}`, createdByName: f.userName, lines: { create: [{ orgId: f.orgId, genericItemId: f.strawberry.id, quantityBase: 5 * KG, unitPriceCents: 1000, vatRate: 13 }] } } });
    const rows = await db.$transaction((tx) => mrpV2Suggestions(tx, ctx(f), { warehouseId: f.labId, today }));
    const milk = rows.find((r) => r.genericItemId === f.milk.id)!;
    // πλάνο αύριο 10 kg × 700 g = 7 kg· χονδρική σήμερα 5 − 2 έτοιμο = 3 kg (το αυριανό πλάνο δεν προλαβαίνει) × 700 g = 2,1 kg
    assert.equal(milk.firmBaseQty, 9_100_000);
    assert.equal(milk.suggestedBaseQty % 1000, 0, "πολλαπλάσιο παραγγελίας");
    assert.ok(milk.suggestedBaseQty >= 9_100_000 - 2 * KG);
    assert.equal(rows.some((r) => r.genericItemId === f.strawberry.id && r.suggestedBaseQty > 0), false, "ό,τι παράγεται δεν παραγγέλνεται");
  } finally { await cleanup(f); }
});

test("PostgreSQL 4α΄: καιρός MET Norway — αποθήκευση ανά τοποθεσία, η μερική σημερινή κρατά τη μεγαλύτερη μέγιστη, χωρίς User-Agent καμία κλήση", databaseOptions, async () => {
  const f = await fixture();
  try {
    const hours = (date: string, temps: number[]) => temps.map((t, i) => ({ time: `${date}T${String(4 + i).padStart(2, "0")}:00:00Z`, data: { instant: { details: { air_temperature: t } }, next_1_hours: { summary: { symbol_code: "fair_day" }, details: { precipitation_amount: 0 } } } }));
    let calls = 0;
    const urls: string[] = [];
    const fetchJson = (temps: number[]) => async (url: string) => { calls += 1; urls.push(url); return { properties: { timeseries: [...hours("2026-11-28", temps), ...hours("2026-11-29", [15, 16, 17, 18, 19])] } }; };
    assert.equal((await refreshWeather(db, { orgId: f.orgId, userAgent: "", fetchJson: fetchJson([20]) })).skipped, "MET_NO_USER_AGENT");
    assert.equal(calls, 0);
    const now = new Date("2026-11-28T10:00:00Z");
    const first = await refreshWeather(db, { orgId: f.orgId, userAgent: "epic-test/1.0", fetchJson: fetchJson([18, 22, 24, 21]), now });
    assert.equal(first.locations, 1);
    assert.match(urls[0]!, /lat=37\.9838&lon=23\.7275/);
    await refreshWeather(db, { orgId: f.orgId, userAgent: "epic-test/1.0", fetchJson: fetchJson([19, 20, 19, 18]), now });
    const today = await db.weatherDaily.findUniqueOrThrow({ where: { orgId_locationKey_day: { orgId: f.orgId, locationKey: "37.9838,23.7275", day: day("2026-11-28") } } });
    assert.equal(today.tMaxC10, 240, "η σημερινή κρατά τα 24,0 °C");
    const tomorrow = await db.weatherDaily.findUniqueOrThrow({ where: { orgId_locationKey_day: { orgId: f.orgId, locationKey: "37.9838,23.7275", day: day("2026-11-29") } } });
    assert.equal(tomorrow.tMaxC10, 190);
  } finally { await cleanup(f); }
});

test("PostgreSQL 4α΄: ξένος orgId δεν βλέπει πρόταση παραγωγής ούτε MRP", databaseOptions, async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    await assert.rejects(db.$transaction((tx) => productionSuggestions(tx, ctx(other), { shopWarehouseId: f.shopId, labWarehouseId: f.labId, day: TUESDAY })));
    await assert.rejects(db.$transaction((tx) => mrpV2Suggestions(tx, ctx(other), { warehouseId: f.labId, today: TUESDAY })));
  } finally { await cleanup(f); await cleanup(other); }
});
