"use server";

import { flashOk } from "@/lib/flash-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseGs1 } from "@/lib/gs1";
import { scanPurchaseInvoice } from "@/lib/ai/ocr-scan";
import { importMyIncome } from "@/lib/mydata-income";
import { checkQuietly, resolveCheck } from "@/lib/mydata-check";
import { matchLine } from "@/lib/purchases";
import { purchaseSnapshots } from "@/lib/purchase-snapshots";
import { postPurchase } from "@/lib/purchases-db";
import { createCredit, createReturn, issueReturn, postImportedCredit } from "@/lib/purchase-returns";
import { transmitPurchaseReturn } from "@/lib/mydata-outgoing";
import { readableError } from "@/lib/fiscal-retry-rules";
import { saveFile } from "@/lib/storage";
import { requireStockContext } from "@/lib/stock-context";
import { runTask } from "@/lib/tasks";
import { rethrowControlFlow } from "@/lib/workflow-db";

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
  const supplier = await db.party.findFirst({ where: { id: d.data.supplierId, orgId: org.id, roles: { has: "supplier" } }, include: { paymentMethod: true } });
  if (!supplier) return fail("Άγνωστος προμηθευτής");
  const warehouse = await db.warehouse.findFirst({ where: { id: d.data.warehouseId, orgId: org.id, active: true } });
  if (!warehouse) return fail("Άγνωστη αποθήκη");
  const issuedAt = d.data.issuedAt ? new Date(`${d.data.issuedAt}T00:00:00Z`) : null;
  if (issuedAt && Number.isNaN(issuedAt.getTime())) return fail("Άκυρη ημερομηνία έκδοσης");
  const snapshots = await purchaseSnapshots(org, supplier);
  const doc = await db.purchaseDoc.create({
    data: {
      orgId: org.id, supplierId: supplier.id, warehouseId: warehouse.id, number: d.data.number || null, issuedAt, note: d.data.note || null,
      ...snapshots, paymentMethod: supplier.paymentMethod?.name ?? null, paymentTerms: supplier.paymentTermsDays != null ? `Πίστωση ${supplier.paymentTermsDays} ημερών` : null, createdByName: user.name,
    },
  });
  await flashOk("Το πρόχειρο τιμολόγιο αγοράς δημιουργήθηκε");
  back(`/purchases/${doc.id}`);
}

const money = (value: FormDataEntryValue | null): number | null => {
  const cents = Math.round(Number(String(value ?? "").trim().replace(",", ".")) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000_000 ? cents : null;
};
const percent = (value: FormDataEntryValue | null): number | null => {
  const bps = Math.round(Number(String(value ?? "").trim().replace(",", ".")) * 100);
  return Number.isSafeInteger(bps) && bps >= 0 && bps <= 10_000 ? bps : null;
};
const vat = (value: FormDataEntryValue | null): number | null => {
  const rate = Number(String(value ?? "").trim());
  return Number.isInteger(rate) && rate >= 0 && rate <= 100 ? rate : null;
};
const blank = (value: FormDataEntryValue | null, max = 200) => String(value ?? "").trim().slice(0, max) || null;

/** Στοιχεία έκδοσης, πληρωμής, αποστολής και εξόδων· μόνο όσο το παραστατικό είναι πρόχειρο. */
export async function updateDoc(form: FormData) {
  const raw = Object.fromEntries(form);
  const docId = String(raw.documentId ?? "");
  const path = `/purchases/${docId}`;
  const schema = z.object({ documentId: z.string().cuid(), number: z.string().trim().max(40), issuedAt: z.string().trim().max(10), note: z.string().trim().max(500) });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail("Τα βασικά στοιχεία δεν είναι έγκυρα", path);
  const issuedAt = parsed.data.issuedAt ? new Date(`${parsed.data.issuedAt}T00:00:00Z`) : null;
  const shippingCostCents = money(form.get("shippingCost"));
  const otherExpensesCents = money(form.get("otherExpenses"));
  const expensesVatRate = vat(form.get("expensesVatRate"));
  if (issuedAt && Number.isNaN(issuedAt.getTime())) return fail("Άκυρη ημερομηνία έκδοσης", path);
  if (shippingCostCents == null || otherExpensesCents == null || expensesVatRate == null) return fail("Έλεγξε τα έξοδα και τον συντελεστή ΦΠΑ τους", path);
  const { org } = await currentOrg("purchases.edit");
  const result = await db.purchaseDoc.updateMany({
    where: { id: docId, orgId: org.id, status: "DRAFT", receiptInvoice: { is: null } },
    data: {
      number: parsed.data.number || null, issuedAt, note: parsed.data.note || null,
      paymentMethod: blank(form.get("paymentMethod"), 120), paymentTerms: blank(form.get("paymentTerms"), 120),
      shippingMethod: blank(form.get("shippingMethod"), 120), shippingAddress: blank(form.get("shippingAddress"), 300),
      shippingCostCents, otherExpensesCents, expensesVatRate,
    },
  });
  if (!result.count) return fail("Το πρόχειρο τιμολόγιο δεν βρέθηκε ή έχει ήδη καταχωρηθεί", path);
  back(path, "?saved=1");
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
  const doc = await db.purchaseDoc.findFirst({ where: { id: docId, orgId: org.id, receiptInvoice: { is: null } } });
  if (!doc) return fail("Άγνωστο τιμολόγιο");
  if (doc.status !== "DRAFT") return fail("Το τιμολόγιο έχει καταχωρηθεί — δεν αλλάζει", path);

  const quantity = Number(String(raw.quantity ?? "").replace(",", "."));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) return fail("Η ποσότητα είναι θετικός ακέραιος", path);
  const unitPriceCents = money(form.get("unitPrice"));
  const discountBps = percent(form.get("discountPercent"));
  const vatRate = vat(form.get("vatRate"));
  if (unitPriceCents == null) return fail("Η τιμή είναι ποσό σε ευρώ προ έκπτωσης και ΦΠΑ", path);
  if (discountBps == null) return fail("Η έκπτωση γραμμής είναι ποσοστό από 0 έως 100", path);
  if (vatRate == null) return fail("Διάλεξε έγκυρο συντελεστή ΦΠΑ", path);
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
      discountBps,
      vatRate,
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
  const line = await db.purchaseLine.findFirst({ where: { id: lineId, orgId: org.id, document: { receiptInvoice: { is: null } } }, include: { document: true } });
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
  const doc = await db.purchaseDoc.findFirst({ where: { id: docId, orgId: org.id, receiptInvoice: { is: null } } });
  if (doc?.status === "DRAFT") await db.purchaseLine.deleteMany({ where: { id: lineId, orgId: org.id, documentId: doc.id } }); // μόνο γραμμή αυτού του πρόχειρου
  back(`/purchases/${docId}`, "?saved=1");
}

