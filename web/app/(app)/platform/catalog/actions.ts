"use server";
// Κεντρικός κατάλογος εμπορικών ειδών (docs/analysis/PROCUREMENT-DESIGN.md §5): κατηγορίες, κατασκευαστές,
// brands και είδη. Όλα επίπεδο πλατφόρμας (orgId κενό) — τα γράφει μόνο ο διαχειριστής.

import { flashOk } from "@/lib/flash-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { matchCatalogCategories } from "@/lib/catalog-category-matcher";
import { CatalogEnrichmentError, enrichCatalogManufacturer } from "@/lib/catalog-enrichment-server";
import { safeHttpsUrl } from "@/lib/catalog-enrichment";
import { compositionFromForm } from "@/lib/composition";
import { validGtin } from "@/lib/gs1";
import { normalizeManufacturerName } from "@/lib/manufacturer";
import { submittedOption } from "@/lib/select-options";
import { deleteFile } from "@/lib/storage";
import { descendantCategoryIds, tradeCategoryLayoutError, type TradeCategoryLayout } from "@/lib/trade-category-tree";
import { runTask } from "@/lib/tasks";

const back = (q: string): never => {
  revalidatePath("/platform/catalog");
  redirect(`/platform/catalog?${q}`);
};
const fail = (msg: string): never => back(`error=${encodeURIComponent(msg)}`);
const id = z.string().max(80);
const name = z.string().trim().min(2, "Γράψε όνομα (τουλάχιστον 2 χαρακτήρες)").max(80);

