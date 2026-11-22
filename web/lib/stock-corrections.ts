// Κοινή append-only διόρθωση: φρέσκο scope, αρνητικό guard, actor και audit στο ίδιο Serializable transaction.
import type { StockMovement } from "./generated/prisma/client.ts";
import { writeAudit } from "./audit.ts";
import { canonicalStockCorrection, type StockCorrectionInput } from "./stock-correction-request.ts";
import { postStockMovement } from "./stock-db.ts";
import { assertStockScope, type StockContext } from "./stock-scope.ts";
import { stockTransaction } from "./stock-transaction.ts";

export type { StockCorrectionInput } from "./stock-correction-request.ts";

/** Δεν υπάρχει update/delete ιστορικού· κάθε αλλαγή είναι νέα κίνηση και νέο audit event. */
export async function postStockCorrection(ctx: StockContext, input: StockCorrectionInput): Promise<StockMovement> {
  const correction = canonicalStockCorrection(input);
  return stockTransaction(async (tx) => {
    await assertStockScope(tx, ctx, {
      storeId: correction.storeId ?? undefined,
      warehouseId: correction.warehouseId,
      forWrite: true,
    });
    const movement = await postStockMovement(tx, {
      orgId: ctx.orgId,
      warehouseId: correction.warehouseId,
      genericItemId: correction.genericItemId,
      lotId: correction.lotId,
      storeId: correction.storeId,
      quantity: correction.quantity,
      source: "manual",
      note: correction.reason,
      actor: { id: ctx.userId, name: ctx.userName },
    });
    await writeAudit(tx, {
      orgId: ctx.orgId,
      actor: { id: ctx.userId, name: ctx.userName },
      action: "stock.correction.posted",
      entityType: "stock_movement",
      entityId: movement.id,
      storeId: correction.storeId,
      warehouseId: correction.warehouseId,
      reason: correction.reason,
      metadata: {
        genericItemId: correction.genericItemId,
        lotId: correction.lotId,
        quantity: correction.quantity,
      },
    });
    return movement;
  });
}
