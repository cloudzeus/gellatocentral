// Παραγωγή: αναδρομική συνταγή, FEFO αναλώσεις, αμετάβλητο snapshot και output lot σε ΜΙΑ transaction.
// Οι διορθώσεις μετά το κλείσιμο αλλάζουν μόνο το output με append-only κίνηση, ποτέ τις αναλώσεις.
import type { Prisma } from "./generated/prisma/client";
import type { db } from "./db";
import { allocateFefo, fefoShortfall, nextBatchNumber, type FefoAllocation, type LotStock } from "./production";
import { expandRecipe } from "./recipe-graph";
import { genericStockBalance, postStockMovement, STOCK_ERROR_MESSAGE, StockError } from "./stock-db";
import { stockTransaction } from "./stock-transaction";
import { assertStockScope, STOCK_SCOPE_ERROR_MESSAGE, StockScopeError, type StockContext } from "./stock-scope";
import { gramsToBaseQty, stockCostScale } from "./units";
import { assertNonNegativeInt, assertPositiveInt, auditWorkflow, cleanText } from "./workflow-db";

export class ProductionError extends Error {}

export interface ProductionLotInfo {
  batchNumber: string | null;
  expiresAt: Date | null;
  supplierName: string | null;
  docNumber: string | null;
}

export interface ProductionPlanLine {
  genericItemId: string;
  name: string;
  trackStock: boolean;
  dimension: string;
  unitCode: string;
  grams: number;
  quantity: number;
  costHundredths: number;
  viaRecipeIds: string[];
  allocations: (FefoAllocation & { lot: ProductionLotInfo })[] | null;
  shortfall: number;
}

export interface ProductionPlan {
  recipe: { id: string; name: string; batchGrams: number; outputGenericItemId: string | null; shelfLifeDays: number | null };
  warehouse: { id: string; name: string };
  quantityGrams: number;
  costHundredths: number;
  lines: ProductionPlanLine[];
  blocked: boolean;
  snapshot: Record<string, unknown>;
}

type DbLike = Pick<typeof db, "recipe" | "genericItem" | "warehouse" | "stockLot" | "stockMovement">;

