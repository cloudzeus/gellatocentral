"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorNameOf, currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirectUrl } from "@/lib/flash";
import { SalesRecipeError, saveSalesRecipe } from "@/lib/sales-recipes";

/** Γραμμές της φόρμας: ζεύγη «g» (είδος) και «q» (ποσότητα) με την ίδια σειρά. */
export async function saveRecipeLines(productId: string, optionId: string | null, form: FormData) {
  const { org, user } = await currentOrg("products.edit");
  const path = `/products/${productId}/recipe`;
  const items = form.getAll("g").map(String);
  const qtys = form.getAll("q").map(String);
  let message: string;
  try {
    await saveSalesRecipe(db, {
      orgId: org.id,
      productId: optionId ? null : productId,
      modifierOptionId: optionId,
      lines: items.map((genericItemId, i) => ({ genericItemId, qty: qtys[i] ?? "" })),
      createdByName: actorNameOf(user),
    });
    message = `?saved=${optionId ? "Αποθηκεύτηκε η συνταγή της επιλογής" : "Αποθηκεύτηκε η συνταγή πώλησης"}`;
  } catch (error) {
    if (!(error instanceof SalesRecipeError)) throw error;
    message = `?error=${error.message}`;
  }
  revalidatePath(path);
  redirect(redirectUrl(`${path}${message}`));
}
