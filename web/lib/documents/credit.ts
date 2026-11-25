// Έκδοση πιστωτικού στοιχείου λιανικής (11.4) για ολοκληρωμένη πώληση — συσχετιζόμενο πάντα:
// η ΑΑΔΕ θέλει το πιστωτικό δεμένο με την αρχική απόδειξη (cbPreviousReceiptReference).
// Αρίθμηση: ξεχωριστή σειρά «Π<σειρά ταμείου>» (DocumentSeries), ώστε οι ΑΑ των πιστωτικών
// να μη μπλέκονται με τους ΑΑ των αποδείξεων του ταμείου.
import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.ts";
import { tenantWriteTransaction } from "../migration-cutover.ts";
import { toVivaJson } from "../viva/fiscal.ts";
import { buildDocument } from "./build.ts";
import { getDocType } from "./registry.ts";
import { advanceSeries, lockSeries } from "./series.ts";

/**
 * Ετοιμάζει το πιστωτικό της πώλησης. Επιστρέφει null όταν η πώληση δεν πιστώνεται
 * (δεν έχει διαβιβαστεί ΑΛΠ ή έχει ήδη πιστωθεί). `live` = θα ακολουθήσει επιστροφή στη Viva·
 * αλλιώς (δοκιμαστική) το πιστωτικό μένει NOT_SENT και η σειρά προχωρά αμέσως.
 */
export async function issueCredit(input: { orgId: string; saleId: string; live: boolean }) {
  return tenantWriteTransaction(input.orgId, async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: input.saleId, orgId: input.orgId, status: "COMPLETED" },
      include: { lines: true, fiscal: true, device: true, payment: { include: { method: true } } },
    });
    if (!sale?.fiscal || sale.fiscal.status !== "SIGNED" || sale.fiscal.docType !== "11.1") return null;
    if (await tx.fiscalDocument.findFirst({ where: { orgId: input.orgId, relatedId: sale.fiscal.id } })) return null; // ήδη πιστωμένη

    const type = await getDocType("11.4");
    const org = await tx.organization.findUniqueOrThrow({ where: { id: input.orgId } });
    const code = `Π${sale.device.series ?? ""}`;
    const s = await lockSeries(tx, input.orgId, "11.4", code, sale.storeId);
    const reference = randomUUID(); // νέο σε κάθε προσπάθεια, όπως στις πωλήσεις
    const method = sale.payment?.method;
    const doc = buildDocument(
      {
        docType: "11.4",
        merchantVat: org.vatNumber,
        series: code,
        aa: s.nextAa,
        reference,
        moment: new Date(),
        payItem: method?.payItemCase != null ? { description: method.name, payItemCase: method.payItemCase } : undefined,
        relatedReference: sale.fiscal.receiptReference,
        lines: sale.lines,
      },
      type,
    );
    const fiscal = await tx.fiscalDocument.create({
      data: { orgId: input.orgId, docType: "11.4", seriesId: s.id, relatedId: sale.fiscal.id, receiptReference: reference, status: input.live ? "PENDING" : "NOT_SENT", request: JSON.parse(toVivaJson(doc.data)) },
    });
    if (!input.live) await advanceSeries(tx, s.id);
    return { documentId: fiscal.id, reference, doc, device: sale.device };
  });
}

/** Η Viva ολοκλήρωσε την επιστροφή και υπέγραψε το πιστωτικό. Μόνο η πρώτη κλήση μετράει. */
export async function completeCredit(documentId: string, raw: Prisma.InputJsonValue, orgId: string) {
  await tenantWriteTransaction(orgId, async (tx) => {
    const { count } = await tx.fiscalDocument.updateMany({ where: { id: documentId, orgId, status: "PENDING" }, data: { status: "SIGNED", response: raw } });
    if (count === 0) return;
    const d = await tx.fiscalDocument.findUniqueOrThrow({ where: { id: documentId }, select: { seriesId: true } });
    if (d.seriesId) await advanceSeries(tx, d.seriesId);
  }, { purpose: "SETTLEMENT" });
}

/** Η επιστροφή απέτυχε: το πιστωτικό μένει FAILED και ο ΑΑ ελεύθερος για την επόμενη προσπάθεια. */
export async function failCredit(documentId: string, error: string, raw: Prisma.InputJsonValue | undefined, orgId: string) {
  await tenantWriteTransaction(orgId, async (tx) => {
    await tx.fiscalDocument.updateMany({ where: { id: documentId, orgId, status: "PENDING" }, data: { status: "FAILED", error, ...(raw ? { response: raw } : {}) } });
  }, { purpose: "SETTLEMENT" });
}
