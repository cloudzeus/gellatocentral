// Προγραμματισμός (ενότητα 4α΄): πρόταση παραγωγής, MRP v2 και καιρός πάνω στο DemandDaily.
// Όλα τα queries έχουν orgId· οι ποσότητες στη βασική μονάδα, τα γραμμάρια μόνο μέσα στις συνταγές.
import type { Prisma } from "../generated/prisma/client.ts";
import { addDaysUtc, businessDay, isoDay } from "../consumption-rules.ts";
import { assertStockScope, type StockContext } from "../stock-scope.ts";
import { stockBalances } from "../stock-db.ts";
import { gramsToBaseQty } from "../units.ts";
import { firmDemandWithWholesale, wholesaleShortfall, type PlannedBatch } from "./mrp-demand.ts";
import { mrpV2Suggestion, resolveLeadDays, type ReceiptSample } from "./mrp-v2.ts";
import { addDays, breakdownLine, censoredDemand, coverageDays, productionWeekdays, suggestProduction, weekdayUtc, type DemandEstimate, type Dimension, type Suggestion } from "./production-suggest.ts";
import { coord4, fitSeries, forecastDay, mergeDay, metNoUrl, parseMetNoDaily, type HistorySample, type WeatherDay } from "./weather-forecast.ts";

type Tx = Prisma.TransactionClient;
const HISTORY_WEEKS = 8;
const athens = (at: Date) => isoDay(businessDay(at));
const utcDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

// ── ιστορικό ζήτησης ─────────────────────────────────────────────────────────

/**
 * Ζήτηση ανά είδος και ημέρα από το DemandDaily: κατανάλωση χωρίς φύρα και χωρίς χονδρική (η ιστορική
 * χονδρική εξαιρείται· η επιβεβαιωμένη μπαίνει χωριστά ως βέβαιη). Ημέρες με αρνητική κατανάλωση προς
 * έλεγχο (reviewBase) εξαιρούνται. Οι κλειστές ημέρες (StorePause) δεν έχουν γραμμή.
 */
export async function demandHistory(tx: Tx, input: { orgId: string; warehouseId: string; from: string; to: string; genericItemIds?: readonly string[] }) {
  const rows = await tx.demandDaily.findMany({
    where: { orgId: input.orgId, warehouseId: input.warehouseId, day: { gte: utcDay(input.from), lte: utcDay(input.to) }, ...(input.genericItemIds ? { genericItemId: { in: [...input.genericItemIds] } } : {}) },
    select: { genericItemId: true, day: true, consumedBase: true, reviewBase: true, stockedOut: true },
    orderBy: { day: "asc" },
  });
  const out = new Map<string, HistorySample[]>();
  for (const row of rows) {
    if (row.reviewBase !== 0) continue;
    out.set(row.genericItemId, [...(out.get(row.genericItemId) ?? []), { day: isoDay(row.day), qty: Math.max(0, row.consumedBase), stockout: row.stockedOut }]);
  }
  return out;
}

export async function weatherFor(tx: Tx, input: { orgId: string; locationKey: string; from: string; to: string }) {
  const rows = await tx.weatherDaily.findMany({ where: { orgId: input.orgId, locationKey: input.locationKey, day: { gte: utcDay(input.from), lte: utcDay(input.to) } } });
  return new Map<string, WeatherDay>(rows.map((row) => [isoDay(row.day), { day: isoDay(row.day), tmax: row.tMaxC10 === null ? null : row.tMaxC10 / 10, tmin: row.tMinC10 === null ? null : row.tMinC10 / 10, precip: row.rainMm10 === null ? null : row.rainMm10 / 10, code: row.code }]));
}

export const locationKeyOf = (lat: number, lon: number) => `${coord4(lat)},${coord4(lon)}`;

async function warehouseLocation(tx: Tx, orgId: string, warehouseId: string) {
  const link = await tx.storeWarehouse.findFirst({ where: { warehouseId, store: { orgId, latitude: { not: null }, longitude: { not: null } } }, orderBy: [{ isDefault: "desc" }, { priority: "asc" }], select: { store: { select: { latitude: true, longitude: true } } } });
  return link ? locationKeyOf(link.store.latitude!, link.store.longitude!) : null;
}

// ── πρόταση παραγωγής ─────────────────────────────────────────────────────────

