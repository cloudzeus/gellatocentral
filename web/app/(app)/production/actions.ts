"use server";
// Παρτίδες παραγωγής: δημιουργία = ατομικό κλείσιμο (FEFO κατανάλωση υλικών σε μία συναλλαγή).
// Η παρτίδα παραγωγής δεν αλλάζει μετά — είναι ιστορικό γεγονός ιχνηλασιμότητας.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ProductionError, closeProductionBatch, correctProductionOutput } from "@/lib/production-db";
import { requireStockContext } from "@/lib/stock-context";
import { rethrowControlFlow } from "@/lib/workflow-db";

const fail = (msg: string): never => {
  revalidatePath("/production");
  redirect(`/production?error=${encodeURIComponent(msg)}`);
};

/** Νέα παρτίδα παραγωγής: συνταγή, αποθήκη, ποσότητα. Το υπόλοιπο ελέγχεται FEFO στη συναλλαγή. */
export async function createBatch(form: FormData) {
  const recipeId = String(form.get("recipeId") ?? "");
  const warehouseId = String(form.get("warehouseId") ?? "");
  const destinationWarehouseId = String(form.get("destinationWarehouseId") ?? "") || warehouseId;
  const expectedQuantityGrams = Math.round(Number(String(form.get("quantityGrams") ?? "").replace(",", ".")));
  const quantityGrams = Math.round(Number(String(form.get("actualQuantityGrams") ?? expectedQuantityGrams).replace(",", ".")));
  const ctx = await requireStockContext("production.add", { warehouseIds: [warehouseId, destinationWarehouseId], forWrite: true });
  try {
    const batch = await closeProductionBatch(ctx, {
      recipeId, warehouseId, destinationWarehouseId, quantityGrams, expectedQuantityGrams,
      outputGenericItemId: String(form.get("outputGenericItemId") ?? "") || null,
      scrapReason: String(form.get("scrapReason") ?? "").trim() || null,
      labourMinutes: Number(form.get("labourMinutes") ?? 0),
      labourCostCents: Math.round(Number(String(form.get("labourCost") ?? "0").replace(",", ".")) * 100),
      batchNumber: String(form.get("batchNumber") ?? "").trim() || null,
      note: String(form.get("note") ?? "").trim() || null,
    });
    revalidatePath("/production");
    redirect(`/production/${batch.id}?saved=1`);
  } catch (e) {
    if (e instanceof ProductionError) return fail(e.message);
    throw e;
  }
}

export async function correctBatch(form: FormData) {
  const batchId = String(form.get("batchId") ?? "");
  const ctx = await requireStockContext("production.add");
  try {
    await correctProductionOutput(ctx, { batchId, correctedQuantityGrams: Number(form.get("correctedQuantityGrams")), reason: String(form.get("reason") ?? "") });
    revalidatePath(`/production/${batchId}`);
    redirect(`/production/${batchId}?corrected=1`);
  } catch (error) {
    rethrowControlFlow(error); // το redirect της επιτυχίας δεν είναι σφάλμα
    revalidatePath(`/production/${batchId}`);
    redirect(`/production/${batchId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Η διόρθωση απέτυχε")}`);
  }
}
