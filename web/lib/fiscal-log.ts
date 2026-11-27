// Ημερολόγιο διαβιβάσεων: ανάγνωση του FiscalAttempt (το γράφει trigger) για την οθόνη /transmissions και το CSV ελέγχου.
// shortcut: φίλτρο μόνο ανά επιχείρηση, όχι ανά κατάστημα του χρήστη· αν χρειαστεί, φίλτρο μέσω series.storeId.
import { csvCell } from "./accountant-export";
import { db } from "./db";
import { backoffMs, MAX_ATTEMPTS, needsCorrection, readableError, RETRIED_TYPES } from "./fiscal-retry-rules";
import type { FiscalStatus } from "./generated/prisma/client";

export const DOC_TYPES: Record<string, string> = {
  "11.1": "Απόδειξη", "11.4": "Πιστωτικό λιανικής", "8.6": "Δελτίο παραγγελίας", "1.1": "Τιμολόγιο", "2.1": "Τιμολόγιο παροχής", "5.1": "Πιστωτικό", "9.3": "Δελτίο αποστολής",
};
export const STATUSES: FiscalStatus[] = ["SIGNED", "PENDING", "FAILED", "NOT_SENT"];

export type LogFilter = { orgId: string; docType?: string | null; status?: FiscalStatus | null; q?: string; from?: Date; to?: Date };

const where = (f: LogFilter) => ({
  orgId: f.orgId,
  ...(f.docType ? { docType: f.docType } : {}),
  ...(f.status ? { toStatus: f.status } : {}),
  ...(f.q ? { mark: { contains: f.q } } : {}),
  ...(f.from || f.to ? { at: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
});

/** «ΔΠA2-1», «A2-15» (απόδειξη ταμείου) ή «ΤΙΜ-3»: η σειρά και ο αριθμός, όπου κι αν φυλάσσονται. */
async function labels(ids: string[]) {
  const [docs, sales] = await Promise.all([
    db.fiscalDocument.findMany({ where: { id: { in: ids } }, select: { id: true, aa: true, series: { select: { code: true } }, sale: { select: { series: true, aa: true } } } }),
    db.salesDocument.findMany({ where: { fiscalDocumentId: { in: ids } }, select: { fiscalDocumentId: true, series: true, aa: true } }), // χονδρική: ο ΑΑ γράφεται στο FiscalDocument μόνο μετά τη διαβίβαση
  ]);
  const wholesale = new Map(sales.map((s) => [s.fiscalDocumentId, s]));
  return new Map(docs.map((d) => {
    const series = d.series?.code ?? d.sale?.series ?? wholesale.get(d.id)?.series ?? "";
    const aa = d.aa ?? d.sale?.aa ?? wholesale.get(d.id)?.aa;
    return [d.id, aa != null ? `${series}-${aa}` : series || "—"];
  }));
}

export async function attemptPage(f: LogFilter, skip: number, take: number) {
  const [rows, total] = await Promise.all([
    db.fiscalAttempt.findMany({ where: where(f), orderBy: { id: "desc" }, skip, take }),
    db.fiscalAttempt.count({ where: where(f) }),
  ]);
  const names = await labels([...new Set(rows.map((r) => r.fiscalDocumentId))]);
  return { total, rows: rows.map((r) => ({ ...r, id: String(r.id), label: names.get(r.fiscalDocumentId) ?? "—", message: readableError(r.error) })) };
}

/** Η τρέχουσα εικόνα: τι στάλθηκε, τι περιμένει, τι ξαναδοκιμάζεται μόνο του και τι θέλει διόρθωση από άνθρωπο. */
export async function fiscalOverview(orgId: string, now = new Date()) {
  const day = new Date(now.getTime() - 24 * 3600_000);
  const [signed, pending, awaitingMark, failed] = await Promise.all([
    db.fiscalDocument.count({ where: { orgId, status: "SIGNED", mark: { not: null }, updatedAt: { gte: day } } }),
    db.fiscalDocument.count({ where: { orgId, status: "PENDING" } }),
    db.fiscalDocument.count({ where: { orgId, status: "SIGNED", error: { startsWith: "TRANSMISSION_FAILURE" } } }),
    // αποτυχημένες αποδείξεις/πιστωτικά τερματικού = η πληρωμή δεν έγινε, δεν εκδόθηκαν· μετρούν μόνο όσα υπογράφει ο server
    db.fiscalDocument.findMany({ where: { orgId, status: "FAILED", docType: { in: [...RETRIED_TYPES] } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, docType: true, error: true, updatedAt: true } }),
  ]);
  const counts = await db.fiscalAttempt.groupBy({ by: ["fiscalDocumentId"], where: { fiscalDocumentId: { in: failed.map((d) => d.id) }, toStatus: "FAILED" }, _count: true });
  const failures = new Map(counts.map((c) => [c.fiscalDocumentId, c._count]));
  const [names, sales] = await Promise.all([
    labels(failed.map((d) => d.id)),
    db.salesDocument.findMany({ where: { orgId, fiscalDocumentId: { in: failed.map((d) => d.id) } }, select: { id: true, fiscalDocumentId: true } }),
  ]);
  const salesOf = new Map(sales.map((s) => [s.fiscalDocumentId, s.id]));
  const attention = failed.map((d) => {
    const n = failures.get(d.id) ?? 1;
    const manual = needsCorrection(d.error) || n >= MAX_ATTEMPTS;
    return { ...d, message: readableError(d.error), label: names.get(d.id) ?? "—", attempts: n, manual, nextAt: manual ? null : new Date(d.updatedAt.getTime() + backoffMs(n)), href: salesOf.has(d.id) ? `/invoices/${salesOf.get(d.id)}` : null };
  });
  return { signed, waiting: pending + awaitingMark, retrying: attention.filter((a) => !a.manual).length, manual: attention.filter((a) => a.manual).length, attention };
}

export async function attemptsCsv(f: LogFilter) {
  const { rows } = await attemptPage(f, 0, 50_000);
  const header = ["time_utc", "doc_type", "document", "from_status", "to_status", "mark", "error", "fiscal_document_id"];
  const lines = rows.map((r) => [r.at.toISOString(), r.docType, r.label, r.fromStatus, r.toStatus, r.mark, r.error, r.fiscalDocumentId]);
  return `﻿${[header, ...lines].map((row) => row.map((v) => csvCell(v)).join(";")).join("\r\n")}\r\n`;
}
