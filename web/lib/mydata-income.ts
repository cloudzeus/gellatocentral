// Μηχανογραφημένη λήψη τιμολογίων αγοράς από το myDATA (RequestDocs: ό,τι εξέδωσαν άλλοι προς εμάς, ΑΑΔΕ myDATA REST API).
// Μόνο ανάγνωση: οι διαβιβάσεις μας γίνονται μέσω Viva. Τα κλειδιά (aadeUserId / aadeSubKey) τα ορίζει η πλατφόρμα ανά συνδρομητή.
// Κάθε παραστατικό γίνεται πρόχειρο PurchaseDoc· το mydataMark (@@unique στο PurchaseDoc) αποκλείει διπλές λήψεις.
// Οι γραμμές αντιστοιχίζονται με τον ίδιο κανόνα που ισχύει για χειροκίνητη καταχώριση και OCR.

import { db } from "./db";
import { continuation, mydataFault, parseMyIncomeXml, type MyIncomeDoc } from "./mydata-parse";
import { matchLine } from "./purchases";
import { partySnapshot } from "./purchase-document";

// ---- Λήψη από την ΑΑΔΕ ----

export class MydataError extends Error {}

// AADE_MYDATA_ENV=sandbox → mydataapidev (όπως στη διαβίβαση)· MYDATA_ENDPOINT: μόνο για δοκιμές απέναντι σε τοπικό server
const BASE = () =>
  (process.env.MYDATA_ENDPOINT || (process.env.AADE_MYDATA_ENV === "sandbox" ? "https://mydataapidev.aade.gr" : "https://mydatapi.aade.gr/myDATA")).replace(/\/$/, "");
const MAX_PAGES = 20;
const ddmmyyyy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