export async function saveTradeCategory(form: FormData) {
  await requirePlatform("settings.edit");
  const d = z.object({ categoryId: id, name, parentId: id.transform(submittedOption) }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  const parentId = d.data.parentId || null;
  const categories = await db.tradeCategory.findMany();
  const current = categories.find((c) => c.id === d.data.categoryId);
  if (d.data.categoryId && !current) return fail("Άγνωστη κατηγορία");
  if (parentId && !categories.some((c) => c.id === parentId)) return fail("Άγνωστη μητρική κατηγορία");
  // Ο γονιός μπορεί να βρίσκεται σε οποιοδήποτε βάθος, αλλά ποτέ μέσα στο υποδέντρο που μετακινείται.
  if (current && parentId && (parentId === current.id || descendantCategoryIds(categories, current.id).has(parentId)))
    return fail("Η κατηγορία δεν μπορεί να μετακινηθεί μέσα στον εαυτό της ή σε απόγονό της");
  if (await db.tradeCategory.findFirst({ where: { name: d.data.name, parentId, NOT: { id: d.data.categoryId || undefined } } }))
    return fail(`Υπάρχει ήδη «${d.data.name}» σε αυτό το επίπεδο`);
  const position = current?.parentId === parentId ? current.position : await db.tradeCategory.count({ where: { parentId } });
  if (current) await db.tradeCategory.update({ where: { id: current.id }, data: { name: d.data.name, parentId, position } });
  else await db.tradeCategory.create({ data: { name: d.data.name, parentId, position } });
  back("saved=1&tab=categories");
}

const layoutSchema = z.array(z.object({ id: z.string().min(1).max(80), parentId: z.string().max(80).nullable(), position: z.number().int().min(0).max(1000) })).max(500);

/** Ατομική αποθήκευση μετά το drop: το client στέλνει όλο το layout για να αποκλείονται κύκλοι και μερικές ενημερώσεις. */
export async function saveTradeCategoryLayout(input: TradeCategoryLayout[]) {
  await requirePlatform("settings.edit");
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Η νέα δομή δεν είναι έγκυρη" };
  const categories = await db.tradeCategory.findMany();
  const error = tradeCategoryLayoutError(parsed.data, categories);
  if (error) return { ok: false as const, error };
  await db.$transaction(parsed.data.map((row) => db.tradeCategory.update({ where: { id: row.id }, data: { parentId: row.parentId, position: row.position } })));
  revalidatePath("/platform/catalog");
  return { ok: true as const };
}

export async function toggleTradeCategory(categoryId: string) {
  await requirePlatform("settings.edit");
  const c = await db.tradeCategory.findUnique({ where: { id: id.parse(categoryId) } });
  if (c) await db.tradeCategory.update({ where: { id: c.id }, data: { active: !c.active } });
  back("saved=1&tab=categories");
}

export async function saveManufacturer(form: FormData) {
  await requirePlatform("settings.edit");
  const d = z.object({ manufacturerId: id, name, website: z.string().trim().max(1000).optional(), logoUrl: z.string().trim().max(1200).optional() }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  const normalizedName = normalizeManufacturerName(d.data.name);
  const website = d.data.website ? safeHttpsUrl(d.data.website)?.toString() : null;
  if (d.data.website && !website) return fail("Το website πρέπει να είναι δημόσιο HTTPS χωρίς στοιχεία σύνδεσης");
  const logoUrl = d.data.logoUrl || null;
  if (logoUrl && !safeHttpsUrl(logoUrl) && !/^\/api\/files\/[\w-]+$/.test(logoUrl)) return fail("Το λογότυπο πρέπει να είναι HTTPS URL ή αποθηκευμένο αρχείο της πλατφόρμας");
  if (await db.manufacturer.findFirst({ where: { name: normalizedName, NOT: { id: d.data.manufacturerId || undefined } } }))
    return fail(`Υπάρχει ήδη κατασκευαστής «${normalizedName}»`);
  if (d.data.manufacturerId) await db.manufacturer.update({ where: { id: d.data.manufacturerId }, data: { name: normalizedName, website, logoUrl } });
  else await db.manufacturer.create({ data: { name: normalizedName, website, logoUrl } });
  back("saved=1&tab=manufacturers");
}

export async function enrichManufacturer(manufacturerId: string) {
  const user = await requirePlatform("settings.edit");
  const parsed = id.safeParse(manufacturerId);
  if (!parsed.success) return fail("Άγνωστος κατασκευαστής");
  try {
    const label = (await db.manufacturer.findUnique({ where: { id: parsed.data }, select: { name: true } }))?.name ?? "Κατασκευαστής";
    await runTask({ orgId: null, userId: user.id, userName: user.name }, { kind: "catalog.enrich", title: `Εμπλουτισμός κατασκευαστή · ${label}`, permission: "settings.edit", total: 1 }, async (task) => {
      await task.step(label);
      try { await enrichCatalogManufacturer(parsed.data, user.id); await task.ok(); }
      catch (error) { await task.fail({ id: parsed.data, label, reason: error instanceof CatalogEnrichmentError ? error.message : "Ο εμπλουτισμός απέτυχε" }); throw error; }
    });
  } catch (error) {
    return fail(error instanceof CatalogEnrichmentError ? error.message : "Ο εμπλουτισμός απέτυχε");
  }
  back("saved=1&tab=manufacturers");
}

/** Έως τρεις διαδοχικές κλήσεις: ορατό κόστος, χωρίς αιφνίδιο burst στο OpenRouter. */
export async function enrichManufacturers(ids: string[]) {
  const user = await requirePlatform("settings.edit");
  const unique = bulkIds(ids);
  if (!unique || unique.length > 3) return "Διάλεξε έως 3 κατασκευαστές κάθε φορά";
  const errors: string[] = [];
  let completed = 0;
  const names = new Map((await db.manufacturer.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
  // ο βρόχος μένει ίδιος· προστέθηκε μόνο η αναφορά προόδου («2 από 3», «Τώρα: …») για το παράθυρο «Εργασίες»
  await runTask({ orgId: null, userId: user.id, userName: user.name }, { kind: "catalog.enrich", title: "Εμπλουτισμός κατασκευαστών", permission: "settings.edit", total: unique.length }, async (task) => {
    for (const manufacturerId of unique) {
      const label = names.get(manufacturerId) ?? "Κατασκευαστής";
      await task.step(label);
      try {
        await enrichCatalogManufacturer(manufacturerId, user.id);
        completed++;
        await task.ok();
      } catch (error) {
        const reason = error instanceof CatalogEnrichmentError ? error.message : "Ο εμπλουτισμός απέτυχε";
        errors.push(reason);
        await task.fail({ id: manufacturerId, label, reason });
      }
    }
    task.result("/platform/catalog?tab=manufacturers");
  });
  revalidatePath("/platform/catalog");
  revalidatePath("/platform/catalog/duplicates");
  if (!completed) return [...new Set(errors)].join(" · ").slice(0, 400) || "Ο εμπλουτισμός απέτυχε";
  await flashOk(completed < unique.length ? `Εμπλουτίστηκαν ${completed} από τους ${unique.length} κατασκευαστές` : completed === 1 ? "Ο κατασκευαστής εμπλουτίστηκε" : `${completed} κατασκευαστές εμπλουτίστηκαν`);
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
  back("saved=1&tab=manufacturers");
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
      brandId: id.transform(submittedOption),
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
    revalidatePath(`/platform/catalog/${d.data.itemId}`);
    revalidatePath("/platform/catalog");
    // Από το modal της λίστας μένουμε στη λίστα· από την καρτέλα επιστρέφουμε σε αυτήν.
    if (raw.returnTo === "catalog") back("saved=1");
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

const bulkIds = (ids: string[]) => {
  const parsed = z.array(z.string().min(1).max(80)).min(1).max(200).safeParse(ids);
  return parsed.success ? [...new Set(parsed.data)] : null;
};

async function setTradeItemsActive(ids: string[], active: boolean) {
  await requirePlatform("settings.edit");
  const unique = bulkIds(ids);
  if (!unique) return "Η επιλογή ειδών δεν είναι έγκυρη";
  const result = await db.tradeItem.updateMany({ where: { id: { in: unique }, orgId: null }, data: { active } });
  revalidatePath("/platform/catalog");
  if (result.count !== unique.length) return "Ορισμένα είδη δεν βρέθηκαν στον κεντρικό κατάλογο· ανανέωσε τη λίστα";
  const n = unique.length;
  await flashOk(active ? (n === 1 ? "Το είδος καταλόγου ενεργοποιήθηκε" : `${n} είδη καταλόγου ενεργοποιήθηκαν`) : n === 1 ? "Το είδος καταλόγου έγινε κρυφό" : `${n} είδη καταλόγου έγιναν κρυφά`);
}

export async function activateTradeItems(ids: string[]) {
  return setTradeItemsActive(ids, true);
}

export async function hideTradeItems(ids: string[]) {
  return setTradeItemsActive(ids, false);
}

type TradeItemClassificationInput = { itemId: string; categoryId: string; manufacturerId: string; brandId: string };

/** Κοινός server έλεγχος· στις προτάσεις προστίθεται optimistic συνθήκη ότι το είδος παραμένει ακατηγοριοποίητο. */
async function updateTradeItemClassification(input: TradeItemClassificationInput, onlyUncategorized: boolean) {
  await requirePlatform("settings.edit");
  const parsed = z.object({
    itemId: z.string().min(1).max(80),
    categoryId: z.string().min(1).max(80),
    manufacturerId: id.transform(submittedOption),
    brandId: id.transform(submittedOption),
  }).safeParse(input);
  if (!parsed.success) return "Η διόρθωση περιέχει μη έγκυρες επιλογές";
  const { itemId, categoryId, manufacturerId, brandId } = parsed.data;
  if (!!manufacturerId !== !!brandId) return "Διάλεξε και κατασκευαστή και brand, ή άφησε και τα δύο κενά";
  const [category, manufacturer, brand] = await Promise.all([
    db.tradeCategory.findFirst({ where: { id: categoryId, ...(onlyUncategorized ? { active: true } : {}) }, select: { id: true } }),
    manufacturerId ? db.manufacturer.findUnique({ where: { id: manufacturerId }, select: { id: true } }) : null,
    brandId ? db.brand.findFirst({ where: { id: brandId, manufacturerId }, select: { id: true } }) : null,
  ]);
  if (!category) return onlyUncategorized ? "Η κατηγορία δεν υπάρχει ή είναι ανενεργή" : "Η κατηγορία δεν βρέθηκε";
  if (manufacturerId && !manufacturer) return "Ο κατασκευαστής δεν βρέθηκε";
  if (brandId && !brand) return "Το brand δεν ανήκει στον επιλεγμένο κατασκευαστή";
  const result = await db.tradeItem.updateMany({
    where: { id: itemId, orgId: null, ...(onlyUncategorized ? { categoryId: null } : {}) },
    data: { categoryId, brandId: brandId || null },
  });
  if (result.count !== 1) return onlyUncategorized ? "Το είδος ενημερώθηκε ήδη από άλλη ενέργεια· ανανέωσε τη λίστα" : "Το είδος δεν βρέθηκε στον κεντρικό κατάλογο";
  revalidatePath("/platform/catalog");
  revalidatePath("/platform/catalog/category-matches");
  revalidatePath(`/platform/catalog/${itemId}`);
}

export async function updateCategoryMatchItem(input: TradeItemClassificationInput) {
  return updateTradeItemClassification(input, true);
}

export async function updateCatalogItemClassification(input: TradeItemClassificationInput) {
  return updateTradeItemClassification(input, false);
}

/** Ο browser στέλνει μόνο ids· η κατηγορία επανυπολογίζεται από τα τρέχοντα δεδομένα του server. */
export async function applyCategoryMatches(ids: string[]) {
  await requirePlatform("settings.edit");
  const unique = bulkIds(ids);
  if (!unique) return "Διάλεξε από 1 έως 200 είδη για συσχέτιση";
  const [categories, items] = await Promise.all([
    db.tradeCategory.findMany({ where: { active: true }, select: { id: true, parentId: true, name: true, active: true } }),
    db.tradeItem.findMany({ where: { id: { in: unique }, orgId: null, categoryId: null }, select: { id: true, name: true, brand: { select: { name: true } } } }),
  ]);
  const matches = matchCatalogCategories(items.map((item) => ({ id: item.id, name: item.name, brandName: item.brand?.name })), categories);
  if (!matches.length) return "Οι προτάσεις δεν ισχύουν πλέον· ανανέωσε τη λίστα";
  const writes = await db.$transaction(matches.map((match) => db.tradeItem.updateMany({
    where: { id: match.itemId, orgId: null, categoryId: null },
    data: { categoryId: match.categoryId },
  })));
  revalidatePath("/platform/catalog");
  revalidatePath("/platform/catalog/category-matches");
  const updated = writes.reduce((sum, result) => sum + result.count, 0);
  if (updated !== unique.length) return `Εφαρμόστηκαν ${updated} συσχετίσεις· ${unique.length - updated} είδη είχαν ήδη ενημερωθεί ή δεν έχουν πλέον σαφή πρόταση`;
  await flashOk(updated === 1 ? "Το είδος μπήκε στην κατηγορία του" : `${updated} είδη μπήκαν στις κατηγορίες τους`);
}

async function setTradeCategoriesActive(ids: string[], active: boolean) {
  await requirePlatform("settings.edit");
  const unique = bulkIds(ids);
  if (!unique) return "Η επιλογή κατηγοριών δεν είναι έγκυρη";
  const result = await db.tradeCategory.updateMany({ where: { id: { in: unique } }, data: { active } });
  revalidatePath("/platform/catalog");
  if (result.count !== unique.length) return "Ορισμένες κατηγορίες δεν βρέθηκαν· ανανέωσε τη λίστα";
  const n = unique.length;
  await flashOk(active ? (n === 1 ? "Η κατηγορία ενεργοποιήθηκε" : `${n} κατηγορίες ενεργοποιήθηκαν`) : n === 1 ? "Η κατηγορία έγινε κρυφή" : `${n} κατηγορίες έγιναν κρυφές`);
}

export async function activateTradeCategories(ids: string[]) {
  return setTradeCategoriesActive(ids, true);
}

export async function hideTradeCategories(ids: string[]) {
  return setTradeCategoriesActive(ids, false);
}

/** Οριστική διαγραφή μόνο όταν το είδος δεν έχει συνδεθεί με συνδρομητή ή αγορά. */
export async function deleteTradeItem(itemId: string) {
  await requirePlatform("settings.edit");
  const parsed = id.safeParse(itemId);
  if (!parsed.success) return fail("Άγνωστο είδος καταλόγου");
  const item = await db.tradeItem.findFirst({ where: { id: parsed.data, orgId: null }, include: { _count: { select: { mappings: true, supplierItems: true, purchaseLines: true } } } });
  if (!item) return fail("Άγνωστο είδος καταλόγου");
  if (item._count.mappings || item._count.supplierItems || item._count.purchaseLines)
    return fail("Το είδος χρησιμοποιείται σε συνδέσεις, προμηθευτές ή αγορές· κρύψε το αντί να το διαγράψεις");
  const files = await db.storedFile.findMany({ where: { orgId: null, refType: "tradeItem", refId: item.id }, select: { id: true, path: true } });
  try {
    for (const file of files) await deleteFile(file);
  } catch {
    return fail("Δεν ολοκληρώθηκε η διαγραφή της φωτογραφίας· δοκίμασε ξανά");
  }
  await db.tradeItem.deleteMany({ where: { id: item.id, orgId: null } });
  back("saved=1");
}

export async function deleteTradeCategory(categoryId: string) {
  await requirePlatform("settings.edit");
  const category = await db.tradeCategory.findUnique({ where: { id: id.parse(categoryId) }, include: { _count: { select: { children: true, items: true } } } });
  if (!category) return fail("Άγνωστη κατηγορία");
  if (category._count.children || category._count.items) return fail("Η κατηγορία έχει υποκατηγορίες ή είδη· μετακίνησέ τα πρώτα ή κρύψε την");
  await db.tradeCategory.delete({ where: { id: category.id } });
  back("saved=1&tab=categories");
}

async function deleteManufacturerLogos(ids: string[]) {
  const files = await db.storedFile.findMany({ where: { orgId: null, category: "manufacturer_logo", refType: "manufacturer", refId: { in: ids } }, select: { id: true, path: true } });
  for (const file of files) await deleteFile(file);
}

export async function deleteManufacturer(manufacturerId: string) {
  await requirePlatform("settings.edit");
  const manufacturer = await db.manufacturer.findUnique({ where: { id: id.parse(manufacturerId) }, include: { _count: { select: { brands: true } } } });
  if (!manufacturer) return fail("Άγνωστος κατασκευαστής");
  if (manufacturer._count.brands) return fail("Ο κατασκευαστής έχει brands· μετακίνησέ τα ή διάγραψέ τα πρώτα");
  try { await deleteManufacturerLogos([manufacturer.id]); } catch { return fail("Δεν ολοκληρώθηκε η διαγραφή του λογότυπου· δοκίμασε ξανά"); }
  await db.manufacturer.delete({ where: { id: manufacturer.id } });
  back("saved=1&tab=manufacturers");
}

export async function deleteBrand(brandId: string) {
  await requirePlatform("settings.edit");
  const brand = await db.brand.findUnique({ where: { id: id.parse(brandId) }, include: { _count: { select: { items: true } } } });
  if (!brand) return fail("Άγνωστο brand");
  if (brand._count.items) return fail("Το brand συνδέεται με είδη· μετακίνησέ τα πρώτα");
  await db.brand.delete({ where: { id: brand.id } });
  back("saved=1&tab=manufacturers");
}

export async function deleteManufacturers(ids: string[]) {
  await requirePlatform("settings.edit");
  const unique = bulkIds(ids);
  if (!unique) return "Η επιλογή κατασκευαστών δεν είναι έγκυρη";
  const rows = await db.manufacturer.findMany({ where: { id: { in: unique } }, include: { _count: { select: { brands: true } } } });
  if (rows.length !== unique.length) return "Ορισμένοι κατασκευαστές δεν βρέθηκαν· ανανέωσε τη λίστα";
  if (rows.some((m) => m._count.brands)) return "Κάποιοι κατασκευαστές έχουν brands· δεν διαγράφηκε κανένας";
  try { await deleteManufacturerLogos(unique); } catch { return "Δεν ολοκληρώθηκε η διαγραφή των λογότυπων· δεν διαγράφηκε κανένας"; }
  await db.manufacturer.deleteMany({ where: { id: { in: unique } } });
  revalidatePath("/platform/catalog");
  await flashOk(unique.length === 1 ? "Ο κατασκευαστής διαγράφηκε" : `${unique.length} κατασκευαστές διαγράφηκαν`);
}

export async function deleteBrands(ids: string[]) {
  await requirePlatform("settings.edit");
  const unique = bulkIds(ids);
  if (!unique) return "Η επιλογή brands δεν είναι έγκυρη";
  const rows = await db.brand.findMany({ where: { id: { in: unique } }, include: { _count: { select: { items: true } } } });
  if (rows.length !== unique.length) return "Ορισμένα brands δεν βρέθηκαν· ανανέωσε τη λίστα";
  if (rows.some((b) => b._count.items)) return "Κάποια brands συνδέονται με είδη· δεν διαγράφηκε κανένα";
  await db.brand.deleteMany({ where: { id: { in: unique } } });
  revalidatePath("/platform/catalog");
  await flashOk(unique.length === 1 ? "Το brand διαγράφηκε" : `${unique.length} brands διαγράφηκαν`);
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
 * Συγχώνευση μετά από ανθρώπινη επιβεβαίωση. Μαζί με brands/είδη ενοποιούνται ταυτοτικά στοιχεία
 * και αποδείξεις υλικών· οι AI προτάσεις του διαγραμμένου κατασκευαστή καθαρίζονται από τις FK.
 */
export async function mergeManufacturers(form: FormData) {
  await requirePlatform("settings.edit");
  const keepId = String(form.get("keepId") ?? "");
  const members = [...new Set(form.getAll("memberId").map(String))];
  const dropIds = members.filter((x) => x && x !== keepId);
  if (!keepId || !dropIds.length) return dupFail("Διάλεξε ποιος κατασκευαστής κρατιέται");
  const keep = await db.manufacturer.findUnique({ where: { id: keepId } });
  if (!keep) return dupFail("Άγνωστος κατασκευαστής");
  const drops = await db.manufacturer.findMany({ where: { id: { in: dropIds } }, include: { brands: true, ingredients: true } });
  if (drops.length !== dropIds.length) return dupFail("Κάποιος κατασκευαστής ενώπιον συγχωνεύτηκε — ανανέωσε τη σελίδα");
  const logoOwner = keep.logoUrl ? keep.id : drops.find((drop) => drop.logoUrl)?.id;
  const mergedLogo = keep.logoUrl ?? drops.find((drop) => drop.id === logoOwner)?.logoUrl ?? null;
  const unusedFiles = await db.storedFile.findMany({ where: { orgId: null, category: "manufacturer_logo", refType: "manufacturer", refId: { in: dropIds }, ...(logoOwner && logoOwner !== keep.id ? { refId: { in: dropIds, not: logoOwner } } : {}) }, select: { id: true, path: true } });

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
      for (const ingredient of drop.ingredients) {
        const twin = await tx.manufacturerIngredient.findUnique({ where: { manufacturerId_ingredientId: { manufacturerId: keep.id, ingredientId: ingredient.ingredientId } } });
        if (twin) {
          await tx.manufacturerIngredient.update({
            where: { manufacturerId_ingredientId: { manufacturerId: keep.id, ingredientId: ingredient.ingredientId } },
            data: {
              isCore: twin.isCore || ingredient.isCore,
              pastryRelevant: twin.pastryRelevant || ingredient.pastryRelevant,
              evidence: twin.evidence ?? ingredient.evidence,
              productIds: [...new Set([...twin.productIds, ...ingredient.productIds])],
              source: twin.source === "manual" || ingredient.source === "manual" ? "manual" : "ai",
            },
          });
          await tx.manufacturerIngredient.delete({ where: { manufacturerId_ingredientId: { manufacturerId: drop.id, ingredientId: ingredient.ingredientId } } });
        } else {
          await tx.manufacturerIngredient.update({ where: { manufacturerId_ingredientId: { manufacturerId: drop.id, ingredientId: ingredient.ingredientId } }, data: { manufacturerId: keep.id } });
        }
      }
      if (drop.id === logoOwner) await tx.storedFile.updateMany({ where: { orgId: null, category: "manufacturer_logo", refType: "manufacturer", refId: drop.id }, data: { refId: keep.id } });
      await tx.catalogEnrichmentRun.updateMany({ where: { manufacturerId: drop.id }, data: { manufacturerId: keep.id } });
      await tx.manufacturer.delete({ where: { id: drop.id } });
    }
    const aliases = [...new Set([...keep.aliases, ...drops.flatMap((drop) => [normalizeManufacturerName(drop.name), ...drop.aliases])])].filter((alias) => alias !== normalizeManufacturerName(keep.name)).slice(0, 32);
    await tx.manufacturer.update({
      where: { id: keep.id },
      data: { name: normalizeManufacturerName(keep.name), aliases, website: keep.website ?? drops.find((drop) => drop.website)?.website ?? null, logoUrl: mergedLogo, enrichmentStatus: "review", enrichmentError: null },
    });
    await tx.rawIngredient.deleteMany({ where: { manufacturers: { none: {} } } });
  });
  for (const file of unusedFiles) await deleteFile(file).catch((error) => console.error("merge logo cleanup", file.path, error));
  dupBack(`saved=${drops.length}`);
}
