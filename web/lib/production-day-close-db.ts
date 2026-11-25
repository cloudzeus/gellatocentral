// Μία Serializable transaction για ΟΛΟΚΛΗΡΟ το ημερήσιο κλείσιμο και τις αυτόματες υποσυνταγές.
import { createHash } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { closeProductionBatchTx } from "./production-db";
import { athensDayRange, prepareProductionDayClose, type DayClosePlanInput, type DayCloseStockInput } from "./production-day-close";
import { assertStockScope, type StockContext } from "./stock-scope";
import { stockTransaction } from "./stock-transaction";
import { auditWorkflow, cleanText, WorkflowError } from "./workflow-db";

export type CloseProductionDayInput = {
  businessDate: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  clientKey: string;
  actuals: readonly {
    planId: string;
    quantityGrams: number;
    scrapReason?: string | null;
    labourMinutes?: number;
    labourCostCents?: number;
  }[];
};

function normalizedRequest(input: CloseProductionDayInput) {
  if (!/^[-_a-zA-Z0-9]{8,100}$/.test(input.clientKey)) throw new WorkflowError("Άκυρο κλειδί κλεισίματος ημέρας");
  const ids = new Set<string>();
  const actuals = input.actuals.map((row) => {
    if (ids.has(row.planId)) throw new WorkflowError("Διπλή πραγματική απόδοση στο ίδιο πρόγραμμα");
    ids.add(row.planId);
    return {
      planId: row.planId,
      quantityGrams: row.quantityGrams,
      scrapReason: cleanText(row.scrapReason, "Αιτιολογία φύρας", 300),
      labourMinutes: row.labourMinutes ?? 0,
      labourCostCents: row.labourCostCents ?? 0,
    };
  }).sort((a, b) => a.planId.localeCompare(b.planId));
  const range = athensDayRange(input.businessDate);
  const body = {
    version: 1,
    businessDate: range.date.toISOString().slice(0, 10),
    sourceWarehouseId: input.sourceWarehouseId,
    destinationWarehouseId: input.destinationWarehouseId,
    actuals,
  };
  return { range, actuals, hash: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS lock`;
}

export async function closeProductionDay(ctx: StockContext, input: CloseProductionDayInput) {
  const request = normalizedRequest(input);
  return stockTransaction(async (tx) => {
    // Και το clientKey και η ημέρα κλειδώνουν με σταθερή σειρά, ώστε retry/παράλληλο submit να συγκλίνουν.
    const lockKeys = [
      `production-day-close-key:${ctx.orgId}:${input.clientKey}`,
      `production-day-close:${ctx.orgId}:${input.sourceWarehouseId}:${request.range.date.toISOString().slice(0, 10)}`,
    ].sort();
    for (const key of lockKeys) await lock(tx, key);

    const replay = await tx.productionDayClose.findFirst({ where: { orgId: ctx.orgId, clientKey: input.clientKey } });
    if (replay) {
      if (replay.requestHash !== request.hash) throw new WorkflowError("Το κλειδί κλεισίματος χρησιμοποιήθηκε με διαφορετικά δεδομένα");
      await assertStockScope(tx, ctx, { warehouseIds: [replay.warehouseId, replay.destinationWarehouseId] });
      return replay;
    }
    const previous = await tx.productionDayClose.findFirst({ where: { orgId: ctx.orgId, warehouseId: input.sourceWarehouseId, businessDate: request.range.date } });
    if (previous) throw new WorkflowError("Η ημέρα παραγωγής έχει ήδη κλείσει για αυτή την αποθήκη");
    await assertStockScope(tx, ctx, { warehouseIds: [input.sourceWarehouseId, input.destinationWarehouseId], forWrite: true });

    const plans = await tx.productionPlan.findMany({
      where: {
        orgId: ctx.orgId,
        sourceWarehouseId: input.sourceWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        plannedFor: { gte: request.range.start, lt: request.range.end },
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        batchId: null,
      },
      orderBy: [{ plannedFor: "asc" }, { id: "asc" }],
    });
    if (!plans.length) throw new WorkflowError("Δεν υπάρχουν ανοιχτές παραγωγές για την επιλεγμένη ημέρα και αποθήκες");
    if (request.actuals.length !== plans.length) throw new WorkflowError("Κατέγραψε πραγματική απόδοση για κάθε ανοιχτή παραγωγή της ημέρας");
    const actualByPlan = new Map(request.actuals.map((row) => [row.planId, row]));
    const dayPlans: DayClosePlanInput[] = [];
    for (const plan of plans) {
      await assertStockScope(tx, ctx, { storeId: plan.storeId ?? undefined, forWrite: true });
      const actual = actualByPlan.get(plan.id);
      if (!actual) throw new WorkflowError("Λείπει πραγματική απόδοση από προγραμματισμένη παραγωγή");
      dayPlans.push({
        id: plan.id, recipeId: plan.recipeId, quantityGrams: plan.quantityGrams,
        actualQuantityGrams: actual.quantityGrams, scrapReason: actual.scrapReason,
        labourMinutes: actual.labourMinutes, labourCostCents: actual.labourCostCents, plannedFor: plan.plannedFor,
      });
    }

    const recipes = await tx.recipe.findMany({ where: { orgId: ctx.orgId }, include: { items: { orderBy: { sortOrder: "asc" } } } });
    const outputIds = [...new Set(recipes.flatMap((recipe) => recipe.outputGenericItemId ? [recipe.outputGenericItemId] : []))];
    const [generics, balances] = await Promise.all([
      tx.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: outputIds } }, include: { baseUnit: true } }),
      tx.stockMovement.groupBy({
        by: ["genericItemId", "lotId"],
        where: { orgId: ctx.orgId, warehouseId: input.sourceWarehouseId, genericItemId: { in: outputIds }, lot: { holdStatus: { in: ["AVAILABLE", "RELEASED"] } } },
        _sum: { quantity: true },
      }),
    ]);
    const genericById = new Map(generics.map((generic) => [generic.id, generic]));
    const stock: DayCloseStockInput[] = balances.flatMap((row) => {
      const generic = row.genericItemId ? genericById.get(row.genericItemId) : null;
      const baseQuantity = row._sum.quantity ?? 0;
      return generic && baseQuantity > 0 ? [{ genericItemId: generic.id, baseQuantity, dimension: generic.baseUnit.dimension, gramsPerPiece: generic.gramsPerPiece }] : [];
    });
    const jobs = prepareProductionDayClose(recipes, dayPlans, stock);
    const closedAt = new Date();
    const initialSnapshot = JSON.parse(JSON.stringify({ request: { businessDate: input.businessDate, sourceWarehouseId: input.sourceWarehouseId, destinationWarehouseId: input.destinationWarehouseId, actuals: request.actuals }, jobs }));
    const close = await tx.productionDayClose.create({ data: {
      orgId: ctx.orgId, warehouseId: input.sourceWarehouseId, destinationWarehouseId: input.destinationWarehouseId,
      businessDate: request.range.date, clientKey: input.clientKey, requestHash: request.hash,
      status: "RUNNING", snapshot: initialSnapshot, createdById: ctx.userId, createdByName: ctx.userName, closedAt,
    } });

    const results = [];
    for (const [index, job] of jobs.entries()) {
      const batch = await closeProductionBatchTx(tx, ctx, {
        recipeId: job.recipeId, warehouseId: input.sourceWarehouseId, destinationWarehouseId: job.automatic ? input.sourceWarehouseId : input.destinationWarehouseId,
        quantityGrams: job.actualQuantityGrams, expectedQuantityGrams: job.expectedQuantityGrams,
        wasteGrams: job.expectedQuantityGrams - job.actualQuantityGrams, scrapReason: job.scrapReason,
        labourMinutes: job.labourMinutes, labourCostCents: job.labourCostCents,
        batchNumber: `DC-${input.businessDate.replaceAll("-", "")}-${close.id.slice(-8)}-${String(index + 1).padStart(2, "0")}`,
        note: job.automatic ? "Αυτόματη παραγωγή ημιέτοιμου από ημερήσιο κλείσιμο" : "Ημερήσιο κλείσιμο παραγωγής",
        producedAt: closedAt, productionPlanId: job.planId, leafGenericItemIds: job.leafGenericItemIds,
      });
      results.push({ ...job, batchId: batch.id, outputLotId: batch.outputLotId, batchNumber: batch.batchNumber, wasteGrams: batch.wasteGrams });
    }
    const snapshot = JSON.parse(JSON.stringify({ businessDate: input.businessDate, sourceWarehouseId: input.sourceWarehouseId, destinationWarehouseId: input.destinationWarehouseId, closedAt, results }));
    const completed = await tx.productionDayClose.update({ where: { id: close.id }, data: { status: "COMPLETED", snapshot } });
    await auditWorkflow(tx, {
      orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "production.day.close",
      entityType: "production_day_close", entityId: close.id, warehouseId: input.sourceWarehouseId,
      metadata: { businessDate: input.businessDate, destinationWarehouseId: input.destinationWarehouseId, batches: results.map((row) => row.batchId), automaticBatches: results.filter((row) => row.automatic).length },
    });
    return completed;
  }, { timeout: 120_000, maxWait: 10_000 });
}
