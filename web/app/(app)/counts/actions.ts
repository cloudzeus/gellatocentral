"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStockContext } from "@/lib/stock-context";
import { addStockCountLine, addStockCountLotLine, createStockCount, finalizeStockCount, updateStockCountMeasurements } from "@/lib/stock-counts";
import { stockCountedOnDate, STOCK_COUNT_ERROR_MESSAGE, StockCountError } from "@/lib/stock-count-request";
import { STOCK_ERROR_MESSAGE, StockError } from "@/lib/stock-db";
import { STOCK_SCOPE_ERROR_MESSAGE, StockScopeError } from "@/lib/stock-scope";

const id = z.string().cuid();
const back = (countId?: string) => countId ? `/counts/${countId}` : "/counts";

function fail(error: unknown, countId?: string): never {
  const message = error instanceof StockCountError ? STOCK_COUNT_ERROR_MESSAGE[error.code]
    : error instanceof StockScopeError ? STOCK_SCOPE_ERROR_MESSAGE[error.code]
      : error instanceof StockError ? STOCK_ERROR_MESSAGE[error.code]
        : "Η ενέργεια της απογραφής δεν ολοκληρώθηκε. Ξαναπροσπάθησε.";
  redirect(`${back(countId)}?error=${encodeURIComponent(message)}`);
}

function validCountId(value: string): string {
  const parsed = id.safeParse(value);
  if (!parsed.success) fail(new StockCountError("COUNT_NOT_FOUND"));
  return parsed.data;
}

function refresh(countId?: string) {
  revalidatePath("/counts");
  revalidatePath("/inventory/stock");
  if (countId) revalidatePath(`/counts/${countId}`);
}

export async function createCount(form: FormData) {
  const parsed = z.object({
    clientKey: z.string().uuid(),
    storeId: z.union([id, z.literal("")]).transform((value) => value || null),
    warehouseId: id,
    countedOn: z.string(),
    note: z.string().trim().max(500).transform((value) => value || null),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail(new StockCountError("INVALID_COUNT_REQUEST"));
  const ctx = await requireStockContext("counts.add", { storeId: parsed.data.storeId ?? undefined, warehouseId: parsed.data.warehouseId, forWrite: true });
  let result: Awaited<ReturnType<typeof createStockCount>>;
  try {
    result = await createStockCount(ctx, parsed.data);
  } catch (error) {
    fail(error);
  }
  refresh();
  redirect(`/counts/${result.id}?created=1${result.replayed ? "&replayed=1" : ""}`);
}

export async function saveCountMeasurements(countId: string, form: FormData) {
  const validId = validCountId(countId);
  const lineIds = z.array(id).min(1).max(1000).safeParse(form.getAll("lineIds").map(String));
  if (!lineIds.success || new Set(lineIds.data).size !== lineIds.data.length) fail(new StockCountError("INVALID_COUNT_REQUEST"), validId);
  const measurements = lineIds.data.map((lineId) => {
    const raw = String(form.get(`actual_${lineId}`) ?? "").trim();
    const actualQty = raw === "" ? null : Number(raw);
    if (actualQty !== null && (!Number.isInteger(actualQty) || actualQty < 0 || actualQty > 2_147_483_647)) {
      fail(new StockCountError("INVALID_COUNT_LINE"), validId);
    }
    return { lineId, actualQty, reason: String(form.get(`reason_${lineId}`) ?? "") };
  });
  const ctx = await requireStockContext("counts.edit");
  try {
    await updateStockCountMeasurements(ctx, validId, measurements);
  } catch (error) {
    fail(error, validId);
  }
  refresh(validId);
  redirect(`/counts/${validId}?saved=measurements`);
}

export async function addCountLine(countId: string, form: FormData) {
  const validId = validCountId(countId);
  const parsed = z.object({ stockKey: z.string().min(2).max(180).regex(/^[^|]+\|[^|]*$/) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail(new StockCountError("INVALID_COUNT_REQUEST"), validId);
  const separator = parsed.data.stockKey.indexOf("|");
  const selection = z.object({
    genericItemId: id,
    lotId: z.union([id, z.literal("")]).transform((value) => value || null),
  }).safeParse({
    genericItemId: parsed.data.stockKey.slice(0, separator),
    lotId: parsed.data.stockKey.slice(separator + 1),
  });
  if (!selection.success) fail(new StockCountError("INVALID_COUNT_REQUEST"), validId);
  const ctx = await requireStockContext("counts.edit");
  try {
    await addStockCountLine(ctx, validId, selection.data);
  } catch (error) {
    fail(error, validId);
  }
  refresh(validId);
  redirect(`/counts/${validId}?saved=line`);
}

export async function addCountLot(countId: string, form: FormData) {
  const validId = validCountId(countId);
  const parsed = z.object({
    genericItemId: id,
    batchNumber: z.string().trim().min(1, "Γράψε τον πραγματικό αριθμό παρτίδας").max(80),
    expiresAt: z.string().trim().max(10),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail(new StockCountError("INVALID_COUNT_REQUEST"), validId);
  let expiresAt: Date | null = null;
  try {
    expiresAt = parsed.data.expiresAt ? stockCountedOnDate(parsed.data.expiresAt) : null;
  } catch (error) {
    fail(error, validId);
  }
  const ctx = await requireStockContext("counts.edit");
  try {
    await addStockCountLotLine(ctx, validId, { ...parsed.data, expiresAt });
  } catch (error) {
    fail(error, validId);
  }
  refresh(validId);
  redirect(`/counts/${validId}?saved=lot`);
}

export async function finalizeCount(countId: string) {
  const validId = validCountId(countId);
  const ctx = await requireStockContext("counts.finalize");
  let result: Awaited<ReturnType<typeof finalizeStockCount>>;
  try {
    result = await finalizeStockCount(ctx, validId);
  } catch (error) {
    fail(error, validId);
  }
  refresh(validId);
  redirect(`/counts/${validId}?finalized=1${result.replayed ? "&replayed=1" : ""}`);
}
