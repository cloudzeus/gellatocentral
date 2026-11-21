"use server";
// Συνταγές παγωτού: κεφαλίδα (όνομα/τύπος/μέγεθος δόσης) και γραμμές σε γραμμάρια.
// Η τεχνική ανάλυση υπολογίζεται στην ανάγνωση (lib/recipe-analysis.ts) — δεν αποθηκεύεται.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { RECIPE_TYPES } from "@/lib/recipe-analysis";

const back = (path = "/recipes", q = ""): never => {
  revalidatePath("/recipes");
  redirect(`${path}${q}`);
};
const fail = (msg: string, path = "/recipes"): never => back(path, `${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);

/** Κεφαλίδα συνταγής (δημιουργία ή αλλαγή). */
export async function saveRecipe(form: FormData) {
  const d = z
    .object({
      recipeId: z.string().max(80),
      name: z.string().trim().min(2, "Γράψε όνομα συνταγής").max(80),
      type: z.string().max(20),
      productId: z.string().max(80),
      notes: z.string().trim().max(500),
    })
    .safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  const { org } = await currentOrg(d.data.recipeId ? "recipes.edit" : "recipes.add");
  if (!RECIPE_TYPES.some((t) => t.value === d.data.type)) return fail("Άγνωστος τύπος συνταγής");
  const batchGrams = Number(String(form.get("batchGrams") ?? "").replace(",", "."));
  if (!Number.isInteger(batchGrams) || batchGrams < 100 || batchGrams > 500_000) return fail("Το μέγεθος δόσης είναι 100–500.000 g");
  // Το προϊόν βιτρίνας (ιχνηλασιμότητα: παρτίδα → πωλήσεις) πρέπει να είναι της επιχείρησης
  if (d.data.productId && !(await db.product.findFirst({ where: { id: d.data.productId, orgId: org.id }, select: { id: true } }))) return fail("Άγνωστο προϊόν βιτρίνας");
  if (await db.recipe.findFirst({ where: { orgId: org.id, name: d.data.name, NOT: { id: d.data.recipeId || undefined } } })) return fail(`Υπάρχει ήδη συνταγή «${d.data.name}»`);
  const data = { name: d.data.name, type: d.data.type, batchGrams, productId: d.data.productId || null, notes: d.data.notes || null };
  if (d.data.recipeId) {
    await db.recipe.updateMany({ where: { id: d.data.recipeId, orgId: org.id }, data });
    back(`/recipes/${d.data.recipeId}`, "?saved=1");
  } else {
    const r = await db.recipe.create({ data: { ...data, orgId: org.id } });
    back(`/recipes/${r.id}`, "?saved=1");
  }
}

/** Συνταγή που χρησιμοποιήθηκε δεν σβήνεται: κρύβεται και ξαναεμφανίζεται. */
export async function toggleRecipe(recipeId: string) {
  const { org } = await currentOrg("recipes.edit");
  const r = await db.recipe.findFirst({ where: { id: recipeId, orgId: org.id } });
  if (r) await db.recipe.update({ where: { id: r.id }, data: { active: !r.active } });
  back("/recipes", "?saved=1");
}

/**
 * Αντικατάσταση γραμμών συνταγής. Η φόρμα στέλνει JSON: [{ genericItemId, grams }] με τη σειρά
 * που τις ταξινόμησε ο χρήστης (drag & drop) — η σειρά γράφεται στο sortOrder.
 */
export async function saveRecipeItems(form: FormData) {
  const recipeId = String(form.get("recipeId") ?? "");
  const path = `/recipes/${recipeId}`;
  const { org } = await currentOrg("recipes.edit");
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, orgId: org.id } });
  if (!recipe) return fail("Άγνωστη συνταγή", path);
  let rawLines: unknown;
  try {
    rawLines = JSON.parse(String(form.get("items") ?? "[]"));
  } catch {
    return fail("Άκυρα δεδομένα γραμμών", path);
  }
  const d = z
    .array(z.object({ genericItemId: z.string().min(1).max(80), grams: z.number().int().positive().max(500_000) }))
    .max(100)
    .safeParse(rawLines);
  if (!d.success) return fail("Κάθε γραμμή θέλει είδος και γραμμάρια (θετικός ακέραιος έως 500.000)", path);
  const ids = [...new Set(d.data.map((l) => l.genericItemId))];
  if (ids.length !== d.data.length) return fail("Το ίδιο είδος εμφανίζεται δύο φορές — άλλαξε τη ποσότητα στη μία γραμμή", path);
  const owned = await db.genericItem.count({ where: { orgId: org.id, id: { in: ids } } });
  if (owned !== ids.length) return fail("Άγνωστο είδος στη συνταγή", path);
  await db.$transaction([
    db.recipeItem.deleteMany({ where: { recipeId: recipe.id, orgId: org.id } }),
    db.recipeItem.createMany({ data: d.data.map((l, i) => ({ orgId: org.id, recipeId: recipe.id, genericItemId: l.genericItemId, grams: l.grams, sortOrder: i })) }),
  ]);
  back(path, "?saved=1");
}