/** Μαζική διαγραφή μόνο γραμμών πρόχειρου τιμολογίου της ίδιας επιχείρησης. */
export async function removeLines(docId: string, ids: string[]) {
  const parsed = z.object({ docId: z.string().cuid(), ids: z.array(z.string().cuid()).min(1).max(200) }).safeParse({ docId, ids });
  if (!parsed.success) return "Η επιλογή γραμμών δεν είναι έγκυρη";
  const { org } = await currentOrg("purchases.edit");
  const doc = await db.purchaseDoc.findFirst({ where: { id: parsed.data.docId, orgId: org.id, status: "DRAFT", receiptInvoice: { is: null } }, select: { id: true } });
  if (!doc) return "Το πρόχειρο τιμολόγιο δεν βρέθηκε ή έχει ήδη καταχωρηθεί";
  const unique = [...new Set(parsed.data.ids)];
  const result = await db.purchaseLine.deleteMany({ where: { id: { in: unique }, documentId: doc.id, orgId: org.id } });
  revalidatePath(`/purchases/${doc.id}`);
  revalidatePath("/purchases");
  if (result.count !== unique.length) return "Ορισμένες γραμμές δεν βρέθηκαν· ανανέωσε το τιμολόγιο";
  await flashOk(unique.length === 1 ? "Η γραμμή του τιμολογίου διαγράφηκε" : `${unique.length} γραμμές του τιμολογίου διαγράφηκαν`);
}

/** Αποδοχή: παρτίδες + αποθέματα + τιμές, όλα σε μία συναλλαγή (lib/purchases-db.ts). */
export async function postDoc(docId: string) {
  const ctx = await requireStockContext("purchases.edit");
  try {
    await postPurchase(ctx, docId);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Η καταχώριση απέτυχε", `/purchases/${docId}`);
  }
  back(`/purchases/${docId}`, "?posted=1");
}

