// Πωλήσεις ταμείου που έμειναν «σε αναμονή πληρωμής» (η εφαρμογή έκλεισε, χάθηκε το δίκτυο, κανείς δεν ρώτησε).
// Ο χρονοδιακόπτης ρωτά τη Viva με τη συνεδρία της πώλησης, με τους ίδιους κανόνες όπως το GET /api/pos/sales/[id]/result:
// πληρώθηκε → απόδειξη, η Viva λέει «απέτυχε» → πρόχειρο. Χωρίς απάντηση της Viva δεν αλλάζει τίποτα· ποτέ νέα χρέωση.
// shortcut: μόνο πωλήσεις· τα μερίδια λογαριασμού (BillShare) τα λύνει ακόμα μόνο η συσκευή, όταν χρειαστεί προσθήκη εδώ.
import { db } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { completeSale, failSale } from "./pos";
import { syncBrowserPayment } from "./viva/browser-payment";
import type { SessionLoader } from "./viva/cloud-terminal";

export const STALE_SALE_MS = 3 * 60_000; // η συσκευή ρωτά μόνη της τα πρώτα λεπτά

export async function resolveStaleSales(now = new Date(), loadSession?: SessionLoader) {
  const stale = await db.sale.findMany({
    where: { status: "AWAITING_PAYMENT", issuedAt: { lt: new Date(now.getTime() - STALE_SALE_MS) }, device: { vivaTerminalId: { not: null } } },
    select: {
      id: true, orgId: true, storeId: true, deviceId: true, totalCents: true,
      payment: { select: { amountCents: true, vivaSessionId: true } }, shares: { select: { amountCents: true } },
      device: { select: { vivaTerminalId: true } },
    },
    orderBy: { issuedAt: "asc" }, take: 100,
  });
  const result = { checked: stale.length, completed: 0, failed: 0, unknown: 0 };
  for (const s of stale) {
    const sale = { ...s, status: "AWAITING_PAYMENT" as const, totalCents: s.totalCents - s.shares.reduce((t, x) => t + x.amountCents, 0) };
    const r = await syncBrowserPayment(sale, { orgId: s.orgId, storeId: s.storeId, deviceId: s.deviceId, terminalId: s.device.vivaTerminalId }, {
      complete: (raw: Prisma.InputJsonObject, transactionId?: string) => completeSale(s.deviceId, s.id, raw, transactionId, s.orgId),
      fail: (reason: string, raw: Prisma.InputJsonObject) => failSale(s.deviceId, s.id, reason, raw, s.orgId),
    }, loadSession);
    if (r.status === "completed") result.completed++;
    else if (r.status === "failed") result.failed++;
    else result.unknown++;
  }
  return result;
}
