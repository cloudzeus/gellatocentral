"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseGs1 } from "@/lib/gs1";
import { scanPurchaseInvoice } from "@/lib/ai/ocr-scan";
import { importMyIncome } from "@/lib/mydata-income";
import { matchLine } from "@/lib/purchases";
import { postPurchase } from "@/lib/purchases-db";

const back = (path: string, q = ""): never => {
  revalidatePath("/purchases");
  redirect(`${path}${q}`);
};
const fail = (msg: string, path = "/purchases"): never => back(path, `?error=${encodeURIComponent(msg)}`);

/** Νέο τιμολόγιο αγοράς (πρόχειρο): προμηθευτής, αποθήκη παραλαβής, στοιχεία παραστατικού. */
export async function createDoc(form: FormData) {
  const d = z
    .object({
      supplierId: z.string().min(1),
      warehouseId: z.string().min(1),
      number: z.string().trim().max(40),
      issuedAt: z.string().trim().max(10),
      note: z.string().trim().max(200),
    })
    .safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  const { org, user } = await currentOrg("purchases.add");
  const supplier = await db.party.findFirst({ where: { id: d.data.supplierId, orgId: org.id, roles: { has: "supplier" } } });
  if (!supplier) return fail("Άγνωστος προμηθευτής");
  const warehouse = await db.warehouse.findFirst({ where: { id: d.data.warehouseId, orgId: org.id, active: true } });
  if (!warehouse) return fail("Άγνωστη αποθήκη");
  const issuedAt = d.data.issuedAt ? new Date(`${d.data.issuedAt}T00:00:00Z`) : null;
  if (issuedAt && Number.isNaN(issuedAt.getTime())) return fail("Άκυρη ημερομηνία έκδοσης");
  const doc = await db.purchaseDoc.create({
    data: { orgId: org.id, supplierId: supplier.id, warehouseId: warehouse.id, number: d.data.number || null, issuedAt, note: d.data.note || null, createdByName: user.name },
  });
  back(`/purchases/${doc.id}`);
}

/** Τα δεδομένα που χρειάζεται η αντιστοίχιση: συνδέσεις του προμηθευτή, κεντρικός+ιδιωτικός κατάλογος, mappings. */
async function matchCtx(orgId: string, supplierId: string) {
  const [supplierItems, tradeItems, mappings] = await Promise.all([
    db.supplierItem.findMany({ where: { orgId, active: true } }),
    db.tradeItem.findMany({ where: { OR: [{ orgId: null }, { orgId }] }, select: { id: true, ean: true, name: true } }),
    db.itemMapping.findMany({ where: { orgId } }),
  ]);
  return { supplierId, supplierItems, tradeItems, mappings };
}

