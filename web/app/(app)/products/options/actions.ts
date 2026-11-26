"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { productsTag } from "@/lib/product-catalog";

// Οι επιλογές φτάνουν στο ταμείο μαζί με τον κατάλογο, οπότε ακυρώνεται και η cache του.
const back = (orgId: string | null, q: string): never => {
  if (orgId) updateTag(productsTag(orgId));
  revalidatePath("/products/options");
  revalidatePath("/products");
  revalidatePath("/pos");
  redirect(`/products/options${q}`);
};
const fail = (msg: string): never => back(null, `?error=${encodeURIComponent(msg)}`);

export async function saveGroup(form: FormData) {
  const d = z.object({
    groupId: z.string().max(80),
    name: z.string().trim().min(2, "Γράψε όνομα ομάδας").max(40),
    kind: z.enum(["REQUIRED", "EXTRA", "REMOVE"], "Διάλεξε είδος ομάδας"),
  }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  const { org } = await currentOrg(d.data.groupId ? "products.edit" : "products.add");
  const { name, kind } = d.data;
  if (await db.modifierGroup.findFirst({ where: { orgId: org.id, name, NOT: { id: d.data.groupId || undefined } } })) return fail(`Υπάρχει ήδη ομάδα «${name}»`);
  if (d.data.groupId) {
    const r = await db.modifierGroup.updateMany({ where: { id: d.data.groupId, orgId: org.id }, data: { name, kind } });
    if (!r.count) return fail("Η ομάδα δεν βρέθηκε· ανανέωσε τη σελίδα");
    // στην αφαίρεση δεν υπάρχει χρέωση
    if (kind === "REMOVE") await db.modifierOption.updateMany({ where: { groupId: d.data.groupId, group: { orgId: org.id } }, data: { priceCents: 0 } });
  } else await db.modifierGroup.create({ data: { orgId: org.id, name, kind, position: await db.modifierGroup.count({ where: { orgId: org.id } }) } });
  back(org.id, `?saved=${encodeURIComponent("Η ομάδα αποθηκεύτηκε")}`);
}

/** Οι πωλήσεις κρατούν αντίγραφο των επιλογών τους (SaleLine.options), οπότε η διαγραφή δεν αγγίζει το ιστορικό. */
export async function deleteGroup(groupId: string) {
  const { org } = await currentOrg("products.edit");
  await db.modifierGroup.deleteMany({ where: { id: groupId, orgId: org.id } });
  back(org.id, `?saved=${encodeURIComponent("Η ομάδα διαγράφηκε")}`);
}

export async function saveOption(form: FormData) {
  const raw = Object.fromEntries(form);
  const d = z.object({ groupId: z.string().cuid(), optionId: z.string().max(80), name: z.string().trim().min(1, "Γράψε όνομα επιλογής").max(40) }).safeParse(raw);
  if (!d.success) return fail(d.error.issues[0].message);
  const { org } = await currentOrg(d.data.optionId ? "products.edit" : "products.add");
  const group = await db.modifierGroup.findFirst({ where: { id: d.data.groupId, orgId: org.id }, select: { id: true, kind: true } });
  if (!group) return fail("Η ομάδα δεν βρέθηκε· ανανέωσε τη σελίδα");
  // επιπλέον χρέωση σε ευρώ (κόμμα ή τελεία), κρατιέται σε λεπτά· κενό = χωρίς χρέωση
  const priceCents = group.kind === "REMOVE" ? 0 : Math.round(Number(String(raw.price ?? "").trim().replace(",", ".") || 0) * 100);
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100_000) return fail("Η χρέωση είναι ποσό σε ευρώ, π.χ. 0,50");
  const { name } = d.data;
  if (d.data.optionId) {
    const r = await db.modifierOption.updateMany({ where: { id: d.data.optionId, groupId: group.id, group: { orgId: org.id } }, data: { name, priceCents } });
    if (!r.count) return fail("Η επιλογή δεν βρέθηκε· ανανέωσε τη σελίδα");
  } else await db.modifierOption.create({ data: { groupId: group.id, name, priceCents, position: await db.modifierOption.count({ where: { groupId: group.id } }) } });
  back(org.id, `?saved=${encodeURIComponent("Η επιλογή αποθηκεύτηκε")}`);
}

/** Ανενεργή επιλογή δεν φαίνεται στο ταμείο (π.χ. τελείωσε η γεύση) αλλά μένει για αύριο. */
export async function toggleOption(optionId: string) {
  const { org } = await currentOrg("products.edit");
  const o = await db.modifierOption.findFirst({ where: { id: optionId, group: { orgId: org.id } }, select: { id: true, active: true } });
  if (o) await db.modifierOption.update({ where: { id: o.id }, data: { active: !o.active } });
  back(org.id, `?saved=${encodeURIComponent(o?.active ? "Η επιλογή κρύφτηκε από το ταμείο" : "Η επιλογή εμφανίζεται στο ταμείο")}`);
}

export async function deleteOption(optionId: string) {
  const { org } = await currentOrg("products.edit");
  await db.modifierOption.deleteMany({ where: { id: optionId, group: { orgId: org.id } } });
  back(org.id, `?saved=${encodeURIComponent("Η επιλογή διαγράφηκε")}`);
}
