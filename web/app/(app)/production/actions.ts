"use server";
// Παρτίδες παραγωγής: δημιουργία = ατομικό κλείσιμο (FEFO κατανάλωση υλικών σε μία συναλλαγή).
// Η παρτίδα παραγωγής δεν αλλάζει μετά — είναι ιστορικό γεγονός ιχνηλασιμότητας.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentOrg } from "@/lib/auth";
import { ProductionError, closeProductionBatch } from "@/lib/production-db";

const fail = (msg: string): never => {
  revalidatePath("/production");
  redirect(`/production?error=${encodeURIComponent(msg)}`);
};

/** Νέα παρτίδα παραγωγής: συνταγή, αποθήκη, ποσότητα. Το υπόλοιπο ελέγχεται FEFO στη συναλλαγή. */
export async function createBatch(form: FormData) {
  const recipeId = String(form.get("recipeId") ?? "");
  const warehouseId = String(form.get("warehouseId") ?? "");
  const quantityGrams = Math.round(Number(String(form.get("quantityGrams") ?? "").replace(",", ".")));
  const { org, user } = await currentOrg("production.add");
  try {
    const batch = await closeProductionBatch(org.id, {
      recipeId,
      warehouseId,
      quantityGrams,
      batchNumber: String(form.get("batchNumber") ?? "").trim() || null,
      note: String(form.get("note") ?? "").trim() || null,
      createdByName: user.name,
    });
    revalidatePath("/production");
    redirect(`/production/${batch.id}?saved=1`);
  } catch (e) {
    if (e instanceof ProductionError) return fail(e.message);
    throw e;
  }
}
