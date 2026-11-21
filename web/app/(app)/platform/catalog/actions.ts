"use server";
// Κεντρικός κατάλογος εμπορικών ειδών (docs/analysis/PROCUREMENT-DESIGN.md §5): κατηγορίες, κατασκευαστές,
// brands και είδη. Όλα επίπεδο πλατφόρμας (orgId κενό) — τα γράφει μόνο ο διαχειριστής.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { compositionFromForm } from "@/lib/composition";
import { validGtin } from "@/lib/gs1";

const back = (q: string): never => {
  revalidatePath("/platform/catalog");
  redirect(`/platform/catalog?${q}`);
};
const fail = (msg: string): never => back(`error=${encodeURIComponent(msg)}`);
const id = z.string().max(80);
const name = z.string().trim().min(2, "Γράψε όνομα (τουλάχιστον 2 χαρακτήρες)").max(80);

export async function saveTradeCategory(form: FormData) {
  await requirePlatform("settings.edit");
  const d = z.object({ categoryId: id, name, parentId: id }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  const parentId = d.data.parentId || null;
  // δύο επίπεδα αρκούν: παιδί δεν γίνεται γονιός
  if (parentId && (await db.tradeCategory.count({ where: { parentId } }))) return fail("Η κατηγορία έχει ήδη υποκατηγορίες — δύο επίπεδα μόνο");
  if (d.data.categoryId === parentId) return fail("Η κατηγορία δεν μπορεί να είναι γονιός του εαυτού της");
  if (await db.tradeCategory.findFirst({ where: { name: d.data.name, parentId, NOT: { id: d.data.categoryId || undefined } } }))
    return fail(`Υπάρχει ήδη «${d.data.name}» σε αυτό το επίπεδο`);
  if (d.data.categoryId) await db.tradeCategory.updateMany({ where: { id: d.data.categoryId }, data: { name: d.data.name, parentId } });
  else await db.tradeCategory.create({ data: { name: d.data.name, parentId, position: await db.tradeCategory.count({ where: { parentId } }) } });
  back("saved=1");
}

export async function toggleTradeCategory(categoryId: string) {
  await requirePlatform("settings.edit");
  const c = await db.tradeCategory.findUnique({ where: { id: id.parse(categoryId) } });
  if (c) await db.tradeCategory.update({ where: { id: c.id }, data: { active: !c.active } });
  back("saved=1");
}

export async function saveManufacturer(form: FormData) {
  await requirePlatform("settings.edit");
  const d = z.object({ manufacturerId: id, name }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  if (await db.manufacturer.findFirst({ where: { name: d.data.name, NOT: { id: d.data.manufacturerId || undefined } } }))
    return fail(`Υπάρχει ήδη κατασκευαστής «${d.data.name}»`);
  if (d.data.manufacturerId) await db.manufacturer.update({ where: { id: d.data.manufacturerId }, data: { name: d.data.name } });
  else await db.manufacturer.create({ data: { name: d.data.name } });
  back("saved=1");
}

export async function saveBrand(form: FormData) {
  await requirePlatform("settings.edit");
  const d = z.object({ brandId: id, manufacturerId: z.string().min(1).max(80), name }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  if (!(await db.manufacturer.findUnique({ where: { id: d.data.manufacturerId } }))) return fail("Άγνωστος κατασκευαστής");
  if (await db.brand.findFirst({ where: { manufacturerId: d.data.manufacturerId, name: d.data.name, NOT: { id: d.data.brandId || undefined } } }))
    return fail(`Υπάρχει ήδη brand «${d.data.name}» σε αυτόν τον κατασκευαστή`);
  if (d.data.brandId) await db.brand.update({ where: { id: d.data.brandId }, data: { name: d.data.name, manufacturerId: d.data.manufacturerId } });
  else await db.brand.create({ data: { name: d.data.name, manufacturerId: d.data.manufacturerId } });
  back("saved=1");
}

export async function saveTradeItem(form: FormData) {
  await requirePlatform("settings.edit");
  const raw = Object.fromEntries(form);
  const d = z
    .object({
      itemId: id,
      name,
      ean: z.string().trim().max(14).refine((v) => v === "" || validGtin(v), "Το EAN είναι 8–14 ψηφία με σωστό ψηφίο ελέγχου"),
      categoryId: id,
      brandId: id,
      packaging: z.string().trim().max(80),
      familyCode: z.string().trim().max(40),
      contentUnitId: z.string().min(1).max(80),
    })
    .safeParse(raw);
  if (!d.success) return fail(d.error.issues[0].message);
  // η φόρμα δίνει το περιεχόμενο στη μονάδα που διάλεξε (π.χ. 1,5 λίτρο) — στη βάση γράφεται σε βασική (ml)
  const amount = Number(String(raw.contentAmount ?? "").replace(",", "."));
  const unit = await db.unit.findUnique({ where: { id: d.data.contentUnitId } });
  if (!unit || !unit.active) return fail("Άγνωστη μονάδα");
  const contentQty = Math.round(amount * unit.toBase);
  if (!Number.isInteger(contentQty) || contentQty <= 0) return fail("Το περιεχόμενο είναι θετικός αριθμός, π.χ. 1,5");
  const ean = d.data.ean || null;
  // κεντρικός κατάλογος: το EAN είναι μοναδικό (το εγγυάται και ο partial index της βάσης)
  if (ean && (await db.tradeItem.findFirst({ where: { orgId: null, ean, NOT: { id: d.data.itemId || undefined } } })))
    return fail(`Το EAN ${ean} χρησιμοποιείται ήδη στον κεντρικό κατάλογο`);
  const data = {
    name: d.data.name,
    ean,
    categoryId: d.data.categoryId || null,
    brandId: d.data.brandId || null,
    packaging: d.data.packaging || null,
    familyCode: d.data.familyCode || null,
    contentQty,
    contentUnitId: unit.id,
  };
  if (d.data.itemId) {
    await db.tradeItem.updateMany({ where: { id: d.data.itemId, orgId: null }, data });
    // η επεξεργασία γίνεται στην καρτέλα του είδους — εκεί γυρνάμε
    revalidatePath(`/platform/catalog/${d.data.itemId}`);
    revalidatePath("/platform/catalog");
    redirect(`/platform/catalog/${d.data.itemId}?saved=1`);
  }
  await db.tradeItem.create({ data: { ...data, orgId: null } });
  back("saved=1");
}

export async function toggleTradeItem(itemId: string, form: FormData) {
  await requirePlatform("settings.edit");
  const t = await db.tradeItem.findFirst({ where: { id: id.parse(itemId), orgId: null } });
  if (t) await db.tradeItem.update({ where: { id: t.id }, data: { active: !t.active } });
  // από την καρτέλα είδους γυρνάμε εκεί, αλλιώς στη λίστα
  if (form.get("returnTo") === "item" && t) {
    revalidatePath(`/platform/catalog/${t.id}`);
    redirect(`/platform/catalog/${t.id}?saved=1`);
  }
  back("saved=1");
}

/** Τεχνική σύσταση είδους του κεντρικού καταλόγου (orgId κενό) — μία ανά είδος. */
export async function saveComposition(form: FormData) {
  await requirePlatform("settings.edit");
  const tradeItemId = String(form.get("tradeItemId") ?? "");
  const item = await db.tradeItem.findFirst({ where: { id: tradeItemId, orgId: null } });
  const itemBack = (q: string): never => {
    revalidatePath(`/platform/catalog/${tradeItemId}`);
    revalidatePath("/platform/catalog");
    redirect(`/platform/catalog/${tradeItemId}?${q}`);
  };
  if (!item) return fail("Άγνωστο είδος καταλόγου");
  const r = compositionFromForm(form);
  if ("error" in r) return itemBack(`error=${encodeURIComponent(r.error)}`);
  await db.composition.upsert({ where: { tradeItemId }, create: { ...r.data, orgId: null, tradeItemId }, update: r.data });
  itemBack("saved=1");
}

const dupBack = (q: string): never => {
  revalidatePath("/platform/catalog/duplicates");
  revalidatePath("/platform/catalog");
  redirect(`/platform/catalog/duplicates?${q}`);
};
const dupFail = (msg: string): never => dupBack(`error=${encodeURIComponent(msg)}`);

/**
 * Συγχώνευση διπλότυπων κατασκευαστών (π.χ. «Μεβγαλ»/«ΜΕΒΓΑΛ» από την εισαγωγή OFF):
 * τα brands και τα είδη τους περνούν στον κρατούμενο και οι υπόλοιποι σβήνονται.
 * Όταν ο κρατούμενος έχει ήδη brand με το ίδιο όνομα, τα είδη μετακινούνται σε αυτό
 * και το διπλό brand σβήνεται — η μοναδικότητα [manufacturerId, name] δεν κινδυνεύει.
 */
export async function mergeManufacturers(form: FormData) {
  await requirePlatform("settings.edit");
  const keepId = String(form.get("keepId") ?? "");
  const members = [...new Set(form.getAll("memberId").map(String))];
  const dropIds = members.filter((x) => x && x !== keepId);
  if (!keepId || !dropIds.length) return dupFail("Διάλεξε ποιος κατασκευαστής κρατιέται");
  const keep = await db.manufacturer.findUnique({ where: { id: keepId } });
  if (!keep) return dupFail("Άγνωστος κατασκευαστής");
  const drops = await db.manufacturer.findMany({ where: { id: { in: dropIds } }, include: { brands: true } });
  if (drops.length !== dropIds.length) return dupFail("Κάποιος κατασκευαστής ενώπιον συγχωνεύτηκε — ανανέωσε τη σελίδα");
  await db.$transaction(async (tx) => {
    for (const drop of drops) {
      for (const brand of drop.brands) {
        const twin = await tx.brand.findFirst({ where: { manufacturerId: keep.id, name: { equals: brand.name, mode: "insensitive" } } });
        if (twin) {
          await tx.tradeItem.updateMany({ where: { brandId: brand.id }, data: { brandId: twin.id } });
          await tx.brand.delete({ where: { id: brand.id } });
        } else {
          await tx.brand.update({ where: { id: brand.id }, data: { manufacturerId: keep.id } });
        }
      }
      await tx.manufacturer.delete({ where: { id: drop.id } });
    }
  });
  dupBack(`saved=${drops.length}`);
}
