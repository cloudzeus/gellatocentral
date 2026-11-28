// DB wrapper της καθαρής πρόβλεψης· όλα τα aggregates έχουν orgId και μία επιτρεπτή αποθήκη.
import type { Prisma } from "./generated/prisma/client";
import { businessDay } from "./consumption-rules";
import { calculateForecast, type ForecastResult } from "./forecast";
import { assertStockScope, type StockContext } from "./stock-scope";
import { gramsToBaseQty } from "./units";

export type ForecastRow = ForecastResult & { name: string; dimension: string; unitCode: string };

export async function productionForecast(tx: Prisma.TransactionClient, ctx: StockContext, warehouseId: string, now = new Date()): Promise<ForecastRow[]> {
  await assertStockScope(tx, ctx, { warehouseId });
  const historyStart = new Date(now.getTime() - 28 * 86400000);
  const forecastEnd = new Date(now.getTime() + 7 * 86400000);
  const [generics, history, wholesale, available, plans] = await Promise.all([
    tx.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, include: { baseUnit: true }, orderBy: { name: "asc" } }),
    // Ιστορικό από τη μηχανή κατανάλωσης: πραγματική κατανάλωση (ταμείο ή απογραφή), χωρίς χονδρική και φύρα.
    tx.demandDaily.groupBy({ by: ["genericItemId"], where: { orgId: ctx.orgId, warehouseId, day: { gte: businessDay(historyStart), lt: businessDay(now) } }, _sum: { consumedBase: true } }),
    tx.wholesaleOrderLine.groupBy({ by: ["genericItemId"], where: { orgId: ctx.orgId, order: { orgId: ctx.orgId, warehouseId, status: "CONFIRMED", neededAt: { gte: now, lt: forecastEnd } } }, _sum: { quantityBase: true } }),
    tx.stockMovement.groupBy({ by: ["genericItemId", "lotId"], where: { orgId: ctx.orgId, warehouseId, lot: { holdStatus: { in: ["AVAILABLE", "RELEASED"] } } }, _sum: { quantity: true } }),
    tx.productionPlan.findMany({ where: { orgId: ctx.orgId, destinationWarehouseId: warehouseId, status: { in: ["PLANNED", "IN_PROGRESS"] }, batchId: null, plannedFor: { lt: forecastEnd } }, select: { recipeId: true, quantityGrams: true } }),
  ]);
  const recipes = await tx.recipe.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set(plans.map((plan) => plan.recipeId))] } }, select: { id: true, outputGenericItemId: true } });
  const outputByRecipe = new Map(recipes.map((recipe) => [recipe.id, recipe.outputGenericItemId]));
  const genericById = new Map(generics.map((generic) => [generic.id, generic]));
  const historyById = new Map(history.map((row) => [row.genericItemId, Math.max(0, row._sum.consumedBase ?? 0)]));
  const wholesaleById = new Map(wholesale.map((row) => [row.genericItemId, row._sum.quantityBase ?? 0]));
  const availableById = new Map<string, number>();
  for (const row of available) {
    if (!row.genericItemId || (row._sum.quantity ?? 0) <= 0) continue;
    availableById.set(row.genericItemId, (availableById.get(row.genericItemId) ?? 0) + row._sum.quantity!);
  }
  const plannedById = new Map<string, number>();
  for (const plan of plans) {
    const genericId = outputByRecipe.get(plan.recipeId);
    const generic = genericId ? genericById.get(genericId) : null;
    if (!generic) continue;
    const quantity = gramsToBaseQty(plan.quantityGrams, generic.baseUnit, generic.gramsPerPiece);
    plannedById.set(generic.id, (plannedById.get(generic.id) ?? 0) + quantity);
  }

  return generics.flatMap((generic) => {
    const input = {
      genericItemId: generic.id,
      historicalBase: historyById.get(generic.id) ?? 0,
      confirmedWholesaleBase: wholesaleById.get(generic.id) ?? 0,
      availableBase: availableById.get(generic.id) ?? 0,
      plannedProductionBase: plannedById.get(generic.id) ?? 0,
    };
    if (Object.values(input).every((value) => typeof value === "string" || value === 0)) return [];
    return [{ ...calculateForecast(input), name: generic.name, dimension: generic.baseUnit.dimension, unitCode: generic.baseUnit.code }];
  });
}
