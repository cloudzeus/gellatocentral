"use server";
// Διόρθωση υπολοίπου παρτίδας (ανοικτές συσκευασίες, απογραφή): ρητό γεγονός με υποχρεωτική
// αιτιολογία και το όνομα του χρήστη στην κίνηση — το ίχνος μένει για έλεγχο (ΕΦΕΤ/εσωτερικό).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { correctionBaseQty } from "@/lib/stock-correction";
import { postStockCorrection } from "@/lib/stock-corrections";
import { requireStockContext } from "@/lib/stock-context";
import { stockBalance, STOCK_ERROR_MESSAGE, StockError } from "@/lib/stock-db";
import { assertStockScope, STOCK_SCOPE_ERROR_MESSAGE, StockScopeError } from "@/lib/stock-scope";

export async function correctLotStock(form: FormData) {
  const lotId = String(form.get("lotId") ?? "");
  const path = `/traceability/lot/${lotId}`;
  const fail = (msg: string): never => {
    revalidatePath(path);
    redirect(`${path}?error=${encodeURIComponent(msg)}`);
  };
  const d = z
    .object({
      lotId: z.string().min(1).max(80),
      direction: z.enum(["in", "out"]),
      note: z.string().trim().min(3, "Γράψε αιτιολογία (π.χ. «σπάσιμο συσκευασίας», «μέτρηση απογραφής»)").max(200),
    })
    .safeParse({ lotId, direction: form.get("direction"), note: form.get("note") });
  if (!d.success) return fail(d.error.issues[0].message);
  const amount = Number(String(form.get("amount") ?? "").replace(",", "."));

  const ctx = await requireStockContext("stock.correct");
  const lot = await db.stockLot.findFirst({
    where: { id: d.data.lotId, orgId: ctx.orgId },
    include: { genericItem: { include: { baseUnit: true } } },
  });
  if (!lot) return fail("Άγνωστη παρτίδα");
  await assertStockScope(db, ctx, { warehouseId: lot.warehouseId, forWrite: true });

  const remaining = await stockBalance(db, { orgId: ctx.orgId, warehouseId: lot.warehouseId, genericItemId: lot.genericItemId, lotId: lot.id });
  let quantity: number;
  try {
    quantity = correctionBaseQty({ direction: d.data.direction, amount, dimension: lot.genericItem.baseUnit.dimension, remaining });
  } catch (e) {
    return fail((e as Error).message);
  }

  try {
    await postStockCorrection(ctx, {
      warehouseId: lot.warehouseId,
      lotId: lot.id,
      genericItemId: lot.genericItemId,
      quantity,
      reason: d.data.note,
    });
  } catch (error) {
    if (error instanceof StockError) return fail(STOCK_ERROR_MESSAGE[error.code]);
    if (error instanceof StockScopeError) return fail(STOCK_SCOPE_ERROR_MESSAGE[error.code]);
    throw error;
  }
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}
