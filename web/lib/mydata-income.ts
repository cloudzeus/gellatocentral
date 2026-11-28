// Μηχανογραφημένη λήψη τιμολογίων αγοράς από το myDATA (RequestMyIncome, ΑΑΔΕ myDATA REST API).
// Τα κλειδιά (aadeUserId / aadeSubKey) τα ορίζει η πλατφόρμα ανά συνδρομητή στην καρτέλα της επιχείρησης.
// Κάθε παραστατικό γίνεται πρόχειρο PurchaseDoc· το mydataMark (@@unique στο PurchaseDoc) αποκλείει διπλές λήψεις.
// Οι γραμμές αντιστοιχίζονται με τον ίδιο κανόνα που ισχύει για χειροκίνητη καταχώριση και OCR.

import { db } from "./db";
import { parseMyIncomeXml } from "./mydata-parse";
import { matchLine } from "./purchases";
import { partySnapshot } from "./purchase-document";

// ---- Λήψη από την ΑΑΔΕ ----

export class MydataError extends Error {}

// MYDATA_ENDPOINT: μόνο για δοκιμές απέναντι σε τοπικό server
const BASE = () => (process.env.MYDATA_ENDPOINT || "https://mydatapi.aade.gr/myDATA").replace(/\/$/, "");
const ddmmyyyy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

/** RequestMyIncome για διάστημα ημερομηνιών. Επιστρέφει το ακατέργαστο XML. */
export async function fetchMyIncome(userId: string, subKey: string, entityVat: string, from: Date, to: Date): Promise<string> {
  const q = new URLSearchParams({ entityVatNumber: entityVat, dateFrom: ddmmyyyy(from), dateTo: ddmmyyyy(to) });
  const res = await fetch(`${BASE()}/RequestMyIncome?${q}`, {
    headers: { "aade-user-id": userId, "Ocp-Apim-Subscription-Key": subKey },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res) throw new MydataError("Το myDATA δεν απάντησε");
  if (res.status === 401 || res.status === 403) throw new MydataError("Τα κλειδιά myDATA απορρίφθηκαν — έλεγξέ τα στην καρτέλα της επιχείρησης");
  if (!res.ok) throw new MydataError(`Το myDATA απάντησε ${res.status}`);
  return res.text();
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
    await db.$transaction(async (tx) => {
      let supplier = await tx.party.findFirst({ where: { orgId, vatNumber: d.supplierVat, roles: { has: "supplier" } } });
      // άγνωστος εκδότης: νέα καρτέλα προμηθευτή από τα στοιχεία του παραστατικού, για έλεγχο από τον χρήστη
      supplier ??= await tx.party.create({ data: { orgId, roles: ["supplier"], name: d.supplierName, vatNumber: d.supplierVat } });
      const doc = await tx.purchaseDoc.create({
        data: {
          orgId, supplierId: supplier.id, warehouseId: warehouse.id, number: d.number, issuedAt: d.issuedAt, mydataMark: d.mark,
          // 5.1/5.2: πιστωτικό του προμηθευτή, όχι νέα αγορά· δένεται με το τιμολόγιο στην καρτέλα του (lib/purchase-returns.ts)
          kind: isCredit(d.type) ? "CREDIT" : "INVOICE", mydataType: d.type, relatedMark: d.relatedMark,
          source: "mydata", note: isCredit(d.type) ? "Πιστωτικό από myDATA — σύνδεσέ το με το τιμολόγιο που αφορά" : "Από myDATA (RequestMyIncome) — έλεγχος πριν από την αποδοχή",
          supplierSnapshot: partySnapshot(supplier), buyerSnapshot: partySnapshot({ ...buyer, name: org.name, vatNumber: org.vatNumber }), createdByName: userName,
        },
      });
      const ctx = { supplierId: supplier.id, supplierItems, tradeItems, mappings };
      for (const l of d.lines) {
        const m = matchLine({ supplierCode: null, ean: null, description: l.description }, ctx);
        await tx.purchaseLine.create({
          data: {
            orgId,
            documentId: doc.id,
            description: l.description,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            discountBps: l.discountBps,
            vatRate: l.vatRate,
            supplierItemId: m.supplierItemId ?? null,
            tradeItemId: m.tradeItemId ?? null,
            genericItemId: m.genericItemId ?? null,
            matchNote: m.matchNote ?? (m.suggestion ? `suggest:${m.suggestion.tradeItemId}` : null),
          },
        });
      }
    });
    created++;
  }
  return { created, skipped };
}
