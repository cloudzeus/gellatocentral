"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { compositionCopyData, compositionFromForm } from "@/lib/composition";
import { db } from "@/lib/db";
import { addStockMovement } from "@/lib/warehouses";
import { parseGs1 } from "@/lib/gs1";

// Μετά από αλλαγή: και η λίστα και η καρτέλα είδους ξαναδιαβάζουν.
const back = (path = "/items", q = ""): never => {
  revalidatePath("/items");
  redirect(`${path}${q}`);
};
const fail = (msg: string, path = "/items"): never => back(path, `?error=${encodeURIComponent(msg)}`);

/** Αποθήκευση γενικού είδους (δημιουργία ή αλλαγή ονόματος/μονάδας/ΦΠΑ). */
export async function saveGenericItem(form: FormData) {
  const d = z
    .object({
      genericItemId: z.string().max(80),
      name: z.string().trim().min(2, "Γράψε όνομα είδους").max(80),
      baseUnitId: z.string().min(1),
      vatRateId: z.string().max(80),
    })
    .safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  const { org } = await currentOrg(d.data.genericItemId ? "items.edit" : "items.add");
  // η μονάδα είναι από τον κοινό πίνακα της πλατφόρμας· σε επεξεργασία δέχομαι και ανενεργή (η τρέχουσα)
  const unit = (await db.unit.findFirst({ where: { id: d.data.baseUnitId, active: true } })) ?? (d.data.genericItemId ? await db.unit.findFirst({ where: { id: d.data.baseUnitId } }) : null);
  if (!unit) return fail("Άγνωστη μονάδα μέτρησης");
  const vatRate = d.data.vatRateId ? await db.vatRate.findFirst({ where: { id: d.data.vatRateId } }) : null;
  if (d.data.vatRateId && !vatRate) return fail("Άγνωστος συντελεστής ΦΠΑ");
  const name = d.data.name;
  if (await db.genericItem.findFirst({ where: { orgId: org.id, name, NOT: { id: d.data.genericItemId || undefined } } })) return fail(`Υπάρχει ήδη είδος «${name}»`);
  const data = { name, baseUnitId: unit.id, vatRateId: vatRate?.id ?? null };
  if (d.data.genericItemId) await db.genericItem.updateMany({ where: { id: d.data.genericItemId, orgId: org.id }, data });
  else await db.genericItem.create({ data: { ...data, orgId: org.id } });
  back("/items", "?saved=1");
}

/** Γενικό είδος που χρησιμοποιήθηκε δεν σβήνεται: κρύβεται και ξαναεμφανίζεται με ένα κλικ. */
export async function toggleGenericItem(genericItemId: string) {
  const { org } = await currentOrg("items.edit");
  const g = await db.genericItem.findFirst({ where: { id: genericItemId, orgId: org.id } });
  if (g) await db.genericItem.update({ where: { id: g.id }, data: { active: !g.active } });
  back("/items", "?saved=1");
}

/** Υιοθεσία εμπορικού είδους με barcode: ο κεντρικός κατάλογος ή τα ιδιωτικά της επιχείρησης. */
export async function addMapping(form: FormData) {
  const d = z.object({ genericItemId: z.string().min(1), code: z.string().trim().min(4, "Σάρωσε ή γράψε barcode").max(48) }).safeParse(Object.fromEntries(form));
  const genericItemId = d.success ? d.data.genericItemId : String(form.get("genericItemId") ?? "");
  const path = `/items/${genericItemId}`;
  if (!d.success) return fail(d.error.issues[0].message, path);
  const { org } = await currentOrg("items.edit");
  const generic = await db.genericItem.findFirst({ where: { id: genericItemId, orgId: org.id } });
  if (!generic) return fail("Άγνωστο είδος");
  // Το σκανάρισμα μπορεί να είναι απλό EAN-13, GTIN-14 (κιβώτιο) ή GS1 με AI — δοκιμάζουμε όλες τις μορφές
  const scan = parseGs1(d.data.code);
  const candidates = [...new Set([scan?.ean, scan?.gtin, d.data.code].filter((x): x is string => !!x))];
  const item = await db.tradeItem.findFirst({ where: { ean: { in: candidates }, OR: [{ orgId: null }, { orgId: org.id }] }, include: { brand: true } });
  if (!item) return fail(`Δεν βρέθηκε είδος με barcode «${d.data.code}» στον κατάλογο — καταχώρισέ το πρώτα`, path);
  const existing = await db.itemMapping.findFirst({ where: { orgId: org.id, tradeItemId: item.id }, include: { genericItem: true } });
  if (existing) return fail(existing.genericItemId === genericItemId ? `Το «${item.name}» είναι ήδη συνδεδεμένο` : `Το «${item.name}» είναι ήδη συνδεδεμένο στο «${existing.genericItem.name}»`, path);
  await db.itemMapping.create({ data: { orgId: org.id, genericItemId, tradeItemId: item.id } });
  // Αν το γενικό είδος δεν έχει σύσταση και ο κατάλογος έχει, την κληρονομεί (μπορεί να αλλαχθεί μετά)
  const catalogComp = await db.composition.findUnique({ where: { tradeItemId: item.id } });
  if (catalogComp && !(await db.composition.findUnique({ where: { genericItemId } })))
    await db.composition.create({ data: { ...compositionCopyData(catalogComp), orgId: org.id, genericItemId } });
  back(path, catalogComp ? "?saved=1&copied=1" : "?saved=1");
}

