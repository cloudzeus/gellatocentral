"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStockContext } from "@/lib/stock-context";
import { STOCK_ERROR_MESSAGE, StockError } from "@/lib/stock-db";
import { STOCK_SCOPE_ERROR_MESSAGE, StockScopeError } from "@/lib/stock-scope";
import { postStockTransfer } from "@/lib/stock-transfers";
import { STOCK_TRANSFER_ERROR_MESSAGE, StockTransferError } from "@/lib/stock-transfer-request";

const id = z.string().cuid();
const formSchema = z.object({
  clientKey: z.string().uuid(),
  sourceWarehouseId: id,
  destinationWarehouseId: id,
  storeId: z.string().transform((value) => value || null).pipe(z.union([id, z.null()])),
  stockKey: z.string().min(2).max(180).regex(/^[^|]+\|[^|]*$/),
  quantity: z.coerce.number().int().positive().max(2_147_483_647),
  note: z.string().trim().max(500).transform((value) => value || null),
});

function fail(error: unknown): never {
  const message = error instanceof StockTransferError ? STOCK_TRANSFER_ERROR_MESSAGE[error.code]
    : error instanceof StockScopeError ? STOCK_SCOPE_ERROR_MESSAGE[error.code]
      : error instanceof StockError ? STOCK_ERROR_MESSAGE[error.code]
        : "Η μεταφορά δεν ολοκληρώθηκε. Ξαναπροσπάθησε.";
  redirect(`/inventory/transfers?error=${encodeURIComponent(message)}`);
}

export async function postTransfer(form: FormData) {
  const parsed = formSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) fail(new StockTransferError("INVALID_TRANSFER_REQUEST"));
  const separator = parsed.data.stockKey.indexOf("|");
  const selection = z.object({
    genericItemId: id,
    sourceLotId: z.union([id, z.literal("")]).transform((value) => value || null),
  }).safeParse({
    genericItemId: parsed.data.stockKey.slice(0, separator),
    sourceLotId: parsed.data.stockKey.slice(separator + 1),
  });
  if (!selection.success) fail(new StockTransferError("INVALID_TRANSFER_REQUEST"));

  const ctx = await requireStockContext("stock.transfer", {
    storeId: parsed.data.storeId ?? undefined,
    warehouseIds: [parsed.data.sourceWarehouseId, parsed.data.destinationWarehouseId],
    forWrite: true,
  });
  let result: Awaited<ReturnType<typeof postStockTransfer>>;
  try {
    result = await postStockTransfer(ctx, {
      clientKey: parsed.data.clientKey,
      sourceWarehouseId: parsed.data.sourceWarehouseId,
      destinationWarehouseId: parsed.data.destinationWarehouseId,
      storeId: parsed.data.storeId,
      note: parsed.data.note,
      lines: [{ ...selection.data, quantity: parsed.data.quantity }],
    });
  } catch (error) {
    fail(error);
  }
  revalidatePath("/inventory/transfers");
  revalidatePath("/inventory/stock");
  redirect(`/inventory/transfers?posted=${encodeURIComponent(result.id)}${result.replayed ? "&replayed=1" : ""}`);
}
