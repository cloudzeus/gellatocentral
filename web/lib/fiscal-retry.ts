// Αυτόματη επανάληψη διαβιβάσεων που απέτυχαν (π.χ. χωρίς σύνδεση με Viva/ΑΑΔΕ). Μόνο ό,τι υπογράφει ο server:
// 8.6 τραπεζιών και παραστατικά χονδρικής. Οι αποδείξεις/πιστωτικά του τερματικού τα ξαναστέλνει η ίδια η Viva.
// Ίδιο reference (sessionId) σε κάθε προσπάθεια → ίδιο MARK, άρα η επανάληψη δεν διαβιβάζει δεύτερη φορά.
import { db } from "./db";
import { issuerForStore } from "./documents/issuer";
import { transmitSalesDocument } from "./mydata-outgoing";
import { signOrderSlips } from "./order-slips";
import type { StockContext } from "./stock-scope";

import { backoffMs, MAX_ATTEMPTS, needsCorrection, RETRIED_TYPES, STALE_PENDING_MS } from "./fiscal-retry-rules";


const systemCtx = (orgId: string): StockContext => ({ orgId, membershipId: "", userId: "", userName: "Αυτόματη επανάληψη", permissions: [], storeIds: [], warehouseIds: [], can: () => true });

export async function retryFiscal(now = new Date()) {
  await db.fiscalDocument.updateMany({
    where: { docType: { in: [...RETRIED_TYPES] }, status: "PENDING", updatedAt: { lt: new Date(now.getTime() - STALE_PENDING_MS) } },
    data: { status: "FAILED", error: "Η διαβίβαση διακόπηκε πριν απαντήσει η Viva" },
  });
  const failed = await db.fiscalDocument.findMany({
    where: { orgId: { not: null }, docType: { in: [...RETRIED_TYPES] }, status: "FAILED" },
    select: { id: true, orgId: true, docType: true, updatedAt: true, error: true, series: { select: { storeId: true } } },
    orderBy: { updatedAt: "asc" }, take: 200,
  });
  const counts = await db.fiscalAttempt.groupBy({ by: ["fiscalDocumentId"], where: { fiscalDocumentId: { in: failed.map((d) => d.id) }, toStatus: "FAILED" }, _count: true });
  const failures = new Map(counts.map((c) => [c.fiscalDocumentId, c._count]));
  const result = { retried: 0, signed: 0, failed: 0, gaveUp: 0, needsCorrection: 0 };
  for (const doc of failed) {
    const n = failures.get(doc.id) ?? 1;
    if (needsCorrection(doc.error)) { result.needsCorrection++; continue; }
    if (n >= MAX_ATTEMPTS) { result.gaveUp++; continue; }
    if (now.getTime() - doc.updatedAt.getTime() < backoffMs(n)) continue;
    result.retried++;
    try {
      if (doc.docType === "8.6") {
        const issuer = await issuerForStore(doc.orgId!, doc.series?.storeId ?? null);
        await signOrderSlips(doc.orgId!, issuer.vivaMerchantId, [doc.id]);
      } else {
        const sales = await db.salesDocument.findUnique({ where: { fiscalDocumentId: doc.id }, select: { id: true } });
        if (sales) await transmitSalesDocument(systemCtx(doc.orgId!), sales.id);
      }
    } catch { /* η αποτυχία γράφτηκε στο παραστατικό και στο ημερολόγιο */ }
    const after = await db.fiscalDocument.findUnique({ where: { id: doc.id }, select: { status: true } });
    if (after?.status === "SIGNED") result.signed++; else result.failed++;
  }
  return result;
}