export async function cancelDoc(docId: string) {
  const { org } = await currentOrg("purchases.edit");
  const result = await db.purchaseDoc.updateMany({ where: { id: docId, orgId: org.id, status: "DRAFT", receiptInvoice: { is: null } }, data: { status: "CANCELLED" } });
  if (!result.count) return fail("Το συνδεδεμένο τιμολόγιο παραλαβής δεν ακυρώνεται εκτός τριπλού ελέγχου", `/purchases/${docId}`);
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
    // εξωτερική υπηρεσία (ΑΑΔΕ/myDATA) με πολλά παραστατικά: φαίνεται στο παράθυρο «Εργασίες»
    const r = await runTask({ orgId: org.id, userId: user.id, userName: user.name }, { kind: "purchases.mydata", title: "Λήψη τιμολογίων αγοράς από την ΑΑΔΕ", permission: "purchases.read" }, async (task) => {
      const result = await importMyIncome(org.id, user.name, from, to);
      task.result("/purchases");
      return result;
    });
    back("/purchases", `?saved=${encodeURIComponent(`Λήφθηκαν ${r.created} παραστατικά${r.skipped ? ` (${r.skipped} ήδη υπήρχαν)` : ""}`)}`);
  } catch (e) {
    rethrowControlFlow(e); // το redirect της επιτυχίας δεν είναι σφάλμα
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
  const data = new Uint8Array(await file.arrayBuffer());
  const base64 = Buffer.from(data).toString("base64");
  try {
    const docId = await runTask({ orgId: org.id, userId: user.id, userName: user.name }, { kind: "purchases.scan", title: `Ανάγνωση τιμολογίου αγοράς · ${file.name.slice(0, 60)}`, permission: "purchases.read" }, async (task) => {
      const id = await scanPurchaseInvoice(org.id, user.name, supplierId, warehouseId, file.type, base64);
      task.result(`/purchases/${id}`);
      return id;
    });
    await checkQuietly(org.id, docId); // σύγκριση με το myDATA αν τυπώνεται MARK ή υπάρχει ΑΦΜ+αριθμός
    try {
      await saveFile({ orgId: org.id, category: "purchase_document", refType: "purchase", refId: docId, name: file.name, data, userId: user.id });
    } catch {
      return fail("Το OCR ολοκληρώθηκε και το πρόχειρο δημιουργήθηκε, αλλά το πρωτότυπο αρχείο δεν αποθηκεύτηκε. Ανέβασέ το από την καρτέλα.", `/purchases/${docId}`);
    }
    back(`/purchases/${docId}`, "?saved=ocr");
  } catch (e) {
    rethrowControlFlow(e); // το redirect της επιτυχίας δεν είναι σφάλμα
    return fail(e instanceof Error ? e.message : "Η σάρωση απέτυχε");
  }
}

// ---- Επιστροφές σε προμηθευτή και πιστωτικά προμηθευτή (lib/purchase-returns.ts) ----

const quantitiesOf = (form: FormData) => [...form.entries()].filter(([k]) => k.startsWith("qty:")).map(([k, v]) => ({ lineId: k.slice(4), quantity: Number(String(v).trim() || "0") }));
const cents = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(",", ".")) * 100);

/** Πρόχειρη επιστροφή από τιμολόγιο → η καρτέλα της, όπου εκδίδεται το 9.3. */
export async function createReturnAction(invoiceId: string, form: FormData) {
  const ctx = await requireStockContext("purchases.edit");
  let id: string;
  try {
    id = (await createReturn(ctx, invoiceId, quantitiesOf(form), String(form.get("reason") ?? "").trim().slice(0, 300) || null)).id;
  } catch (e) {
    rethrowControlFlow(e);
    return fail(e instanceof Error ? e.message : "Η επιστροφή δεν δημιουργήθηκε", `/purchases/${invoiceId}`);
  }
  back(`/purchases/${id}`);
}

/** Έκδοση 9.3 «Επιστροφή»: απόθεμα έξω και διαβίβαση· αν η διαβίβαση αποτύχει, μένει για επανάληψη. */
export async function issueReturnAction(returnId: string, form: FormData) {
  const ctx = await requireStockContext("purchases.edit");
  try {
    await issueReturn(ctx, returnId, String(form.get("seriesId") ?? ""));
  } catch (e) {
    rethrowControlFlow(e);
    return fail(e instanceof Error ? e.message : "Η έκδοση απέτυχε", `/purchases/${returnId}`);
  }
  await sendReturn(ctx, returnId);
}

export async function retransmitReturnAction(returnId: string) {
  await sendReturn(await requireStockContext("purchases.edit"), returnId);
}

async function sendReturn(ctx: Awaited<ReturnType<typeof requireStockContext>>, returnId: string) {
  try {
    await transmitPurchaseReturn(ctx, returnId);
  } catch (e) {
    rethrowControlFlow(e);
    return fail(`Το απόθεμα βγήκε, αλλά το 9.3 δεν διαβιβάστηκε: ${readableError(e instanceof Error ? e.message : null) ?? "άγνωστο σφάλμα"}. Θα ξαναδοκιμαστεί αυτόματα.`, `/purchases/${returnId}`);
  }
  await flashOk("Η επιστροφή εκδόθηκε και το 9.3 στάλθηκε στην ΑΑΔΕ");
  back(`/purchases/${returnId}`);
}