export type ProductionSuggestionRow = {
  genericItemId: string;
  name: string;
  dimension: Dimension;
  recipeId: string;
  coverage: string[];
  suggestion: Suggestion;
  explanation: string;
  /** με καιρό: null όταν δεν υπάρχει καιρός ή αρκετό ιστορικό */
  withWeather: { suggestion: Suggestion; lowData: boolean; missingWeatherDays: number } | null;
};

/**
 * Για την ημέρα παραγωγής `day` (YYYY-MM-DD): τι να φτιάξει το εργαστήριο `labWarehouseId` για τη βιτρίνα
 * `shopWarehouseId`. Ζήτηση = μέσος όρος ίδιας ημέρας εβδομάδας (8 εβδομάδες, λογοκριμένες εξαντλήσεις).
 */
export async function productionSuggestions(tx: Tx, ctx: StockContext, input: { shopWarehouseId: string; labWarehouseId: string; day: string; fmt?: (base: number, dimension: Dimension) => string }): Promise<ProductionSuggestionRow[]> {
  await assertStockScope(tx, ctx, { warehouseIds: [input.shopWarehouseId, input.labWarehouseId] });
  const recipeRows = await tx.recipe.findMany({ where: { orgId: ctx.orgId, active: true, outputGenericItemId: { not: null } }, select: { id: true, outputGenericItemId: true, machineCapacityGrams: true, normalWastePct: true } });
  const outputs = await tx.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true, id: { in: recipeRows.map((recipe) => recipe.outputGenericItemId!) } }, select: { id: true, name: true, gramsPerPiece: true, minDisplayBase: true, baseUnit: { select: { dimension: true, toBase: true, code: true } } } });
  const outputById = new Map(outputs.map((generic) => [generic.id, generic]));
  const items = recipeRows.flatMap((recipe) => (outputById.has(recipe.outputGenericItemId!) ? [{ ...recipe, outputGenericItem: outputById.get(recipe.outputGenericItemId!)! }] : []));
  if (!items.length) return [];
  const ids = items.map((recipe) => recipe.outputGenericItemId!);

  const historyFrom = addDays(input.day, -HISTORY_WEEKS * 7);
  const batches = await tx.productionBatch.findMany({ where: { orgId: ctx.orgId, producedAt: { gte: utcDay(historyFrom), lt: utcDay(input.day) } }, select: { producedAt: true } });
  const weekdays = productionWeekdays(batches.map((batch) => athens(batch.producedAt)), input.day);
  const coverage = coverageDays(input.day, weekdays);
  const coverageEnd = addDays(coverage.at(-1)!, 1);

  const [history, shop, lab, wholesale, plans] = await Promise.all([
    demandHistory(tx, { orgId: ctx.orgId, warehouseId: input.shopWarehouseId, from: historyFrom, to: addDays(input.day, -1), genericItemIds: ids }),
    stockBalances(tx, { orgId: ctx.orgId, warehouseIds: [input.shopWarehouseId], genericItemIds: ids }),
    stockBalances(tx, { orgId: ctx.orgId, warehouseIds: [input.labWarehouseId], genericItemIds: ids }),
    tx.wholesaleOrderLine.findMany({ where: { orgId: ctx.orgId, genericItemId: { in: ids }, order: { orgId: ctx.orgId, warehouseId: input.labWarehouseId, status: "CONFIRMED", neededAt: { gte: utcDay(addDays(input.day, -1)), lt: utcDay(addDays(coverageEnd, 1)) } } }, select: { genericItemId: true, quantityBase: true, order: { select: { neededAt: true } } } }),
    tx.productionPlan.findMany({ where: { orgId: ctx.orgId, status: { in: ["PLANNED", "IN_PROGRESS"] }, batchId: null, recipeId: { in: items.map((recipe) => recipe.id) }, plannedFor: { gte: utcDay(addDays(input.day, -1)), lt: utcDay(addDays(input.day, 2)) } }, select: { recipeId: true, quantityGrams: true, plannedFor: true } }),
  ]);
  const sum = (rows: readonly { genericItemId: string; quantity: number }[]) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.genericItemId, (map.get(row.genericItemId) ?? 0) + row.quantity);
    return map;
  };
  const shopById = sum(shop), labById = sum(lab.filter((row) => row.quantity > 0));

  const location = await warehouseLocation(tx, ctx.orgId, input.shopWarehouseId);
  const weather = location ? await weatherFor(tx, { orgId: ctx.orgId, locationKey: location, from: addDays(input.day, -400), to: coverageEnd }) : new Map<string, WeatherDay>();

  return items.flatMap((recipe) => {
    const generic = recipe.outputGenericItem;
    const dimension = generic.baseUnit.dimension as Dimension;
    const samples = history.get(generic.id) ?? [];
    const shopDays = coverage.map((day) => ({ day, demand: censoredDemand(samples.filter((s) => weekdayUtc(s.day) === weekdayUtc(day)).map((s) => ({ consumption: s.qty, stockout: s.stockout }))) }));
    const toBase = (grams: number | null | undefined) => (grams && grams > 0 ? gramsToBaseQty(grams, generic.baseUnit, generic.gramsPerPiece) : null);
    // Η χονδρική παραδίδεται την ημέρα της: πρέπει να είναι έτοιμη από την παραγωγή που την καλύπτει.
    const wholesaleRows = wholesale.filter((line) => line.genericItemId === generic.id && line.order.neededAt && coverage.includes(athens(line.order.neededAt))).map((line) => ({ day: athens(line.order.neededAt!), qty: line.quantityBase }));
    const planned = plans.filter((plan) => plan.recipeId === recipe.id && athens(plan.plannedFor) === input.day).reduce((total, plan) => total + gramsToBaseQty(plan.quantityGrams, generic.baseUnit, generic.gramsPerPiece), 0);
    const base = { dimension, shopStock: shopById.get(generic.id) ?? 0, minShowcase: generic.minDisplayBase ?? 0, wholesale: wholesaleRows, labStock: labById.get(generic.id) ?? 0, alreadyPlanned: planned, lossPct: recipe.normalWastePct ?? 0, containerCap: toBase(recipe.machineCapacityGrams) };
    const suggestion = suggestProduction({ ...base, shopDays });
    if (!samples.length && !wholesaleRows.length && !base.minShowcase && suggestion.output === 0) return [];

    let withWeather: ProductionSuggestionRow["withWeather"] = null;
    if (weather.size && samples.length) {
      const model = fitSeries(samples, weather, input.day);
      let missing = 0;
      const weatherDays = coverage.map((day) => {
        const forecast = forecastDay(model, day, weather.get(day));
        if (forecast.weather.missing) missing += 1;
        const plain = shopDays.find((row) => row.day === day)!.demand;
        return { day, demand: { ...plain, avg: Math.round(forecast.qty) } satisfies DemandEstimate };
      });
      withWeather = { suggestion: suggestProduction({ ...base, shopDays: weatherDays }), lowData: model.lowData, missingWeatherDays: missing };
    }
    const fmt = input.fmt ? (value: number) => input.fmt!(value, dimension) : (value: number) => String(value);
    return [{ genericItemId: generic.id, name: generic.name, dimension, recipeId: recipe.id, coverage, suggestion, explanation: breakdownLine(suggestion, fmt, input.fmt ? "" : generic.baseUnit.code), withWeather }];
  }).sort((a, b) => b.suggestion.output - a.suggestion.output || a.name.localeCompare(b.name, "el"));
}