/** RequestDocs με όλες τις σελίδες (ως MAX_PAGES). Η ΑΑΔΕ γυρίζει σφάλματα και με HTTP 200, γι' αυτό ελέγχεται το σώμα. */
async function requestDocs(userId: string, subKey: string, params: Record<string, string>, method = "RequestDocs"): Promise<string[]> {
  const pages: string[] = [];
  let next: Record<string, string> = {};
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${BASE()}/${method}?${new URLSearchParams({ ...params, ...next })}`, {
      headers: { "aade-user-id": userId, "Ocp-Apim-Subscription-Key": subKey },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!res) throw new MydataError("Το myDATA δεν απάντησε");
    if (res.status === 401 || res.status === 403) throw new MydataError("Τα κλειδιά myDATA απορρίφθηκαν — έλεγξέ τα στην καρτέλα της επιχείρησης");
    if (!res.ok) throw new MydataError(`Το myDATA απάντησε ${res.status}`);
    const xml = await res.text();
    const fault = mydataFault(xml);
    if (fault) throw new MydataError(`Το myDATA απέρριψε το αίτημα: ${fault}`);
    pages.push(xml);
    const c = continuation(xml);
    if (!c) return pages;
    next = c;
  }
  throw new MydataError(`Πάνω από ${MAX_PAGES} σελίδες παραστατικών — διάλεξε μικρότερο διάστημα`);
}

/** RequestMyIncome: τα έσοδα του ΑΦΜ ανά ημέρα και τύπο (πλήθος, σύνολο), μαζί και όσα διαβίβασε η Viva για εμάς. */
export async function fetchBookIncome(userId: string, subKey: string, entityVat: string, from: Date, to: Date): Promise<string> {
  return (await requestDocs(userId, subKey, { entityVatNumber: entityVat, dateFrom: ddmmyyyy(from), dateTo: ddmmyyyy(to) }, "RequestMyIncome")).join("\n");
}

/** Τα παραστατικά προς εμάς για διάστημα ημερομηνιών. Επιστρέφει το ακατέργαστο XML όλων των σελίδων. */
export async function fetchMyIncome(userId: string, subKey: string, entityVat: string, from: Date, to: Date): Promise<string> {
  return (await requestDocs(userId, subKey, { mark: "0", entityVatNumber: entityVat, dateFrom: ddmmyyyy(from), dateTo: ddmmyyyy(to) })).join("\n");
}

/** Ένα παραστατικό προς εμάς με το ΜΑΡΚ του (mark = ΜΑΡΚ−1, maxMark = ΜΑΡΚ), για έλεγχο σκαναρισμένου. null αν δεν βρέθηκε. */
export async function fetchByMark(userId: string, subKey: string, entityVat: string, mark: string): Promise<MyIncomeDoc | null> {
  if (!/^\d{1,19}$/.test(mark)) throw new MydataError("Μη έγκυρο ΜΑΡΚ");
  const pages = await requestDocs(userId, subKey, { mark: String(BigInt(mark) - 1n), maxMark: mark, entityVatNumber: entityVat });
  return parseMyIncomeXml(pages.join("\n")).find((d) => d.mark === mark) ?? null;
}

// ---- Εισαγωγή ως πρόχειρα τιμολόγια αγοράς ----

const isCredit = (type: string | null) => type === "5.1" || type === "5.2";

/**
 * Φέρνει τα τιμολόγια αγοράς του διαστήματος από το myDATA και φτιάχνει πρόχειρα PurchaseDoc.
 * Γνωστό ΑΦΜ προμηθευτή → σύνδεση· άγνωστο → δημιουργείται καρτέλα προμηθευτή για έλεγχο.
 * Κάθε παραστατικό μπαίνει σε δική του συναλλαγή: αν ένα αποτύχει, τα υπόλοιπα μπαίνουν κανονικά.
 * Επιστρέφει πλήθος νέων/παραλειπόμενων (ήδη ληφθέντων) παραστατικών.
 */
export async function importMyIncome(orgId: string, userName: string, from: Date, to: Date): Promise<{ created: number; skipped: number }> {
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new MydataError("Η επιχείρηση δεν βρέθηκε");
  if (!org.aadeUserId || !org.aadeSubKey) throw new MydataError("Δεν έχουν οριστεί κλειδιά myDATA — τα ορίζει η πλατφόρμα στην καρτέλα της επιχείρησης");
  const warehouse = await db.warehouse.findFirst({ where: { orgId, active: true }, orderBy: { name: "asc" } });
  if (!warehouse) throw new MydataError("Χρειάζεται μια ενεργή αποθήκη για να μπούν τα παραστατικά");

  const docs = parseMyIncomeXml(await fetchMyIncome(org.aadeUserId, org.aadeSubKey, org.vatNumber, from, to));

  const [supplierItems, tradeItems, mappings, buyer] = await Promise.all([
    db.supplierItem.findMany({ where: { orgId, active: true } }),
    db.tradeItem.findMany({ where: { OR: [{ orgId: null }, { orgId }] }, select: { id: true, ean: true, name: true } }),
    db.itemMapping.findMany({ where: { orgId } }),
    db.party.findFirst({ where: { linkedOrgId: orgId } }),
  ]);

  let created = 0;
  let skipped = 0;
  for (const d of docs) {
    const exists = await db.purchaseDoc.findFirst({ where: { orgId, mydataMark: d.mark } });
    if (exists) {
      skipped++;
      continue;
    }
    await createFromMydata({ org, buyer, warehouseId: warehouse.id, userName, supplierItems, tradeItems, mappings }, d);
    created++;
  }
  return { created, skipped };
}

type ImportCtx = {
  org: { id: string; name: string; vatNumber: string };
  buyer: Parameters<typeof partySnapshot>[0] | null;
  warehouseId: string; userName: string;
  supplierItems: Parameters<typeof matchLine>[1]["supplierItems"]; tradeItems: Parameters<typeof matchLine>[1]["tradeItems"]; mappings: Parameters<typeof matchLine>[1]["mappings"];
};

/** Ένα παραστατικό του myDATA → πρόχειρο PurchaseDoc με αντιστοιχισμένες γραμμές. Και για το «Πέρασέ το» (lib/mydata-incoming.ts). */
export async function createFromMydata(c: ImportCtx, d: MyIncomeDoc) {
  const orgId = c.org.id;
  return db.$transaction(async (tx) => {
    let supplier = await tx.party.findFirst({ where: { orgId, vatNumber: d.supplierVat, roles: { has: "supplier" } } });
    // άγνωστος εκδότης: νέα καρτέλα προμηθευτή από τα στοιχεία του παραστατικού, για έλεγχο από τον χρήστη
    supplier ??= await tx.party.create({ data: { orgId, roles: ["supplier"], name: d.supplierName, vatNumber: d.supplierVat } });
    const doc = await tx.purchaseDoc.create({
      data: {
        orgId, supplierId: supplier.id, warehouseId: c.warehouseId, number: [d.series, d.number].filter(Boolean).join("-") || null, issuedAt: d.issuedAt, mydataMark: d.mark,
        // 5.1/5.2: πιστωτικό του προμηθευτή, όχι νέα αγορά· δένεται με το τιμολόγιο στην καρτέλα του (lib/purchase-returns.ts)
        kind: isCredit(d.type) ? "CREDIT" : "INVOICE", mydataType: d.type, relatedMark: d.relatedMark,
        source: "mydata", note: isCredit(d.type) ? "Πιστωτικό από myDATA — σύνδεσέ το με το τιμολόγιο που αφορά" : "Από myDATA — έλεγχος πριν από την αποδοχή",
        supplierSnapshot: partySnapshot(supplier), buyerSnapshot: partySnapshot({ ...c.buyer, name: c.org.name, vatNumber: c.org.vatNumber }), createdByName: c.userName,
      },
    });
    const ctx = { supplierId: supplier.id, supplierItems: c.supplierItems, tradeItems: c.tradeItems, mappings: c.mappings };
    for (const l of d.lines) {
      const m = matchLine({ supplierCode: null, ean: null, description: l.description }, ctx);
      await tx.purchaseLine.create({
        data: {
          orgId, documentId: doc.id, description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountBps: l.discountBps, vatRate: l.vatRate,
          supplierItemId: m.supplierItemId ?? null, tradeItemId: m.tradeItemId ?? null, genericItemId: m.genericItemId ?? null,
          matchNote: m.matchNote ?? (m.suggestion ? `suggest:${m.suggestion.tradeItemId}` : null),
        },
      });
    }
    return doc;
  });
}

/** Ό,τι χρειάζεται το createFromMydata για την επιχείρηση (κατάλογος προμηθευτών, αντιστοιχίσεις, αγοραστής). */
export async function importContext(orgId: string, userName: string, warehouseId: string): Promise<ImportCtx> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true, vatNumber: true } });
  const [supplierItems, tradeItems, mappings, buyer] = await Promise.all([
    db.supplierItem.findMany({ where: { orgId, active: true } }),
    db.tradeItem.findMany({ where: { OR: [{ orgId: null }, { orgId }] }, select: { id: true, ean: true, name: true } }),
    db.itemMapping.findMany({ where: { orgId } }),
    db.party.findFirst({ where: { linkedOrgId: orgId } }),
  ]);
  return { org, buyer, warehouseId, userName, supplierItems, tradeItems, mappings };
}
