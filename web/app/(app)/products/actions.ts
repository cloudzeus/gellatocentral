"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";

// Μετά από αλλαγή στον κατάλογο: και η οθόνη προϊόντων και το web ταμείο ξαναδιαβάζουν.
const back = (q = ""): never => {
  revalidatePath("/products");
  revalidatePath("/pos");
  redirect(`/products${q}`);
};
const fail = (msg: string): never => back(`?error=${encodeURIComponent(msg)}`);

export async function saveCategory(form: FormData) {
  const d = z.object({ categoryId: z.string().max(80), name: z.string().trim().min(2, "Γράψε όνομα κατηγορίας").max(40) }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  const { org } = await currentOrg(d.data.categoryId ? "products.edit" : "products.add");
  const name = d.data.name;
  if (await db.category.findFirst({ where: { orgId: org.id, name, NOT: { id: d.data.categoryId || undefined } } })) return fail(`Υπάρχει ήδη κατηγορία «${name}»`);
  if (d.data.categoryId) await db.category.updateMany({ where: { id: d.data.categoryId, orgId: org.id }, data: { name } });
  else await db.category.create({ data: { orgId: org.id, name, position: await db.category.count({ where: { orgId: org.id } }) } });
  back("?saved=1");
}

export async function saveProduct(form: FormData) {
  const raw = Object.fromEntries(form);
  const d = z.object({ productId: z.string().max(80), categoryId: z.string().cuid(), vatRateId: z.string().min(1).max(80), name: z.string().trim().min(2, "Γράψε όνομα προϊόντος").max(60) }).safeParse(raw);
  if (!d.success) return fail(d.error.issues[0].message);
  const { org } = await currentOrg(d.data.productId ? "products.edit" : "products.add");
  // η τιμή γράφεται σε ευρώ (με κόμμα ή τελεία), κρατιέται σε λεπτά
  const priceCents = Math.round(Number(String(raw.price ?? "").replace(",", ".")) * 100);
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 1_000_000) return fail("Η τιμή είναι ποσό σε ευρώ, π.χ. 4,50");
  // κατηγορία και συντελεστής πρέπει να υπάρχουν· σε επεξεργασία επιτρέπεται ο τρέχων ακόμα κι αν κρύφτηκε
  if (!(await db.category.findFirst({ where: { id: d.data.categoryId, orgId: org.id } }))) return fail("Άγνωστη κατηγορία");
  const rate = (await db.vatRate.findFirst({ where: { id: d.data.vatRateId, active: true } })) ?? (d.data.productId ? await db.vatRate.findFirst({ where: { id: d.data.vatRateId } }) : null);
  if (!rate) return fail("Άγνωστος συντελεστής ΦΠΑ");
  const name = d.data.name;
  if (await db.product.findFirst({ where: { orgId: org.id, categoryId: d.data.categoryId, name, NOT: { id: d.data.productId || undefined } } })) return fail(`Υπάρχει ήδη «${name}» σε αυτή την κατηγορία`);
  const data = { categoryId: d.data.categoryId, vatRateId: rate.id, name, priceCents };
  if (d.data.productId) await db.product.updateMany({ where: { id: d.data.productId, orgId: org.id }, data });
  else await db.product.create({ data: { ...data, orgId: org.id } });
  back("?saved=1");
}

/** Προϊόν που πουλήθηκε δεν σβήνεται: κρύβεται από το ταμείο και ξαναεμφανίζεται με ένα κλικ. */
export async function toggleProduct(productId: string) {
  const { org } = await currentOrg("products.edit");
  const p = await db.product.findFirst({ where: { id: productId, orgId: org.id } });
  if (p) await db.product.update({ where: { id: p.id }, data: { active: !p.active } });
  back("?saved=1");
}