/** Τεχνική σύσταση γενικού είδους (% ανά 100 g) — μία ανά είδος, του συνδρομητή. */
export async function saveItemComposition(form: FormData) {
  const genericItemId = String(form.get("genericItemId") ?? "");
  const path = `/items/${genericItemId}/composition`;
  const { org } = await currentOrg("items.edit");
  const generic = await db.genericItem.findFirst({ where: { id: genericItemId, orgId: org.id } });
  if (!generic) return fail("Άγνωστο είδος", path);
  const r = compositionFromForm(form);
  if ("error" in r) return fail(r.error, path);
  await db.composition.upsert({ where: { genericItemId }, create: { ...r.data, orgId: org.id, genericItemId }, update: r.data });
  back(path, "?saved=1");
}

/** Επαναφορά της σύστασης από τον κεντρικό κατάλογο (πρώτη συνδεδεμένη συσκευασία που έχει). */
export async function copyComposition(genericItemId: string) {
  const { org } = await currentOrg("items.edit");
  const path = `/items/${genericItemId}/composition`;
  const generic = await db.genericItem.findFirst({ where: { id: genericItemId, orgId: org.id } });
  if (!generic) return fail("Άγνωστο είδος", path);
  const mapping = await db.itemMapping.findFirst({ where: { orgId: org.id, genericItemId }, include: { tradeItem: { include: { composition: true } } } });
  const source = mapping?.tradeItem.composition;
  if (!source) return fail("Καμία συνδεδεμένη συσκευασία δεν έχει σύσταση στον κατάλογο", path);
  await db.composition.upsert({
    where: { genericItemId },
    create: { ...compositionCopyData(source), orgId: org.id, genericItemId },
    update: compositionCopyData(source),
  });
  back(path, "?copied=1");
}

export async function removeMapping(mappingId: string, genericItemId: string) {
  const { org } = await currentOrg("items.edit");
  await db.itemMapping.deleteMany({ where: { id: mappingId, orgId: org.id } });
  back(`/items/${genericItemId}`, "?saved=1");
}

/** Σύνδεση προμηθευτή με εμπορικό είδος: κωδικός προμηθευτή, barcode και πολλαπλότητα συσκευασίας. */
export async function saveSupplierItem(form: FormData) {
  const raw = Object.fromEntries(form);
  const d = z
    .object({
      supplierItemId: z.string().max(80),
      genericItemId: z.string().min(1),
      supplierId: z.string().min(1),
      tradeItemId: z.string().min(1),
      supplierCode: z.string().trim().max(40),
      barcode: z.string().trim().max(48),
    })
    .safeParse(raw);
  const genericItemId = String(raw.genericItemId ?? "");
  const path = `/items/${genericItemId}`;
  if (!d.success) return fail(d.error.issues[0].message, path);
  const { org } = await currentOrg(d.data.supplierItemId ? "items.edit" : "items.add");
  // ο προμηθευτής είναι συναλλασσόμενος της επιχείρησης με ρόλο supplier
  const supplier = await db.party.findFirst({ where: { id: d.data.supplierId, orgId: org.id, roles: { has: "supplier" } } });
  if (!supplier) return fail("Άγνωστος προμηθευτής", path);
  const item = await db.tradeItem.findFirst({ where: { id: d.data.tradeItemId, OR: [{ orgId: null }, { orgId: org.id }] } });
  if (!item) return fail("Άγνωστο εμπορικό είδος", path);
  const packQty = Number(String(raw.packQty ?? "1").replace(",", "."));
  if (!Number.isInteger(packQty) || packQty < 1 || packQty > 100_000) return fail("Η πολλαπλότητα συσκευασίας είναι θετικός ακέραιος, π.χ. 12", path);
  const supplierCode = d.data.supplierCode || null;
  if (supplierCode && (await db.supplierItem.findFirst({ where: { orgId: org.id, supplierId: supplier.id, supplierCode, NOT: { id: d.data.supplierItemId || undefined } } })))
    return fail(`Ο κωδικός «${supplierCode}» χρησιμοποιείται ήδη από τον προμηθευτή`, path);
  const data = { supplierId: supplier.id, tradeItemId: item.id, supplierCode, barcode: d.data.barcode || null, packQty };
  if (d.data.supplierItemId) await db.supplierItem.updateMany({ where: { id: d.data.supplierItemId, orgId: org.id }, data });
  else await db.supplierItem.create({ data: { ...data, orgId: org.id } });
  back(path, "?saved=1");
}