/** Η ίδια ανάλυση τρέχει στην προεπισκόπηση και στο κλείσιμο, ώστε να μην αποκλίνουν οι αναλώσεις. */
export async function planProduction(tx: DbLike, orgId: string, recipeId: string, warehouseId: string, quantityGrams: number, leafGenericItemIds: readonly string[] = []): Promise<ProductionPlan> {
  assertPositiveInt(quantityGrams, "Ποσότητα παραγωγής");
  const [recipes, warehouse] = await Promise.all([
    tx.recipe.findMany({ where: { orgId }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
    tx.warehouse.findFirst({ where: { id: warehouseId, orgId, active: true } }),
  ]);
  if (!warehouse) throw new ProductionError("Η αποθήκη δεν βρέθηκε ή είναι ανενεργή");
  let expanded: ReturnType<typeof expandRecipe>;
  try { expanded = expandRecipe(recipes, recipeId, quantityGrams, leafGenericItemIds); }
  catch (error) { throw new ProductionError(error instanceof Error ? error.message : "Άκυρη συνταγή"); }

  const generics = await tx.genericItem.findMany({ where: { orgId, id: { in: expanded.lines.map((line) => line.genericItemId) } }, include: { baseUnit: true } });
  const byId = new Map(generics.map((generic) => [generic.id, generic]));
  if (generics.length !== expanded.lines.length) throw new ProductionError("Κάποιο είδος της συνταγής δεν βρέθηκε");
  let blocked = false;
  const lines: ProductionPlanLine[] = [];

  for (const expandedLine of expanded.lines) {
    const generic = byId.get(expandedLine.genericItemId)!;
    const grams = expandedLine.grams;
    let quantity = 0;
    if (generic.trackStock) {
      try { quantity = gramsToBaseQty(grams, generic.baseUnit, generic.gramsPerPiece); }
      catch (error) { throw new ProductionError(`«${generic.name}»: ${(error as Error).message}`); }
    }
    const line: ProductionPlanLine = {
      genericItemId: generic.id,
      name: generic.name,
      trackStock: generic.trackStock,
      dimension: generic.baseUnit.dimension,
      unitCode: generic.baseUnit.code,
      grams,
      quantity,
      costHundredths: Math.round(quantity * generic.avgCostHundredths / stockCostScale(generic.baseUnit.dimension)),
      viaRecipeIds: expandedLine.viaRecipeIds,
      allocations: generic.trackStock ? null : [],
      shortfall: 0,
    };
    if (generic.trackStock) {
      const lots = await tx.stockLot.findMany({
        where: { orgId, genericItemId: generic.id, warehouseId, holdStatus: { in: ["AVAILABLE", "RELEASED"] } },
        select: { id: true, expiresAt: true, batchNumber: true, createdAt: true, document: { select: { number: true, supplier: { select: { name: true } } } } },
        orderBy: { createdAt: "asc" },
      });
      const sums = lots.length ? await tx.stockMovement.groupBy({ by: ["lotId"], where: { orgId, lotId: { in: lots.map((lot) => lot.id) } }, _sum: { quantity: true } }) : [];
      const available = new Map(sums.map((sum) => [sum.lotId, sum._sum.quantity ?? 0]));
      const stock: LotStock[] = lots.map((lot) => ({ id: lot.id, expiresAt: lot.expiresAt, available: available.get(lot.id) ?? 0 }));
      const allocation = allocateFefo(stock, quantity);
      if (!allocation) {
        line.shortfall = fefoShortfall(stock, quantity);
        blocked = true;
      } else {
        const info = new Map(lots.map((lot) => [lot.id, { batchNumber: lot.batchNumber, expiresAt: lot.expiresAt, supplierName: lot.document?.supplier.name ?? null, docNumber: lot.document?.number ?? null }]));
        line.allocations = allocation.map((part) => ({ ...part, lot: info.get(part.lotId)! }));
      }
    }
    lines.push(line);
  }

  return {
    recipe: { id: expanded.root.id, name: expanded.root.name, batchGrams: expanded.root.batchGrams, outputGenericItemId: expanded.root.outputGenericItemId ?? null, shelfLifeDays: expanded.root.shelfLifeDays ?? null },
    warehouse: { id: warehouse.id, name: warehouse.name },
    quantityGrams,
    costHundredths: lines.reduce((sum, line) => sum + line.costHundredths, 0),
    lines,
    blocked,
    snapshot: expanded.snapshot,
  };
}

export interface CloseProductionInput {
  recipeId: string;
  warehouseId: string;
  quantityGrams: number;
  expectedQuantityGrams?: number | null;
  destinationWarehouseId?: string | null;
  outputGenericItemId?: string | null;
  wasteGrams?: number;
  scrapReason?: string | null;
  labourMinutes?: number;
  labourCostCents?: number;
  batchNumber?: string | null;
  note?: string | null;
  producedAt?: Date;
  productionPlanId?: string | null;
  /** Μόνο για orchestration ημέρας: τα ημιέτοιμα έχουν ήδη παραχθεί και καταναλώνονται ως stock. */
  leafGenericItemIds?: readonly string[];
}

async function updateOutputAverage(tx: Prisma.TransactionClient, orgId: string, genericItemId: string, deltaQuantity: number, unitCostHundredths: number) {
  const generic = await tx.genericItem.findFirst({ where: { id: genericItemId, orgId }, select: { avgCostHundredths: true } });
  if (!generic) throw new ProductionError("Το παραγόμενο είδος δεν βρέθηκε");
  const stock = await genericStockBalance(tx, orgId, genericItemId);
  if (deltaQuantity > 0) {
    const next = stock <= 0 ? unitCostHundredths : Math.round((stock * generic.avgCostHundredths + deltaQuantity * unitCostHundredths) / (stock + deltaQuantity));
    await tx.genericItem.update({ where: { id: genericItemId }, data: { avgCostHundredths: next } });
  } else if (deltaQuantity < 0 && stock > 0 && stock + deltaQuantity > 0) {
    const next = Math.round((stock * generic.avgCostHundredths + deltaQuantity * unitCostHundredths) / (stock + deltaQuantity));
    if (next < 0) throw new ProductionError("Η διόρθωση αποδίδει μη έγκυρο μέσο κόστος· απαιτείται λογιστική διόρθωση");
    await tx.genericItem.update({ where: { id: genericItemId }, data: { avgCostHundredths: next } });
  }
}

export async function closeProductionBatchTx(tx: Prisma.TransactionClient, ctx: StockContext, input: CloseProductionInput) {
  const orgId = ctx.orgId;
  try {
      const destinationWarehouseId = input.destinationWarehouseId || input.warehouseId;
      await assertStockScope(tx, ctx, { warehouseIds: [input.warehouseId, destinationWarehouseId], forWrite: true });
      if (input.productionPlanId) {
        const scheduled = await tx.productionPlan.findFirst({ where: { id: input.productionPlanId, orgId } });
        if (!scheduled || scheduled.batchId || !["PLANNED", "IN_PROGRESS"].includes(scheduled.status)) throw new ProductionError("Ο προγραμματισμός δεν είναι διαθέσιμος για ολοκλήρωση");
        if (scheduled.recipeId !== input.recipeId || scheduled.sourceWarehouseId !== input.warehouseId || scheduled.destinationWarehouseId !== destinationWarehouseId || scheduled.quantityGrams !== input.expectedQuantityGrams) throw new ProductionError("Τα δεδομένα δεν συμφωνούν με τον προγραμματισμό παραγωγής");
        await assertStockScope(tx, ctx, { storeId: scheduled.storeId ?? undefined, forWrite: true });
      }
      const expected = input.expectedQuantityGrams ?? input.quantityGrams;
      assertPositiveInt(expected, "Αναμενόμενη ποσότητα");
      assertPositiveInt(input.quantityGrams, "Πραγματική ποσότητα");
      if (input.quantityGrams > expected) throw new ProductionError("Η πραγματική ποσότητα δεν μπορεί να υπερβαίνει την αναμενόμενη");
      const waste = input.wasteGrams ?? expected - input.quantityGrams;
      assertNonNegativeInt(waste, "Φύρα");
      if (waste !== expected - input.quantityGrams) throw new ProductionError("Η φύρα πρέπει να ισούται με αναμενόμενη μείον πραγματική ποσότητα");
      const scrapReason = cleanText(input.scrapReason, "Αιτιολογία φύρας", 300);
      if (waste > 0 && !scrapReason) throw new ProductionError("Η φύρα χρειάζεται αιτιολογία");
      const labourMinutes = input.labourMinutes ?? 0;
      const labourCostCents = input.labourCostCents ?? 0;
      assertNonNegativeInt(labourMinutes, "Λεπτά εργασίας", 100000);
      assertNonNegativeInt(labourCostCents, "Κόστος εργασίας");
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`production-recipe:${orgId}:${input.recipeId}`}, 0))) AS lock`;
      const plan = await planProduction(tx, orgId, input.recipeId, input.warehouseId, expected, input.leafGenericItemIds);
      const short = plan.lines.find((line) => line.shortfall > 0);
      if (short) throw new ProductionError(`Δεν φτάνει το απόθεμα για «${short.name}» — λείπουν ${short.shortfall} ${short.unitCode} στην αποθήκη «${plan.warehouse.name}»`);
      const outputGenericItemId = input.outputGenericItemId === undefined ? plan.recipe.outputGenericItemId : input.outputGenericItemId;
      const outputGeneric = outputGenericItemId ? await tx.genericItem.findFirst({ where: { id: outputGenericItemId, orgId, active: true, trackStock: true }, include: { baseUnit: true } }) : null;
      if (outputGenericItemId && !outputGeneric) throw new ProductionError("Το παραγόμενο είδος αποθέματος δεν βρέθηκε ή είναι ανενεργό");
      if (outputGeneric && plan.lines.some((line) => line.genericItemId === outputGeneric.id)) throw new ProductionError("Το παραγόμενο είδος δεν μπορεί να είναι ταυτόχρονα πρώτη ύλη της ίδιας παρτίδας");

      const at = input.producedAt ?? new Date();
      let batchNumber = cleanText(input.batchNumber, "Αριθμός παρτίδας", 80);
      if (!batchNumber) {
        const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate());
        const todayCount = await tx.productionBatch.count({ where: { orgId, producedAt: { gte: dayStart } } });
        batchNumber = nextBatchNumber(at, todayCount + 1);
      }
      const versionCount = await tx.recipeVersion.count({ where: { orgId, recipeId: plan.recipe.id } });
      const version = await tx.recipeVersion.create({ data: { orgId, recipeId: plan.recipe.id, version: versionCount + 1, snapshot: JSON.parse(JSON.stringify(plan.snapshot)), createdByName: ctx.userName } });
      const batch = await tx.productionBatch.create({ data: {
        orgId, recipeId: plan.recipe.id, warehouseId: plan.warehouse.id, destinationWarehouseId,
        outputGenericItemId: outputGeneric?.id ?? null, recipeVersionId: version.id, recipeSnapshot: JSON.parse(JSON.stringify(plan.snapshot)),
        batchNumber, quantityGrams: input.quantityGrams, expectedQuantityGrams: input.expectedQuantityGrams == null ? null : expected,
        wasteGrams: waste, scrapReason, labourMinutes, labourCostCents,
        costHundredths: plan.costHundredths, note: cleanText(input.note, "Σημείωση", 500), producedAt: at, createdByName: ctx.userName,
      } });

      for (const line of plan.lines) {
        const splits = line.allocations?.length ? line.allocations : [{ lotId: null as string | null, qty: 0, lot: null as ProductionLotInfo | null }];
        for (const allocation of splits) {
          const item = await tx.productionBatchItem.create({ data: {
            orgId, batchId: batch.id, genericItemId: line.genericItemId, grams: line.grams, quantity: allocation.qty, lotId: allocation.lotId,
            costHundredths: allocation.lotId ? Math.round(allocation.qty * (line.quantity > 0 ? line.costHundredths / line.quantity : 0)) : line.costHundredths,
          } });
          if (allocation.lotId) await postStockMovement(tx, {
            orgId, warehouseId: plan.warehouse.id, documentId: batch.id, lineId: item.id, quantity: -allocation.qty,
            genericItemId: line.genericItemId, lotId: allocation.lotId, source: "production", occurredAt: at,
            actor: { id: ctx.userId, name: ctx.userName },
          });
        }
      }

      let outputLotId: string | null = null;
      if (outputGeneric) {
        const outputQuantity = gramsToBaseQty(input.quantityGrams, outputGeneric.baseUnit, outputGeneric.gramsPerPiece);
        const outputCost = Math.round((plan.costHundredths + labourCostCents * 100) * stockCostScale(outputGeneric.baseUnit.dimension) / outputQuantity);
        const expiresAt = plan.recipe.shelfLifeDays ? new Date(at.getTime() + plan.recipe.shelfLifeDays * 86400000) : null;
        const lot = await tx.stockLot.create({ data: { orgId, genericItemId: outputGeneric.id, warehouseId: destinationWarehouseId, batchNumber, expiresAt, productionBatchId: batch.id } });
        outputLotId = lot.id;
        await updateOutputAverage(tx, orgId, outputGeneric.id, outputQuantity, outputCost);
        await postStockMovement(tx, {
          orgId, warehouseId: destinationWarehouseId, documentId: batch.id, lineId: `output:${batch.id}`, quantity: outputQuantity,
          unitCostHundredths: outputCost, genericItemId: outputGeneric.id, lotId: lot.id, source: "production_output", occurredAt: at,
          actor: { id: ctx.userId, name: ctx.userName },
        });
        await tx.productionBatch.update({ where: { id: batch.id }, data: { outputLotId } });
      }
      if (input.productionPlanId) {
        const scheduled = await tx.productionPlan.updateMany({ where: { id: input.productionPlanId, orgId, batchId: null, status: { in: ["PLANNED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", batchId: batch.id } });
        if (scheduled.count !== 1) throw new ProductionError("Ο προγραμματισμός ολοκληρώθηκε ταυτόχρονα από άλλη ενέργεια");
      }
      await auditWorkflow(tx, { orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "production.close", entityType: "production_batch", entityId: batch.id, warehouseId: plan.warehouse.id, metadata: { recipeVersionId: version.id, expected, actual: input.quantityGrams, waste, outputLotId, destinationWarehouseId } });
      return { ...batch, outputLotId };
  } catch (error) {
    if (error instanceof StockError) throw new ProductionError(STOCK_ERROR_MESSAGE[error.code]);
    if (error instanceof StockScopeError) throw new ProductionError(STOCK_SCOPE_ERROR_MESSAGE[error.code]);
    throw error;
  }
}

export async function closeProductionBatch(ctx: StockContext, input: CloseProductionInput) {
  return stockTransaction((tx) => closeProductionBatchTx(tx, ctx, input));
}

export async function correctProductionOutput(ctx: StockContext, input: { batchId: string; correctedQuantityGrams: number; reason: string }) {
  assertPositiveInt(input.correctedQuantityGrams, "Διορθωμένη ποσότητα");
  const reason = cleanText(input.reason, "Αιτιολογία διόρθωσης", 300, true);
  try {
    return await stockTransaction(async (tx) => {
      const batch = await tx.productionBatch.findFirst({ where: { id: input.batchId, orgId: ctx.orgId } });
      if (!batch) throw new ProductionError("Η παρτίδα δεν βρέθηκε");
      await assertStockScope(tx, ctx, { warehouseId: batch.destinationWarehouseId ?? batch.warehouseId, forWrite: true });
      if (!batch.outputLotId || !batch.outputGenericItemId) throw new ProductionError("Η παλιά παρτίδα δεν έχει output lot· δεν επιτρέπεται αυτόματη διόρθωση");
      if (input.correctedQuantityGrams === batch.quantityGrams) throw new ProductionError("Η ποσότητα είναι ήδη καταχωρημένη");
      const outputLot = await tx.stockLot.findFirst({ where: { id: batch.outputLotId, orgId: ctx.orgId }, include: { genericItem: { include: { baseUnit: true } }, movements: { where: { source: "production_output" }, orderBy: { recordedAt: "asc" }, take: 1 } } });
      if (!outputLot) throw new ProductionError("Η παρτίδα output δεν βρέθηκε");
      const deltaGrams = input.correctedQuantityGrams - batch.quantityGrams;
      const deltaQuantity = gramsToBaseQty(Math.abs(deltaGrams), outputLot.genericItem.baseUnit, outputLot.genericItem.gramsPerPiece) * Math.sign(deltaGrams);
      const unitCost = outputLot.movements[0]?.unitCostHundredths ?? outputLot.genericItem.avgCostHundredths;
      await updateOutputAverage(tx, ctx.orgId, batch.outputGenericItemId, deltaQuantity, unitCost);
      await postStockMovement(tx, {
        orgId: ctx.orgId, warehouseId: outputLot.warehouseId, documentId: batch.id, lineId: `correction:${batch.id}:${Date.now()}`,
        quantity: deltaQuantity, unitCostHundredths: unitCost, genericItemId: batch.outputGenericItemId, lotId: outputLot.id,
        source: "production_correction", note: reason, actor: { id: ctx.userId, name: ctx.userName },
      });
      const expected = batch.expectedQuantityGrams ?? batch.quantityGrams;
      if (input.correctedQuantityGrams > expected) throw new ProductionError("Η διόρθωση υπερβαίνει την αναμενόμενη ποσότητα της παρτίδας");
      const updated = await tx.productionBatch.updateMany({ where: { id: batch.id, orgId: ctx.orgId, quantityGrams: batch.quantityGrams }, data: { quantityGrams: input.correctedQuantityGrams, wasteGrams: expected - input.correctedQuantityGrams, scrapReason: reason } });
      if (updated.count !== 1) throw new ProductionError("Η παρτίδα άλλαξε ταυτόχρονα· ξαναφόρτωσε και δοκίμασε πάλι");
      await tx.productionCorrection.create({ data: { orgId: ctx.orgId, batchId: batch.id, previousQuantityGrams: batch.quantityGrams, correctedQuantityGrams: input.correctedQuantityGrams, deltaGrams, reason: reason!, createdByName: ctx.userName } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "production.correct", entityType: "production_batch", entityId: batch.id, warehouseId: outputLot.warehouseId, reason, metadata: { previous: batch.quantityGrams, corrected: input.correctedQuantityGrams, deltaGrams, deltaQuantity } });
      return { ...batch, quantityGrams: input.correctedQuantityGrams };
    });
  } catch (error) {
    if (error instanceof StockError) throw new ProductionError(STOCK_ERROR_MESSAGE[error.code]);
    if (error instanceof StockScopeError) throw new ProductionError(STOCK_SCOPE_ERROR_MESSAGE[error.code]);
    throw error;
  }
}