/** Νέα γραμμή τιμολογίου. Αν το πεδίο barcode κρατά GS1 με AI, γεμίζει και παρτίδα/λήξη. */
export async function addLine(form: FormData) {
  const raw = Object.fromEntries(form);
  const docId = String(raw.documentId ?? "");
  const path = `/purchases/${docId}`;
  const d = z
    .object({
      documentId: z.string().min(1),
      description: z.string().trim().min(2, "Γράψε περιγραφή όπως στο τιμολόγιο").max(120),
      supplierCode: z.string().trim().max(40),
      ean: z.string().trim().max(48),
      batchNumber: z.string().trim().max(20),
      expiresAt: z.string().trim().max(10),
      receiptIssue: z.string().trim().max(120),
    })
    .safeParse(raw);
  if (!d.success) return fail(d.error.issues[0].message, path);
  const { org } = await currentOrg("purchases.add");
  const doc = await db.purchaseDoc.findFirst({ where: { id: docId, orgId: org.id } });
  if (!doc) return fail("Άγνωστο τιμολόγιο");
  if (doc.status !== "DRAFT") return fail("Το τιμολόγιο έχει καταχωρηθεί — δεν αλλάζει", path);

  const quantity = Number(String(raw.quantity ?? "").replace(",", "."));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) return fail("Η ποσότητα είναι θετικός ακέραιος", path);
  const unitPriceCents = Math.round(Number(String(raw.unitPrice ?? "").replace(",", ".")) * 100);
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) return fail("Η τιμή είναι ποσό σε ευρώ προ ΦΠΑ", path);
  const receiptTempC = String(raw.receiptTempC ?? "").trim() ? Number(String(raw.receiptTempC).replace(",", ".")) : null;
  if (receiptTempC != null && (!Number.isFinite(receiptTempC) || receiptTempC < -40 || receiptTempC > 80)) return fail("Η θερμοκρασία παραλαβής είναι σε °C, π.χ. 4,0", path);
  const expiresAt = d.data.expiresAt ? new Date(`${d.data.expiresAt}T00:00:00Z`) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return fail("Άκυρη ημερομηνία λήξης", path);

  // GS1 σάρωση: το ίδιο πεδίο μπορεί να φέρει GTIN + παρτίδα + λήξη
  const scan = d.data.ean ? parseGs1(d.data.ean) : undefined;
  const ean = scan?.ean ?? scan?.gtin ?? (d.data.ean || null);
  const batchNumber = d.data.batchNumber || scan?.batch || null;
  const expiry = expiresAt ?? scan?.expiry ?? null;

  const m = matchLine({ supplierCode: d.data.supplierCode || null, ean, description: d.data.description }, await matchCtx(org.id, doc.supplierId));

  await db.purchaseLine.create({
    data: {
      orgId: org.id,
      documentId: doc.id,
      supplierCode: d.data.supplierCode || null,
      ean,
      description: d.data.description,
      quantity,
      unitPriceCents,
      batchNumber,
      expiresAt: expiry,
      receiptTempC,
      receiptIssue: d.data.receiptIssue || null,
      supplierItemId: m.supplierItemId ?? null,
      tradeItemId: m.tradeItemId ?? null,
      genericItemId: m.genericItemId ?? null,
      matchNote: m.matchNote ?? (m.suggestion ? `suggest:${m.suggestion.tradeItemId}` : null),
    },
  });
  back(path, "?saved=1");
}

/** Χειροκίνητη αντιστοίχιση/επιβεβαίωση πρότασης. «Μαθαίνει»: γράφει τον κωδικό της γραμμής στο SupplierItem. */
export async function rematchLine(form: FormData) {
  const raw = Object.fromEntries(form);
  const lineId = String(raw.lineId ?? "");
  const docId = String(raw.documentId ?? "");
  const path = `/purchases/${docId}`;
  const supplierItemId = String(raw.supplierItemId ?? "");
  if (!lineId || !supplierItemId) return fail("Διάλεξε είδος προμηθευτή", path);
  const { org } = await currentOrg("purchases.edit");
  const line = await db.purchaseLine.findFirst({ where: { id: lineId, orgId: org.id }, include: { document: true } });
  if (!line || line.document.status !== "DRAFT") return fail("Η γραμμή δεν βρέθηκε ή το τιμολόγιο έχει καταχωρηθεί", path);
  const si = await db.supplierItem.findFirst({ where: { id: supplierItemId, orgId: org.id, supplierId: line.document.supplierId } });
  if (!si) return fail("Η σύνδεση προμηθευτή δεν βρέθηκε", path);
  const mapping = await db.itemMapping.findFirst({ where: { orgId: org.id, tradeItemId: si.tradeItemId } });
  await db.$transaction([
    db.purchaseLine.update({
      where: { id: line.id },
      data: { supplierItemId: si.id, tradeItemId: si.tradeItemId, genericItemId: mapping?.genericItemId ?? null, matchNote: "manual" },
    }),
    // μάθηση: την επόμενη φορά ο κωδικός αυτός αναγνωρίζεται αυτόματα
    ...(line.supplierCode && !si.supplierCode ? [db.supplierItem.update({ where: { id: si.id }, data: { supplierCode: line.supplierCode } })] : []),
  ]);
  back(path, mapping ? "?saved=1" : `?error=${encodeURIComponent("Το είδος δεν είναι συνδεδεμένο με γενικό — σύνδεσέ το στα Γενικά είδη πριν την καταχώριση")}`);
}

