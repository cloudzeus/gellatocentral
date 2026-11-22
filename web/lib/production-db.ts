// Κλείσιμο παρτίδας παραγωγής: σε ΜΙΑ συναλλαγή δημιουργείται η παρτίδα με τις γραμμές της
// και γράφονται οι αρνητικές κινήσεις αποθέματος (FEFO από StockLot). Ή όλα ή τίποτα.
// Η FEFO κατανομή είναι καθαρή (lib/production.ts) — εδώ γίνεται μόνο η ορχήστρωση.
// Ο σχεδιασμός (planProduction) είναι κοινός με την προεπισκόπηση: ο χρήστης βλέπει ΠΡΙΝ
// το κλείσιμο ποιες παρτίδες — και από ποιον προμηθευτή — θα καταναλωθούν.

import type { db } from "./db";
import { allocateFefo, fefoShortfall, nextBatchNumber, type FefoAllocation, type LotStock } from "./production";
import { postStockMovement, STOCK_ERROR_MESSAGE, StockError } from "./stock-db";
import { stockTransaction } from "./stock-transaction";
import { assertStockScope, STOCK_SCOPE_ERROR_MESSAGE, StockScopeError, type StockContext } from "./stock-scope";
import { gramsToBaseQty, stockCostScale } from "./units";

export class ProductionError extends Error {}

export interface ProductionLotInfo {
  batchNumber: string | null;
  expiresAt: Date | null;
  /** ο προμηθευτής και το τιμολόγιο που έφεραν την παρτίδα (ιχνηλασιμότητα) */
  supplierName: string | null;
  docNumber: string | null;
}

export interface ProductionPlanLine {
  genericItemId: string;
  name: string;
  trackStock: boolean;
  dimension: string;
  unitCode: string;
  /** αναλογούσα ποσότητα της συνταγής (g) */
  grams: number;
  /** κατανάλωση σε βασικές μονάδες */
  quantity: number;
  costHundredths: number;
  /** null μόνο όταν trackStock=false· αλλιώς FEFO αναλώσεις ή null + shortfall αν δεν φτάνει */
  allocations: (FefoAllocation & { lot: ProductionLotInfo })[] | null;
  shortfall: number;
}

export interface ProductionPlan {
  recipe: { id: string; name: string; batchGrams: number };
  warehouse: { id: string; name: string };
  quantityGrams: number;
  costHundredths: number;
  lines: ProductionPlanLine[];
  /** true όταν κάποιο είδος δεν καλύπτεται — το κλείσιμο απαγορεύεται */
  blocked: boolean;
}

type DbLike = Pick<typeof db, "recipe" | "warehouse" | "stockLot" | "stockMovement">;

/**
 * Σχεδιασμός κατανάλωσης χωρίς εγγραφή: κλιμάκωση γραμμών, FEFO ανά είδος, προμηθευτής ανά
 * παρτίδα. Τρέχει και με τον κανονικό client (προεπισκόπηση) και μέσα σε συναλλαγή (κλείσιμο).
 */
export async function planProduction(tx: DbLike, orgId: string, recipeId: string, warehouseId: string, quantityGrams: number): Promise<ProductionPlan> {
  const recipe = await tx.recipe.findFirst({
    where: { id: recipeId, orgId },
    include: { items: { orderBy: { sortOrder: "asc" }, include: { genericItem: { include: { baseUnit: true } } } } },
  });
  if (!recipe || !recipe.active) throw new ProductionError("Η συνταγή δεν βρέθηκε ή είναι κρυφή");
  if (!recipe.items.length) throw new ProductionError("Η συνταγή δεν έχει γραμμές");
  const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, orgId, active: true } });
  if (!warehouse) throw new ProductionError("Η αποθήκη δεν βρέθηκε ή είναι ανενεργή");
  if (!Number.isInteger(quantityGrams) || quantityGrams < 1) throw new ProductionError("Η ποσότητα παραγωγής είναι θετικός ακέραιος (g)");

  const scale = quantityGrams / recipe.batchGrams;
  let blocked = false;
  const lines: ProductionPlanLine[] = [];

  for (const l of recipe.items) {
    const g = l.genericItem;
    const grams = Math.max(1, Math.round(l.grams * scale));
    let quantity = 0;
    if (g.trackStock) {
      try {
        quantity = gramsToBaseQty(grams, g.baseUnit, g.gramsPerPiece);
      } catch (e) {
        throw new ProductionError(`«${g.name}»: ${(e as Error).message}`);
      }
    }
    const line: ProductionPlanLine = {
      genericItemId: g.id,
      name: g.name,
      trackStock: g.trackStock,
      dimension: g.baseUnit.dimension,
      unitCode: g.baseUnit.code,
      grams,
      quantity,
      costHundredths: Math.round((quantity * g.avgCostHundredths) / stockCostScale(g.baseUnit.dimension)),
      allocations: g.trackStock ? null : [],
      shortfall: 0,
    };

    if (g.trackStock) {
      const lots = await tx.stockLot.findMany({
        where: { orgId, genericItemId: g.id, warehouseId },
        select: { id: true, expiresAt: true, batchNumber: true, createdAt: true, document: { select: { number: true, supplier: { select: { name: true } } } } },
        orderBy: { createdAt: "asc" },
      });
      const sums = lots.length
        ? await tx.stockMovement.groupBy({ by: ["lotId"], where: { orgId, lotId: { in: lots.map((x) => x.id) } }, _sum: { quantity: true } })
        : [];
      const available = new Map(sums.map((s) => [s.lotId, s._sum.quantity ?? 0]));
      const stock: LotStock[] = lots.map((x) => ({ id: x.id, expiresAt: x.expiresAt, available: available.get(x.id) ?? 0 }));
      const alloc = allocateFefo(stock, quantity);
      if (!alloc) {
        line.shortfall = fefoShortfall(stock, quantity);
        blocked = true;
      } else {
        const info = new Map(lots.map((x) => [x.id, { batchNumber: x.batchNumber, expiresAt: x.expiresAt, supplierName: x.document?.supplier.name ?? null, docNumber: x.document?.number ?? null }]));
        line.allocations = alloc.map((a) => ({ ...a, lot: info.get(a.lotId)! }));
      }
    }
    lines.push(line);
  }

  return {
    recipe: { id: recipe.id, name: recipe.name, batchGrams: recipe.batchGrams },
    warehouse: { id: warehouse.id, name: warehouse.name },
    quantityGrams,
    costHundredths: lines.reduce((s, l) => s + l.costHundredths, 0),
    lines,
    blocked,
  };
}

