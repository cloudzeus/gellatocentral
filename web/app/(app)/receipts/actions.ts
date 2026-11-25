"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { completeCredit, failCredit, issueCredit } from "@/lib/documents/credit";
import { getSession, startRefund, vivaConfigured } from "@/lib/viva/cloud-terminal";

/**
 * Πιστωτικό λιανικής (11.4) για την απόδειξη: πλήρης επιστροφή, συσχετιζόμενη πάντα.
 * Με κλειδιά Viva η επιστροφή στέλνεται στο τερματικό· αλλιώς μένει δοκιμαστική (NOT_SENT).
 */
export async function issueCreditNote(saleId: string) {
  const { org } = await currentOrg("receipts.reissue");
  const live = await vivaConfigured();
  const credit = await issueCredit({ orgId: org.id, saleId: z.string().cuid().parse(saleId), live });
  if (!credit) throw new Error("Η απόδειξη δεν μπορεί να πιστωθεί: δεν έχει σταλεί ή έχει ήδη πιστωθεί.");
  if (live) {
    try {
      if (!credit.device.vivaTerminalId || !org.vivaMerchantId) throw new Error("Λείπει το τερματικό Viva του ταμείου ή ο κωδικός εμπόρου της επιχείρησης.");
      await startRefund({
        sessionId: credit.reference,
        terminalId: credit.device.vivaTerminalId,
        cashRegisterId: credit.device.id,
        amountCents: credit.doc.totalCents,
        merchantReference: credit.documentId,
        terminalMerchantId: org.vivaMerchantId,
        fiscalisationData: credit.doc.data,
      });
    } catch (e) {
      await failCredit(credit.documentId, e instanceof Error ? e.message : String(e), undefined, org.id);
      throw e;
    }
  }
  revalidatePath(`/receipts/${saleId}`);
}

/** Ρωτά τη Viva για το πιστωτικό που περιμένει. Ασφαλές να κληθεί ξανά και ξανά. */
export async function syncCreditNote(documentId: string, saleId: string) {
  const { org } = await currentOrg("receipts.reissue");
  const doc = await db.fiscalDocument.findFirst({ where: { id: z.string().cuid().parse(documentId), orgId: org.id, status: "PENDING" } });
  if (!doc) return;
  const session = await getSession(doc.receiptReference);
  if (!session) return; // ακόμα στο τερματικό
  const raw = session as Prisma.InputJsonObject;
  if (session.success === true) await completeCredit(doc.id, raw, org.id);
  else await failCredit(doc.id, `Η επιστροφή δεν ολοκληρώθηκε (eventId ${String(session.eventId)})`, raw, org.id);
  revalidatePath(`/receipts/${saleId}`);
}
