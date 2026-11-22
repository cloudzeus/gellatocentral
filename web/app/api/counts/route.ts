import { z } from "zod";
import { createStockCount } from "@/lib/stock-counts";
import { stockCountHttpError } from "@/lib/stock-count-http";
import { stockApiContext } from "@/lib/stock-context";

const createSchema = z.object({
  clientKey: z.string().uuid(),
  storeId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  countedOn: z.string(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "INVALID_COUNT_REQUEST", message: "Το αίτημα απογραφής δεν είναι έγκυρο" }, { status: 400 });
  try {
    const access = await stockApiContext("counts.add", { storeId: parsed.data.storeId, warehouseId: parsed.data.warehouseId, forWrite: true });
    if ("error" in access) return access.error;
    const result = await createStockCount(access.ctx, parsed.data);
    return Response.json(result);
  } catch (error) {
    return stockCountHttpError(error);
  }
}
