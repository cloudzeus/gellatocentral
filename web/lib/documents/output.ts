// Κοινό contract: RBAC/scope στο route, πραγματικό PDF εδώ, ιδιωτική αποθήκευση και ιστορικό χωρίς ψευδή αποστολή.
import { writeAudit } from "../audit";
import { db } from "../db";
import { saveFile } from "../storage/index";
import type { StockContext } from "../stock-scope";
import { scheduleCsv, scheduleIcs, scheduleShifts, scheduleXlsx } from "../schedule-export";
import { createDocumentPdf } from "./pdf";
import { DOCUMENT_CONFIG, documentFilename, type DocumentFormat, type DocumentModel, type LoadedDocument } from "./model";

async function storeGeneratedPdf(ctx: StockContext, model: DocumentModel, scope?: LoadedDocument["scope"]) {
  const bytes = await createDocumentPdf(model);
  const name = documentFilename(model, "pdf");
  const file = await saveFile({ orgId: ctx.orgId, category: DOCUMENT_CONFIG[model.entityType].category, refType: model.entityType, refId: model.entityId, name, data: bytes, userId: ctx.userId });
  await db.$transaction(async (tx) => {
    await tx.documentDelivery.create({ data: { orgId: ctx.orgId, entityType: model.entityType, entityId: model.entityId, channel: "pdf", recipient: file.id, status: "STORED", detail: "Πραγματικό PDF· ιδιωτική αποθήκευση· δεν πραγματοποιήθηκε εξωτερική αποστολή", createdByName: ctx.userName } });
    await writeAudit(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "document.pdf.generate", entityType: model.entityType, entityId: model.entityId, storeId: scope?.storeId, warehouseId: scope?.warehouseId, metadata: { fileId: file.id, size: file.size } });
  });
  return { file: { id: file.id, name: file.name, contentType: file.contentType, size: file.size, url: `/api/files/${file.id}` }, bytes };
}

export async function generateAndStorePdf(ctx: StockContext, model: DocumentModel, scope?: LoadedDocument["scope"]) {
  return (await storeGeneratedPdf(ctx, model, scope)).file;
}

/** Το ίδιο πραγματικό, ιδιωτικά αποθηκευμένο PDF γίνεται attachment χωρίς δημόσιο URL. */
export async function generatePdfAttachment(ctx: StockContext, model: DocumentModel, scope?: LoadedDocument["scope"]) {
  const stored = await storeGeneratedPdf(ctx, model, scope);
  return { filename: stored.file.name, contentType: stored.file.contentType, data: stored.bytes };
}

export function scheduleExportFromSnapshot(model: DocumentModel, snapshot: unknown, format: Exclude<DocumentFormat, "pdf">, version: number, fromAt: Date, toAt: Date) {
  const shifts = scheduleShifts(snapshot);
  if (format === "csv") return { data: scheduleCsv(shifts), contentType: "text/csv; charset=utf-8", name: documentFilename(model, "csv") };
  if (format === "ics") return { data: scheduleIcs({ publicationId: model.entityId, version, title: model.title, shifts }), contentType: "text/calendar; charset=utf-8", name: documentFilename(model, "ics") };
  return scheduleXlsx({ title: model.title, version, fromAt, toAt, shifts }).then((data) => ({ data, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: documentFilename(model, "xlsx") }));
}