export async function createCreditAction(invoiceId: string, form: FormData) {
  const ctx = await requireStockContext("purchases.edit");
  const d = z.object({
    mydataType: z.enum(["5.1", "5.2"]), number: z.string().trim().max(40), issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Δώσε ημερομηνία"),
    mark: z.string().trim().max(40), stockMode: z.enum(["returned", "now", "value"]), returnId: z.string().max(40), vatRate: z.coerce.number().int().min(0).max(100), note: z.string().trim().max(200),
  }).safeParse({ mydataType: form.get("mydataType"), number: form.get("number") ?? "", issuedAt: form.get("issuedAt"), mark: form.get("mark") ?? "", stockMode: form.get("stockMode"), returnId: form.get("returnId") ?? "", vatRate: form.get("vatRate") ?? 24, note: form.get("note") ?? "" });
  if (!d.success) return fail(d.error.issues[0].message, `/purchases/${invoiceId}`);
  try {
    await createCredit(ctx, {
      invoiceId, mydataType: d.data.mydataType, number: d.data.number, issuedAt: new Date(`${d.data.issuedAt}T00:00:00Z`), mark: d.data.mark || null, stockMode: d.data.stockMode,
      returnId: d.data.returnId || null, quantities: quantitiesOf(form), amountCents: cents(form.get("amount")), vatRate: d.data.vatRate, note: d.data.note || null,
    });
  } catch (e) {
    rethrowControlFlow(e);
    return fail(e instanceof Error ? e.message : "Το πιστωτικό δεν καταχωρήθηκε", `/purchases/${invoiceId}`);
  }
  await flashOk("Το πιστωτικό καταχωρήθηκε και μείωσε το υπόλοιπο του τιμολογίου");
  back(`/purchases/${invoiceId}`);
}

/** Πιστωτικό από το myDATA: σύνδεση με τιμολόγιο (και επιστροφή) και καταχώριση. */
export async function postImportedCreditAction(creditId: string, form: FormData) {
  const ctx = await requireStockContext("purchases.edit");
  try {
    await postImportedCredit(ctx, creditId, String(form.get("invoiceId") ?? ""), String(form.get("returnId") ?? "") || null);
  } catch (e) {
    rethrowControlFlow(e);
    return fail(e instanceof Error ? e.message : "Το πιστωτικό δεν καταχωρήθηκε", `/purchases/${creditId}`);
  }
  await flashOk("Το πιστωτικό καταχωρήθηκε");
  back(`/purchases/${creditId}`);
}

// ---- Έλεγχος με το myDATA (lib/mydata-check.ts) ----

/** «Ξαναέλεγξε τώρα» από την καρτέλα του παραστατικού. */
export async function recheckMydata(docId: string) {
  const { org } = await currentOrg("purchases.edit");
  const r = await checkQuietly(org.id, docId);
  const msg = !r ? "Δεν ελέγχεται: λείπουν κλειδιά myDATA ή MARK / αριθμός με ΑΦΜ"
    : r.status === "MATCH" ? "Ίδιο με το myDATA"
    : r.status === "DIFF" ? `${r.diff.length} διαφορές με το myDATA`
    : r.status === "NOT_FOUND" ? "Δεν βρέθηκε ακόμα στο myDATA· θα ξαναελεγχθεί το βράδυ"
    : `Το myDATA δεν απάντησε: ${r.error ?? ""}`;
  back(`/purchases/${docId}`, `?saved=${encodeURIComponent(msg)}`);
}

/** Απόφαση για διαφορά: AADE = κράτα τα στοιχεία της ΑΑΔΕ, PAPER = το χαρτί είναι σωστό. */
export async function resolveMydata(docId: string, choice: "AADE" | "PAPER") {
  const { org, user } = await currentOrg("purchases.edit");
  const { open } = await resolveCheck(org.id, docId, choice, user.name);
  if (open.length) return fail(`Τα στοιχεία κεφαλίδας πήραν τις τιμές της ΑΑΔΕ, αλλά διαφέρουν ακόμα: ${open.map((d) => d.label).join(", ")}. Διόρθωσε τις γραμμές ώστε να βγαίνουν τα ποσά του myDATA.`, `/purchases/${docId}`);
  back(`/purchases/${docId}`, `?saved=${encodeURIComponent(choice === "AADE" ? "Κρατήθηκαν τα στοιχεία της ΑΑΔΕ" : "Σημειώθηκε ότι το χαρτί είναι σωστό")}`);
}