// ── MRP v2 ──────────────────────────────────────────────────────────────────

/**
 * Πρόταση παραγγελίας Α΄ υλών: χρήση από τις κινήσεις παραγωγής (ανά ημέρα), βέβαιη ζήτηση από τα
 * προγραμματισμένα πλάνα και την επιβεβαιωμένη χονδρική (σπασμένα σε Α΄ ύλες, απόθεμα ημιέτοιμων μία
 * φορά), χρόνος παράδοσης από τις παραλαβές 180 ημερών.
 */
export async function mrpV2Suggestions(tx: Tx, ctx: StockContext, input: { warehouseId: string; today: string; horizonDays?: number }) {
  await assertStockScope(tx, ctx, { warehouseId: input.warehouseId });
  const horizon = input.horizonDays ?? 14;
  const org = await tx.organization.findUnique({ where: { id: ctx.orgId }, select: { mrpUsageDays: true, mrpCoverDays: true } });
  const usageWindow = org?.mrpUsageDays ?? 28;
  const historyFrom = addDays(input.today, -Math.max(usageWindow, HISTORY_WEEKS * 7, 90));
  const [generics, balances, usage, losses, settings, recipes, plans, wholesale, receipts, openLines] = await Promise.all([
    tx.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, select: { id: true, name: true, gramsPerPiece: true, perishable: true, baseUnit: { select: { dimension: true, toBase: true, code: true } } } }),
    stockBalances(tx, { orgId: ctx.orgId, warehouseIds: [input.warehouseId] }),
    tx.stockMovement.findMany({ where: { orgId: ctx.orgId, warehouseId: input.warehouseId, source: "production", quantity: { lt: 0 }, occurredAt: { gte: utcDay(historyFrom) } }, select: { genericItemId: true, quantity: true, occurredAt: true } }),
    tx.stockMovement.findMany({ where: { orgId: ctx.orgId, warehouseId: input.warehouseId, source: { in: ["count", "waste"] }, quantity: { lt: 0 }, occurredAt: { gte: utcDay(addDays(input.today, -90)) } }, select: { genericItemId: true, quantity: true, occurredAt: true } }),
    tx.mrpItemSetting.findMany({ where: { orgId: ctx.orgId, OR: [{ warehouseId: input.warehouseId }, { warehouseId: null }] } }),
    tx.recipe.findMany({ where: { orgId: ctx.orgId, active: true }, select: { id: true, name: true, batchGrams: true, outputGenericItemId: true, items: { select: { genericItemId: true, grams: true } } } }),
    tx.productionPlan.findMany({ where: { orgId: ctx.orgId, sourceWarehouseId: input.warehouseId, status: { in: ["PLANNED", "IN_PROGRESS"] }, batchId: null, plannedFor: { gte: utcDay(input.today), lt: utcDay(addDays(input.today, horizon)) } }, select: { recipeId: true, quantityGrams: true, plannedFor: true } }),
    tx.wholesaleOrderLine.findMany({ where: { orgId: ctx.orgId, order: { orgId: ctx.orgId, warehouseId: input.warehouseId, status: "CONFIRMED", neededAt: { gte: utcDay(input.today), lt: utcDay(addDays(input.today, horizon)) } } }, select: { genericItemId: true, quantityBase: true, order: { select: { neededAt: true } } } }),
    tx.purchaseReceipt.findMany({ where: { orgId: ctx.orgId, reversedAt: null, createdAt: { gte: utcDay(addDays(input.today, -180)) }, order: { warehouseId: input.warehouseId } }, select: { orderId: true, createdAt: true, order: { select: { supplierId: true, sentAt: true, createdAt: true } } } }),
    tx.purchaseOrderLine.findMany({ where: { orgId: ctx.orgId, order: { warehouseId: input.warehouseId, status: { in: ["SENT", "PARTIAL"] } } }, select: { genericItemId: true, orderedBaseQty: true, receivedBaseQty: true, closedBaseQty: true } }),
  ]);
  const genericById = new Map(generics.map((generic) => [generic.id, generic]));
  const byDay = (rows: readonly { genericItemId: string | null; quantity: number; occurredAt: Date }[]) => {
    const out = new Map<string, Record<string, number>>();
    for (const row of rows) {
      if (!row.genericItemId) continue;
      const days = out.get(row.genericItemId) ?? {};
      const day = athens(row.occurredAt);
      days[day] = (days[day] ?? 0) - row.quantity;
      out.set(row.genericItemId, days);
    }
    return out;
  };
  const usageById = byDay(usage), lossById = byDay(losses);
  const onHand = new Map<string, number>();
  for (const row of balances) onHand.set(row.genericItemId, (onHand.get(row.genericItemId) ?? 0) + row.quantity);
  for (const line of openLines) onHand.set(line.genericItemId, (onHand.get(line.genericItemId) ?? 0) + Math.max(0, line.orderedBaseQty - line.receivedBaseQty - line.closedBaseQty));

  // Βέβαιη ζήτηση σε γραμμάρια → βασική μονάδα. Τα ημιέτοιμα σε απόθεμα μετρούν μία φορά.
  const outputByRecipe = new Map(recipes.map((recipe) => [recipe.id, recipe.outputGenericItemId]));
  const batches: PlannedBatch[] = plans.flatMap((plan) => (outputByRecipe.get(plan.recipeId) ? [{ genericItemId: outputByRecipe.get(plan.recipeId)!, day: athens(plan.plannedFor), grams: plan.quantityGrams }] : []));
  const grams = (genericItemId: string, base: number) => {
    const generic = genericById.get(genericItemId);
    if (!generic) return 0;
    if (generic.baseUnit.dimension === "mass") return Math.round(base / 1000);
    if (generic.baseUnit.dimension === "volume") return base;
    return base * (generic.gramsPerPiece ?? 0);
  };
  const produced = new Set(recipes.flatMap((recipe) => (recipe.outputGenericItemId ? [recipe.outputGenericItemId] : [])));
  const childStock: Record<string, number> = {};
  for (const id of produced) childStock[id] = grams(id, Math.max(0, onHand.get(id) ?? 0));
  const shortfall = wholesaleShortfall(wholesale.filter((line) => produced.has(line.genericItemId) && line.order.neededAt).map((line) => ({ genericItemId: line.genericItemId, day: athens(line.order.neededAt!), grams: grams(line.genericItemId, line.quantityBase) })), batches, childStock, input.today);
  const { firm, wholesale: wholesaleFirm } = firmDemandWithWholesale(recipes, batches, shortfall.batches, childStock);
  const firmById = new Map<string, Record<string, number>>();
  for (const source of [firm, wholesaleFirm]) for (const [day, itemsByDay] of Object.entries(source)) for (const [id, g] of Object.entries(itemsByDay)) {
    const generic = genericById.get(id);
    if (!generic || g <= 0) continue;
    const days = firmById.get(id) ?? {};
    days[day] = (days[day] ?? 0) + gramsToBaseQty(g, generic.baseUnit, generic.gramsPerPiece);
    firmById.set(id, days);
  }

  const history: ReceiptSample[] = receipts.map((receipt) => ({ supplierId: receipt.order.supplierId, orderId: receipt.orderId, orderDay: athens(receipt.order.sentAt ?? receipt.order.createdAt), receivedDay: athens(receipt.createdAt) }));
  const manualLead: Record<string, number | null> = {};
  for (const setting of settings) if (setting.supplierId && setting.leadDays) manualLead[setting.supplierId] = setting.leadDays;
  const lead = resolveLeadDays(history, manualLead, { today: input.today });

  return generics.flatMap((generic) => {
    if (produced.has(generic.id) && !firmById.has(generic.id)) return []; // ό,τι παράγεται δεν παραγγέλνεται
    const setting = settings.find((row) => row.genericItemId === generic.id && row.warehouseId === input.warehouseId) ?? settings.find((row) => row.genericItemId === generic.id && row.warehouseId === null);
    const usageByDay = usageById.get(generic.id) ?? {};
    const firmByDay = firmById.get(generic.id);
    if (!Object.keys(usageByDay).length && !firmByDay && !setting) return [];
    const leadDays = setting?.supplierId ? lead.days[setting.supplierId] ?? setting.leadDays : setting?.leadDays;
    const result = mrpV2Suggestion({
      today: input.today, onHandBaseQty: onHand.get(generic.id) ?? 0, usageByDay, lossByDay: lossById.get(generic.id), firmByDay,
      mode: (setting?.mode as "auto" | "regular" | "sporadic" | undefined) ?? "auto", leadDays, coverDays: setting?.coverDays ?? org?.mrpCoverDays ?? 4,
      orderDays: setting?.orderDays, usageWindowDays: usageWindow, manualMinBaseQty: setting?.minimumBaseQty, perishable: generic.perishable,
      minimumBaseQty: setting?.minimumBaseQty, orderMultipleBase: setting?.orderMultipleBase,
    });
    return [{ genericItemId: generic.id, name: generic.name, dimension: generic.baseUnit.dimension, unitCode: generic.baseUnit.code, supplierId: setting?.supplierId ?? null, leadSource: setting?.supplierId ? lead.source[setting.supplierId] ?? "manual" : "default", ...result }];
  }).sort((a, b) => b.suggestedBaseQty - a.suggestedBaseQty || a.name.localeCompare(b.name, "el"));
}

