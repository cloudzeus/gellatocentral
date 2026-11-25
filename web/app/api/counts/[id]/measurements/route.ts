import { z } from "zod";
import { stockCountHttpError } from "@/lib/stock-count-http";
import { readStockCountRevision, updateStockCountMeasurements } from "@/lib/stock-counts";
import { stockApiContext } from "@/lib/stock-context";

const editSchema = z.object({
  clientKey: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime(),
  measurements: z.array(z.object({
    lineId: z.string().cuid(),
    actualQty: z.number().int().min(0).max(2_147_483_647).nullable(),
    reason: z.string().max(200).nullable().optional(),
  })).min(1).max(1000),
});

/** Η επίλυση conflict διαβάζει μόνο την τρέχουσα revision· δεν γράφει και δεν κάνει finalize. */
export async function GET(_request: Request, context: RouteContext<"/api/counts/[id]/measurements">) {
  const { id } = await context.params;
  const countId = z.string().cuid().safeParse(id);
  if (!countId.success) return Response.json({ code: "COUNT_NOT_FOUND", message: "Η απογραφή δεν βρέθηκε ή δεν έχεις πρόσβαση" }, { status: 404 });
  try {
    const access = await stockApiContext("counts.edit");
    if ("error" in access) return access.error;
    const result = await readStockCountRevision(access.ctx, countId.data);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return stockCountHttpError(error);
  }
}

export async function POST(request: Request, context: RouteContext<"/api/counts/[id]/measurements">) {
  const { id } = await context.params;
  const countId = z.string().cuid().safeParse(id);
  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!countId.success || !parsed.success) return Response.json({ code: "INVALID_COUNT_REQUEST", message: "Το αίτημα μετρήσεων δεν είναι έγκυρο" }, { status: 400 });
  try {
    const access = await stockApiContext("counts.edit");
    if ("error" in access) return access.error;
    const result = await updateStockCountMeasurements(access.ctx, countId.data, parsed.data.measurements, {
      clientKey: parsed.data.clientKey,
      expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
    });
    return Response.json(result);
  } catch (error) {
    return stockCountHttpError(error);
  }
}
