// Καθαρό validation κοινής διόρθωσης αποθέματος, χωρίς database ή Next runtime.
import { StockError } from "./stock-db.ts";

export type StockCorrectionInput = {
  warehouseId: string;
  genericItemId: string;
  lotId?: string | null;
  storeId?: string | null;
  quantity: number;
  reason: string;
};

export function canonicalStockCorrection(input: StockCorrectionInput): StockCorrectionInput & { lotId: string | null; storeId: string | null } {
  if (!Number.isSafeInteger(input.quantity) || input.quantity === 0 || input.quantity < -2_147_483_648 || input.quantity > 2_147_483_647) {
    throw new StockError("INVALID_STOCK_INPUT");
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 200) throw new StockError("INVALID_STOCK_INPUT");
  return {
    warehouseId: input.warehouseId,
    genericItemId: input.genericItemId,
    lotId: input.lotId ?? null,
    storeId: input.storeId ?? null,
    quantity: input.quantity,
    reason,
  };
}