// ── καιρός ──────────────────────────────────────────────────────────────────

type WeatherDb = Pick<Prisma.TransactionClient, "store" | "weatherDaily">;
export type FetchJson = (url: string, init: { headers: Record<string, string> }) => Promise<unknown>;

/**
 * Καιρός για κάθε κατάστημα με συντεταγμένες (MET Norway, δύο φορές την ημέρα από το cron). Η σημερινή
 * ημέρα είναι μερική: κρατάμε τη μεγαλύτερη μέγιστη που έχει ήδη αποθηκευτεί. Το MET θέλει User-Agent με
 * στοιχεία επικοινωνίας της εγκατάστασης (MET_NO_USER_AGENT)· χωρίς αυτό δεν καλούμε.
 */
export async function refreshWeather(db: WeatherDb, input: { orgId?: string; userAgent: string; fetchJson?: FetchJson; now?: Date }) {
  if (!input.userAgent.trim()) return { locations: 0, days: 0, skipped: "MET_NO_USER_AGENT" as const };
  const fetchJson: FetchJson = input.fetchJson ?? (async (url, init) => {
    const res = await fetch(url, { headers: init.headers, cache: "no-store" });
    if (!res.ok) throw new Error(`MET Norway ${res.status}`);
    return res.json();
  });
  const stores = await db.store.findMany({ where: { ...(input.orgId ? { orgId: input.orgId } : {}), latitude: { not: null }, longitude: { not: null } }, select: { orgId: true, latitude: true, longitude: true } });
  const locations = new Map<string, { lat: number; lon: number; orgIds: Set<string> }>();
  for (const store of stores) {
    const key = locationKeyOf(store.latitude!, store.longitude!);
    const entry = locations.get(key) ?? { lat: store.latitude!, lon: store.longitude!, orgIds: new Set<string>() };
    entry.orgIds.add(store.orgId);
    locations.set(key, entry);
  }
  const today = athens(input.now ?? new Date());
  let days = 0;
  const failed: string[] = [];
  for (const [locationKey, place] of locations) {
    let parsed;
    try {
      parsed = parseMetNoDaily(await fetchJson(metNoUrl(place.lat, place.lon), { headers: { "User-Agent": input.userAgent, Accept: "application/json" } }));
    } catch {
      failed.push(locationKey); // μία τοποθεσία που απέτυχε δεν σταματά τις υπόλοιπες
      continue;
    }
    for (const orgId of place.orgIds) for (const fresh of parsed) {
      const day = utcDay(fresh.day);
      const stored = await db.weatherDaily.findUnique({ where: { orgId_locationKey_day: { orgId, locationKey, day } } });
      const merged = mergeDay(stored ? { day: fresh.day, tmax: stored.tMaxC10 === null ? null : stored.tMaxC10 / 10, tmin: stored.tMinC10 === null ? null : stored.tMinC10 / 10, precip: stored.rainMm10 === null ? null : stored.rainMm10 / 10, code: stored.code } : null, fresh, fresh.partial || fresh.day === today);
      const data = { tMaxC10: merged.tmax === null ? null : Math.round(merged.tmax * 10), tMinC10: merged.tmin == null ? null : Math.round(merged.tmin * 10), rainMm10: merged.precip === null ? null : Math.round(merged.precip * 10), code: merged.code ?? null, source: "met-no", fetchedAt: input.now ?? new Date() };
      await db.weatherDaily.upsert({ where: { orgId_locationKey_day: { orgId, locationKey, day } }, update: data, create: { orgId, locationKey, day, ...data } });
      days += 1;
    }
  }
  return { locations: locations.size, days, failed };
}

