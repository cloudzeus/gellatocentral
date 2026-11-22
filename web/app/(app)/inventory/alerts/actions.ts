"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStockContext } from "@/lib/stock-context";
import { assertStockScope, STOCK_SCOPE_ERROR_MESSAGE, StockScopeError } from "@/lib/stock-scope";

const thresholdInput = z.object({
  warehouseId: z.string().cuid(),
  genericItemId: z.string().cuid(),
  minimumQty: z.coerce.number().int().min(0).max(2_147_483_647),
});
const thresholdKey = thresholdInput.omit({ minimumQty: true });

function fail(message: string): never {
  redirect(`/inventory/alerts?error=${encodeURIComponent(message)}`);
}

function saved(deleted = false): never {
  revalidatePath("/inventory/alerts");
  redirect(`/inventory/alerts?${deleted ? "deleted=1" : "saved=1"}`);
}

export async function saveStockThreshold(form: FormData) {
  const parsed = thresholdInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) fail("Επίλεξε αποθήκη και είδος και γράψε ακέραιο ελάχιστο από 0 και πάνω.");
  const ctx = await requireStockContext("warehouses.edit");
  let validGeneric = true;
  try {
    await db.$transaction(async (tx) => {
      await assertStockScope(tx, ctx, { warehouseId: parsed.data.warehouseId });
      const generic = await tx.genericItem.findFirst({
        where: { id: parsed.data.genericItemId, orgId: ctx.orgId, trackStock: true },
        select: { id: true },
      });
      if (!generic) {
        validGeneric = false;
        return;
      }
      await tx.stockThreshold.upsert({
        where: { orgId_warehouseId_genericItemId: { orgId: ctx.orgId, warehouseId: parsed.data.warehouseId, genericItemId: parsed.data.genericItemId } },
        create: { orgId: ctx.orgId, ...parsed.data },
        update: { minimumQty: parsed.data.minimumQty },
      });
    });
  } catch (error) {
    fail(error instanceof StockScopeError ? STOCK_SCOPE_ERROR_MESSAGE[error.code] : "Το ελάχιστο απόθεμα δεν αποθηκεύτηκε. Ξαναπροσπάθησε.");
  }
  if (!validGeneric) fail("Το είδος δεν βρέθηκε στην επιχείρηση ή δεν παρακολουθεί απόθεμα.");
  saved();
}

export async function deleteStockThreshold(form: FormData) {
  const parsed = thresholdKey.safeParse(Object.fromEntries(form));
  if (!parsed.success) fail("Η εγγραφή ελάχιστου αποθέματος δεν είναι έγκυρη.");
  const ctx = await requireStockContext("warehouses.edit");
  try {
    await db.$transaction(async (tx) => {
      await assertStockScope(tx, ctx, { warehouseId: parsed.data.warehouseId });
      await tx.stockThreshold.deleteMany({ where: { orgId: ctx.orgId, ...parsed.data } });
    });
  } catch (error) {
    fail(error instanceof StockScopeError ? STOCK_SCOPE_ERROR_MESSAGE[error.code] : "Το ελάχιστο απόθεμα δεν διαγράφηκε. Ξαναπροσπάθησε.");
  }
  saved(true);
}