export async function toggleSupplierItem(supplierItemId: string, genericItemId: string) {
  const { org } = await currentOrg("items.edit");
  const s = await db.supplierItem.findFirst({ where: { id: supplierItemId, orgId: org.id } });
  if (s) await db.supplierItem.update({ where: { id: s.id }, data: { active: !s.active } });
  back(`/items/${genericItemId}`, "?saved=1");
}

/** Διόρθωση αποθέματος: χειροκίνητη κίνηση ± σε βασική μονάδα με αιτιολογία (append-only, πηγή «manual»). */
export async function addCorrection(form: FormData) {
  const raw = Object.fromEntries(form);
  const genericItemId = String(raw.genericItemId ?? "");
  const path = `/items/${genericItemId}`;
  const d = z.object({ genericItemId: z.string().min(1), warehouseId: z.string().min(1), note: z.string().trim().min(3, "Γράψε αιτιολογία, π.χ. «σπασίματα»").max(120) }).safeParse(raw);
  if (!d.success) return fail(d.error.issues[0].message, path);
  const { org } = await currentOrg("warehouses.edit");
  const qty = Number(String(raw.qty ?? "").replace(",", "."));
  if (!Number.isInteger(qty) || qty === 0) return fail("Η ποσότητα διόρθωσης είναι μη μηδενικός ακέραιος στη βασική μονάδα (π.χ. -500 για μισό κιλό λιγότερο)", path);
  const generic = await db.genericItem.findFirst({ where: { id: d.data.genericItemId, orgId: org.id } });
  const warehouse = await db.warehouse.findFirst({ where: { id: d.data.warehouseId, orgId: org.id } });
  if (!generic || !warehouse) return fail("Άγνωστο είδος ή αποθήκη", path);
  try {
    await addStockMovement(db, { orgId: org.id, warehouseId: warehouse.id, quantity: qty, genericItemId: generic.id, source: "manual", note: d.data.note });
  } catch {
    return fail("Η διόρθωση θα οδηγούσε σε αρνητικό απόθεμα", path);
  }
  back(path, "?saved=1");
}

/** Νέα τιμή/συμφωνία σε σύνδεση προμηθευτή. Μόνο προσθήκη: το ιστορικό δεν πειράζεται ποτέ. */
export async function addSupplierItemPrice(form: FormData) {
  const raw = Object.fromEntries(form);
  const d = z
    .object({
      supplierItemId: z.string().min(1),
      genericItemId: z.string().min(1),
      minPackQty: z.string().trim().max(10),
      validFrom: z.string().trim().max(10),
      validTo: z.string().trim().max(10),
      note: z.string().trim().max(120),
    })
    .safeParse(raw);
  const genericItemId = String(raw.genericItemId ?? "");
  const path = `/items/${genericItemId}`;
  if (!d.success) return fail(d.error.issues[0].message, path);
  const { org, user } = await currentOrg("items.edit");
  const si = await db.supplierItem.findFirst({ where: { id: d.data.supplierItemId, orgId: org.id } });
  if (!si) return fail("Άγνωστη σύνδεση προμηθευτή", path);
  // η τιμή γράφεται σε ευρώ προ ΦΠΑ, κρατιέται σε λεπτά
  const priceCents = Math.round(Number(String(raw.price ?? "").replace(",", ".")) * 100);
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100_000_000) return fail("Η τιμή είναι ποσό σε ευρώ προ ΦΠΑ, π.χ. 12,40", path);
  const minPackQty = d.data.minPackQty ? Number(d.data.minPackQty) : null;
  if (minPackQty != null && (!Number.isInteger(minPackQty) || minPackQty < 1)) return fail("Η ελάχιστη ποσότητα είναι θετικός ακέραιος", path);
  const validFrom = d.data.validFrom ? new Date(`${d.data.validFrom}T00:00:00Z`) : new Date();
  const validTo = d.data.validTo ? new Date(`${d.data.validTo}T00:00:00Z`) : null;
  if (Number.isNaN(validFrom.getTime()) || (validTo && Number.isNaN(validTo.getTime()))) return fail("Άκυρη ημερομηνία ισχύος", path);
  if (validTo && validTo < validFrom) return fail("Το «έως» είναι πριν το «από»", path);
  await db.supplierItemPrice.create({
    data: { supplierItemId: si.id, priceCents, minPackQty, validFrom, validTo, note: d.data.note || null, createdByName: user.name },
  });
  back(path, "?saved=1");
}
