// Server-only διαβίβαση χονδρικής. Ο πραγματικός πάροχος ενεργοποιείται μόνο με διαπιστευτήρια·
// το receiptReference είναι υποχρεωτικό idempotency key ώστε retry μετά από crash να μη διπλοστείλει.
import { db } from "./db";
import { assertStockScope, type StockContext } from "./stock-scope";
import { auditWorkflow, cleanText, WorkflowError } from "./workflow-db";

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
};
export type MyDataReceipt = { mark: string; uid?: string; qrUrl?: string; raw?: unknown };
export interface MyDataProvider { submit(document: MyDataSubmission): Promise<MyDataReceipt> }

export class DisabledMyDataProvider implements MyDataProvider {
  async submit(): Promise<MyDataReceipt> {
    throw new WorkflowError("Δεν έχει ρυθμιστεί πάροχος εξερχόμενης διαβίβασης myDATA· το παραστατικό παραμένει μη διαβιβασμένο");
  }
}

export async function transmitSalesDocument(ctx: StockContext, documentId: string, provider: MyDataProvider = new DisabledMyDataProvider()) {
  const prepared = await db.$transaction(async (tx) => {
    const document = await tx.salesDocument.findFirst({ where: { id: documentId, orgId: ctx.orgId }, include: { lines: true } });
    if (!document?.fiscalDocumentId) throw new WorkflowError("Το παραστατικό δεν βρέθηκε");
    await assertStockScope(tx, ctx, { storeId: document.storeId, warehouseId: document.warehouseId, forWrite: true });
    if (document.status !== "ISSUED") throw new WorkflowError("Ακυρωμένο παραστατικό δεν διαβιβάζεται");
    const fiscal = await tx.fiscalDocument.findFirstOrThrow({ where: { id: document.fiscalDocumentId, orgId: ctx.orgId } });
    if (fiscal.status === "SIGNED") return { document, fiscal, alreadySent: true };
    if (fiscal.status === "PENDING") throw new WorkflowError("Υπάρχει διαβίβαση σε εξέλιξη· περίμενε το αποτέλεσμα");
    await tx.fiscalDocument.update({ where: { id: fiscal.id }, data: { status: "PENDING", error: null } });
    return { document, fiscal, alreadySent: false };
  });
  if (prepared.alreadySent) return prepared.fiscal;
  try {
    const receipt = await provider.submit({
      idempotencyKey: prepared.fiscal.receiptReference,
      docType: prepared.document.docType, series: prepared.document.series, aa: prepared.document.aa, issuedAt: prepared.document.issuedAt,
      customer: prepared.document.customerSnapshot,
      lines: prepared.document.lines.map((line) => ({ genericItemId: line.genericItemId, lotId: line.lotId, quantityBase: line.quantityBase, unitPriceCents: line.unitPriceCents, vatRate: line.vatRate })),
      netCents: prepared.document.netCents, vatCents: prepared.document.vatCents, totalCents: prepared.document.totalCents,
    });
    const mark = cleanText(receipt.mark, "MARK", 100, true)!;
    return await db.$transaction(async (tx) => {
      const updated = await tx.fiscalDocument.update({ where: { id: prepared.fiscal.id }, data: { status: "SIGNED", error: null, response: JSON.parse(JSON.stringify({ ...receipt, mark })) } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "mydata.sent", entityType: "sales_document", entityId: prepared.document.id, storeId: prepared.document.storeId, warehouseId: prepared.document.warehouseId, metadata: { mark } });
      return updated;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Η διαβίβαση απέτυχε";
    await db.fiscalDocument.updateMany({ where: { id: prepared.fiscal.id, orgId: ctx.orgId, status: "PENDING" }, data: { status: "FAILED", error: message } });
    throw error;
  }
}
