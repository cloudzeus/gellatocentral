// Server-only διαβίβαση χονδρικής. Ο πραγματικός πάροχος ενεργοποιείται μόνο με διαπιστευτήρια·
// το receiptReference είναι τοπικό idempotency key και δεν αποστέλλεται ως μη τεκμηριωμένο header ΑΑΔΕ.
import { db } from "./db.ts";
import { createAadeMyDataProvider } from "./mydata-aade.ts";
import type { Dispatch } from "./documents/build.ts";
import { issuerForStore } from "./documents/issuer.ts";
import { VivaMyDataProvider } from "./mydata-viva.ts";
import { assertStockScope, type StockContext } from "./stock-scope.ts";
import { auditWorkflow, cleanText, WorkflowError } from "./workflow-db.ts";

export { DisabledMyDataProvider } from "./mydata-aade.ts";

export type MyDataSubmission = {
  idempotencyKey: string;
  docType: string;
  series: string;
  aa: number;
  issuedAt: Date;
  customer: unknown;
  lines: { genericItemId: string; lotId: string | null; quantityBase: number; unitPriceCents: number; vatRate: number }[];
  netCents: number;
  vatCents: number;
  totalCents: number;
  relatedMark?: string;
  dispatch?: Dispatch; // 9.3: στοιχεία διακίνησης (ο πάροχος Viva τα στέλνει, ο πάροχος ΑΑΔΕ δεν υποστηρίζει 9.3)
};
export type MyDataReceipt = { mark: string; uid?: string; qrUrl?: string; raw?: unknown };
export interface MyDataProvider { submit(document: MyDataSubmission): Promise<MyDataReceipt> }

function relatedMark(response: unknown): string | undefined {
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  const mark = (response as { mark?: unknown }).mark;
  return typeof mark === "string" ? mark : undefined;
}

export async function transmitSalesDocument(ctx: StockContext, documentId: string, provider?: MyDataProvider) {
  const prepared = await db.$transaction(async (tx) => {
    const document = await tx.salesDocument.findFirst({ where: { id: documentId, orgId: ctx.orgId }, include: { lines: true } });
    if (!document?.fiscalDocumentId) throw new WorkflowError("Το παραστατικό δεν βρέθηκε");
    await assertStockScope(tx, ctx, { storeId: document.storeId, warehouseId: document.warehouseId, forWrite: true });
    if (document.status !== "ISSUED") throw new WorkflowError("Ακυρωμένο παραστατικό δεν διαβιβάζεται");
    const fiscal = await tx.fiscalDocument.findFirstOrThrow({ where: { id: document.fiscalDocumentId, orgId: ctx.orgId } });
    if (fiscal.status === "SIGNED") return { document, fiscal, alreadySent: true, relatedMark: undefined };
    // Μόνο μία concurrent κλήση κερδίζει το conditional claim, ακόμη κι αν και οι δύο είδαν FAILED.
    const claimed = await tx.fiscalDocument.updateMany({
      where: { id: fiscal.id, orgId: ctx.orgId, status: { in: ["NOT_SENT", "FAILED"] } },
      data: { status: "PENDING", error: null },
    });
    if (claimed.count !== 1) {
      const current = await tx.fiscalDocument.findFirst({ where: { id: fiscal.id, orgId: ctx.orgId } });
      if (current?.status === "SIGNED") return { document, fiscal: current, alreadySent: true, relatedMark: undefined };
      throw new WorkflowError("Υπάρχει διαβίβαση σε εξέλιξη· περίμενε το αποτέλεσμα");
    }
    let correlation: string | undefined;
    if (document.docType === "5.1" && fiscal.relatedId) {
      const related = await tx.fiscalDocument.findFirst({ where: { id: fiscal.relatedId, orgId: ctx.orgId }, select: { response: true } });
      correlation = relatedMark(related?.response);
    }
    return { document, fiscal, alreadySent: false, relatedMark: correlation };
  });
  if (prepared.alreadySent) return prepared.fiscal;
  try {
    const issuer = await issuerForStore(ctx.orgId, prepared.document.storeId);
    const selectedProvider = provider ?? await createMyDataProvider(ctx.orgId, issuer);
    const customer = (prepared.document.customerSnapshot ?? {}) as { address?: unknown; city?: unknown; postalCode?: unknown };
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    const receipt = await selectedProvider.submit({
      idempotencyKey: prepared.fiscal.receiptReference,
      docType: prepared.document.docType, series: prepared.document.series, aa: prepared.document.aa, issuedAt: prepared.document.issuedAt,
      customer: prepared.document.customerSnapshot,
      lines: prepared.document.lines.map((line) => ({ genericItemId: line.genericItemId, lotId: line.lotId, quantityBase: line.quantityBase, unitPriceCents: line.unitPriceCents, vatRate: line.vatRate })),
      netCents: prepared.document.netCents, vatCents: prepared.document.vatCents, totalCents: prepared.document.totalCents,
      relatedMark: prepared.relatedMark,
      // 9.3: φόρτωση από το κατάστημα, παράδοση στη διεύθυνση του πελάτη· shortcut: σκοπός πάντα «Πώληση», όχι όχημα, μέχρι να μπουν στη φόρμα παράδοσης
      dispatch: prepared.document.docType === "9.3" ? { moment: prepared.document.issuedAt, movePurpose: 1, loading: issuer.storeAddress ?? { street: issuer.address ?? "", city: issuer.city ?? "", postalCode: issuer.postalCode ?? "" }, delivery: { street: text(customer.address), city: text(customer.city), postalCode: text(customer.postalCode) } } : undefined,
    });
    const mark = cleanText(receipt.mark, "MARK", 100, true)!;
    return await db.$transaction(async (tx) => {
      const updated = await tx.fiscalDocument.update({ where: { id: prepared.fiscal.id, orgId: ctx.orgId }, data: { status: "SIGNED", error: null, mark, aa: prepared.document.aa, totalCents: prepared.document.totalCents, response: JSON.parse(JSON.stringify({ ...receipt, mark })) } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "mydata.sent", entityType: "sales_document", entityId: prepared.document.id, storeId: prepared.document.storeId, warehouseId: prepared.document.warehouseId, metadata: { mark } });
      return updated;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Η διαβίβαση απέτυχε";
    await db.fiscalDocument.updateMany({ where: { id: prepared.fiscal.id, orgId: ctx.orgId, status: "PENDING" }, data: { status: "FAILED", error: message } });
    throw error;
  }
}

/** Πάροχος διαβίβασης για τον εκδότη: η Viva όταν ο ΑΦΜ έχει έμπορο Viva, αλλιώς απευθείας ΑΑΔΕ (ή ανενεργός χωρίς κλειδιά). */
export async function createMyDataProvider(orgId: string, issuer: Awaited<ReturnType<typeof issuerForStore>>): Promise<MyDataProvider> {
  if (!issuer.vivaMerchantId) return createAadeMyDataProvider(orgId, {}, issuer);
  return new VivaMyDataProvider({ orgId, issuerVat: issuer.vatNumber, merchantId: issuer.vivaMerchantId }, async (ids) => {
    const items = await db.genericItem.findMany({ where: { orgId, id: { in: [...ids] } }, select: { id: true, name: true, nature: true, baseUnit: { select: { dimension: true } } } });
    return new Map(items.map((i) => [i.id, { name: i.name, nature: i.nature, dimension: i.baseUnit.dimension }]));
  });
}