/** Πρόβλεψη ζήτησης με και χωρίς καιρό για τις επόμενες ημέρες (οθόνη «Προγραμματισμός»). */
export async function weatherDemandForecast(tx: Tx, ctx: StockContext, input: { warehouseId: string; genericItemId: string; today: string; days: number }) {
  await assertStockScope(tx, ctx, { warehouseId: input.warehouseId });
  const history = (await demandHistory(tx, { orgId: ctx.orgId, warehouseId: input.warehouseId, from: addDays(input.today, -400), to: addDays(input.today, -1), genericItemIds: [input.genericItemId] })).get(input.genericItemId) ?? [];
  const location = await warehouseLocation(tx, ctx.orgId, input.warehouseId);
  const weather = location ? await weatherFor(tx, { orgId: ctx.orgId, locationKey: location, from: addDays(input.today, -400), to: addDays(input.today, input.days) }) : new Map<string, WeatherDay>();
  const model = fitSeries(history, weather, input.today);
  const days = Array.from({ length: input.days }, (_, i) => addDays(input.today, i)).map((day) => {
    const withWeather = forecastDay(model, day, weather.get(day));
    return { day, withWeatherBase: Math.round(withWeather.qty), withoutWeatherBase: Math.round(withWeather.qty / withWeather.weather.total), weather: weather.get(day) ?? null, factor: withWeather.weather };
  });
  return { model: { base: model.base, lowData: model.lowData, elasticity: model.elasticity, weekday: model.weekday }, days };
}

export { addDaysUtc };