export async function removeLine(lineId: string, docId: string) {
  const { org } = await currentOrg("purchases.edit");
  const doc = await db.purchaseDoc.findFirst({ where: { id: docId, orgId: org.id } });
  if (doc?.status === "DRAFT") await db.purchaseLine.deleteMany({ where: { id: lineId, orgId: org.id } });
  back(`/purchases/${docId}`, "?saved=1");
}

/** Μαζική διαγραφή μόνο γραμμών πρόχειρου τιμολογίου της ίδιας επιχείρησης. */
export async function removeLines(docId: string, ids: string[]) {
  const parsed = z.object({ docId: z.string().cuid(), ids: z.array(z.string().cuid()).min(1).max(200) }).safeParse({ docId, ids });
  if (!parsed.success) return "Η επιλογή γραμμών δεν είναι έγκυρη";
  const { org } = await currentOrg("purchases.edit");
  const doc = await db.purchaseDoc.findFirst({ where: { id: parsed.data.docId, orgId: org.id, status: "DRAFT" }, select: { id: true } });
  if (!doc) return "Το πρόχειρο τιμολόγιο δεν βρέθηκε ή έχει ήδη καταχωρηθεί";
  const unique = [...new Set(parsed.data.ids)];
  const result = await db.purchaseLine.deleteMany({ where: { id: { in: unique }, documentId: doc.id, orgId: org.id } });
  revalidatePath(`/purchases/${doc.id}`);
  revalidatePath("/purchases");
  if (result.count !== unique.length) return "Ορισμένες γραμμές δεν βρέθηκαν· ανανέωσε το τιμολόγιο";
}

/** Αποδοχή: παρτίδες + αποθέματα + τιμές, όλα σε μία συναλλαγή (lib/purchases-db.ts). */
export async function postDoc(docId: string) {
  const { org } = await currentOrg("purchases.edit");
  try {
    await postPurchase(org.id, docId);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Η καταχώριση απέτυχε", `/purchases/${docId}`);
  }
  back(`/purchases/${docId}`, "?posted=1");
}

export async function cancelDoc(docId: string) {
  const { org } = await currentOrg("purchases.edit");
  await db.purchaseDoc.updateMany({ where: { id: docId, orgId: org.id, status: "DRAFT" }, data: { status: "CANCELLED" } });
  back("/purchases", "?saved=1");
}

/** Λήψη μηχανογραφημένων τιμολογίων από myDATA για διάστημα — γίνονται πρόχειρα για έλεγχο. */
export async function importDocs(form: FormData) {
  const { org, user } = await currentOrg("purchases.add");
  const from = new Date(`${String(form.get("dateFrom") ?? "")}T00:00:00Z`);
  const to = new Date(`${String(form.get("dateTo") ?? "")}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return fail("Δώσε έγκυρο διάστημα ημερομηνιών");
  if (to.getTime() - from.getTime() > 93 * 86_400_000) return fail("Το διάστημα είναι έως ένα τρίμηνο");
  try {
    const r = await importMyIncome(org.id, user.name, from, to);
    back("/purchases", `?saved=${encodeURIComponent(`Λήφθηκαν ${r.created} παραστατικά${r.skipped ? ` (${r.skipped} ήδη υπήρχαν)` : ""}`)}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Η λήψη απέτυχε");
  }
}

/** Σάρωση τιμολογίου (OCR, pay-per-use): η φωτογραφία γίνεται πρόχειρο με αντιστοιχισμένες γραμμές. */
export async function scanDoc(form: FormData) {
  const { org, user } = await currentOrg("purchases.add");
  const supplierId = String(form.get("supplierId") ?? "");
  const warehouseId = String(form.get("warehouseId") ?? "");
  const file = form.get("photo");
  if (!(file instanceof File) || !file.size) return fail("Διάλεξε φωτογραφία του τιμολογίου");
  if (file.size > 8 * 1024 * 1024) return fail("Η φωτογραφία είναι πολύ μεγάλη (έως 8 MB)");
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return fail("Δεκτές μορφές: JPG, PNG, WebP");
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  try {
    const docId = await scanPurchaseInvoice(org.id, user.name, supplierId, warehouseId, file.type, base64);
    back(`/purchases/${docId}`, "?saved=1");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Η σάρωση απέτυχε");
  }
}