export interface CloseProductionInput {
  recipeId: string;
  warehouseId: string;
  /** παράχθηκε (g) — κλίμακα πάνω στο batchGrams της συνταγής */
  quantityGrams: number;
  /** κενό = αυτόματος YYYYMMDD-N */
  batchNumber?: string | null;
  note?: string | null;
  producedAt?: Date;
}

export async function closeProductionBatch(ctx: StockContext, input: CloseProductionInput) {
  const orgId = ctx.orgId;
  try {
    return await stockTransaction(async (tx) => {
      await assertStockScope(tx, ctx, { warehouseId: input.warehouseId, forWrite: true });
      const plan = await planProduction(tx, orgId, input.recipeId, input.warehouseId, input.quantityGrams);
      const short = plan.lines.find((l) => l.shortfall > 0);
      if (short) throw new ProductionError(`Δεν φτάνει το απόθεμα για «${short.name}» — λείπουν ${short.shortfall} ${short.unitCode} στην αποθήκη «${plan.warehouse.name}»`);

      const at = input.producedAt ?? new Date();
      let batchNumber = input.batchNumber?.trim() || "";
      if (!batchNumber) {
        const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate());
        const todayCount = await tx.productionBatch.count({ where: { orgId, producedAt: { gte: dayStart } } });
        batchNumber = nextBatchNumber(at, todayCount + 1);
      }

      const batch = await tx.productionBatch.create({
        data: {
          orgId,
          recipeId: plan.recipe.id,
          warehouseId: plan.warehouse.id,
          batchNumber,
          quantityGrams: plan.quantityGrams,
          costHundredths: plan.costHundredths,
          note: input.note || null,
          producedAt: at,
          createdByName: ctx.userName,
        },
      });

      for (const line of plan.lines) {
        // γραμμή ανά FEFO ανάλωση: η ιχνηλασιμότητα θέλει να ξέρουμε ποια παρτίδα (και ποιος
        // προμηθευτής, μέσω του τιμολογίου της) μπήκε στην παραγωγή
        const splits = line.allocations?.length ? line.allocations : [{ lotId: null as string | null, qty: 0, lot: null as ProductionLotInfo | null }];
        for (const a of splits) {
          const item = await tx.productionBatchItem.create({
            data: {
              orgId,
              batchId: batch.id,
              genericItemId: line.genericItemId,
              grams: line.grams,
              quantity: a.qty,
              lotId: a.lotId,
              costHundredths: a.lotId ? Math.round(a.qty * (line.quantity > 0 ? line.costHundredths / line.quantity : 0)) : line.costHundredths,
            },
          });
          if (a.lotId) {
            await postStockMovement(tx, {
              orgId,
              warehouseId: plan.warehouse.id,
              documentId: batch.id,
              lineId: item.id,
              quantity: -a.qty,
              genericItemId: line.genericItemId,
              lotId: a.lotId,
              source: "production",
              occurredAt: at,
              actor: { id: ctx.userId, name: ctx.userName },
            });
          }
        }
      }

      return batch;
    });
  } catch (error) {
    if (error instanceof StockError) throw new ProductionError(STOCK_ERROR_MESSAGE[error.code]);
    if (error instanceof StockScopeError) throw new ProductionError(STOCK_SCOPE_ERROR_MESSAGE[error.code]);
    throw error;
  }
}
