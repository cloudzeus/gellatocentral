// Επιστροφή χρημάτων για απόδειξη: πιστωτικό 11.4 + επιστροφή στο τερματικό Viva του ταμείου που την έκοψε.
// Κοινό για την κονσόλα (σελίδα απόδειξης) και την εφαρμογή ταμείου (οθόνη Συναλλαγές).
import type { Prisma } from "./generated/prisma/client";
import { db } from "./db";
import { completeCredit, failCredit, issueCredit } from "./documents/credit";
import { abortSession, cardTransactionStatus, getSession, startRefund, vivaConfigured, VivaUnknownOutcomeError } from "./viva/cloud-terminal";
import { toVivaJson } from "./viva/fiscal";
import { signReceipt } from "./viva/sign";

export type RefundStart =
  | { ok: true; creditId: string; amountCents: number; live: boolean; unknown?: boolean; signed?: boolean; alreadyReturned?: boolean }
  | { ok: false; code: "not_refundable" | "no_terminal" | "terminal_unavailable"; message: string };

export async function refundSale(orgId: string, saleId: string): Promise<RefundStart> {
  const live = await vivaConfigured();
  const credit = await issueCredit({ orgId, saleId, live });
  if (!credit) return { ok: false, code: "not_refundable", message: "Η απόδειξη δεν μπορεί να πιστωθεί: δεν έχει σταλεί ή έχει ήδη πιστωθεί" };
  const started = { ok: true as const, creditId: credit.documentId, amountCents: Math.abs(credit.doc.totalCents), live };
  if (!live) return started;
  // Μετρητά: δεν υπάρχει συναλλαγή κάρτας να επιστραφεί (η Viva θέλει orderCode > 0). Τα χρήματα βγαίνουν από το συρτάρι.
  // Κάρτα ήδη ακυρωμένη στη Viva (π.χ. από το site της, statusId "X"): τα χρήματα γύρισαν ήδη, η απόδειξη όμως μένει
  // στην ΑΑΔΕ. Και στα δύο το 11.4 υπογράφεται απευθείας (receipts:sign), όπως τα 8.6, χωρίς κίνηση χρημάτων στο τερματικό.
  // shortcut: σε timeout το πιστωτικό γίνεται FAILED ενώ μπορεί να υπογράφηκε· ο επόμενος ΑΑ το δείχνει στην ΑΑΔΕ, θέλει έλεγχο με το ημερολόγιο
  const alreadyReturned = !!credit.cardTransactionId && !!credit.merchantId && (await cardTransactionStatus(credit.cardTransactionId, credit.merchantId).catch(() => null)) === "X";
  if (!credit.cardTransactionId || alreadyReturned) {
    if (!credit.merchantId) {
      await failCredit(credit.documentId, "Λείπει ο κωδικός εμπόρου Viva της επιχείρησης", undefined, orgId);
      return { ok: false, code: "no_terminal", message: "Λείπει ο κωδικός εμπόρου Viva της επιχείρησης" };
    }
    try {
      const signed = await signReceipt(toVivaJson({ sessionId: credit.reference, ...(credit.doc.data as object) }), credit.merchantId);
      await completeCredit(credit.documentId, signed.raw as Prisma.InputJsonValue, orgId);
      return { ...started, signed: true, alreadyReturned };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await failCredit(credit.documentId, message, undefined, orgId);
      return { ok: false, code: "terminal_unavailable", message: "Το πιστωτικό δεν υπογράφηκε στη Viva. Δοκίμασε ξανά σε λίγο" };
    }
  }
  if (!credit.device.vivaTerminalId || !credit.merchantId) {
    const message = "Λείπει το τερματικό Viva του ταμείου ή ο κωδικός εμπόρου της επιχείρησης";
    await failCredit(credit.documentId, message, undefined, orgId);
    return { ok: false, code: "no_terminal", message };
  }
  try {
    await startRefund({
      sessionId: credit.reference,
      parentSessionId: credit.parentReference,
      terminalId: credit.device.vivaTerminalId,
      cashRegisterId: credit.device.id,
      amountCents: credit.doc.totalCents,
      merchantReference: credit.documentId,
      terminalMerchantId: credit.merchantId,
      fiscalisationData: credit.doc.data,
    });
    return started;
  } catch (e) {
    // Άγνωστο αποτέλεσμα: η επιστροφή μπορεί να έφτασε. Το πιστωτικό μένει σε αναμονή (άρα δεν εκδίδεται δεύτερο)
    // και ρωτάμε τη Viva· αλλιώς ο πελάτης θα έπαιρνε τα χρήματα δύο φορές.
    if (e instanceof VivaUnknownOutcomeError) return { ...started, unknown: true };
    const message = e instanceof Error ? e.message : String(e);
    console.error("refund → POS:", message);
    await failCredit(credit.documentId, message, undefined, orgId);
    return { ok: false, code: "terminal_unavailable", message: "Η επιστροφή δεν έφτασε στο POS. Έλεγξε ότι το Viva.com Terminal είναι ανοιχτό και δοκίμασε ξανά" };
  }
}

export type CreditState = "completed" | "pending" | "failed";

/** deviceId: από το ταμείο, μόνο πιστωτικά για αποδείξεις του ίδιου ταμείου. */
const pendingCredit = (orgId: string, documentId: string, deviceId?: string) =>
  db.fiscalDocument.findFirst({ where: { id: documentId, orgId, docType: "11.4", ...(deviceId ? { related: { sale: { deviceId } } } : {}) }, select: { id: true, status: true, receiptReference: true } });

const settled = (status: string): CreditState | null =>
  status === "SIGNED" || status === "NOT_SENT" ? "completed" : status === "PENDING" ? null : "failed";

/** Ρωτά τη Viva για πιστωτικό που περιμένει. Ασφαλές να κληθεί ξανά και ξανά. */
export async function syncCredit(orgId: string, documentId: string, deviceId?: string): Promise<CreditState | null> {
  const doc = await pendingCredit(orgId, documentId, deviceId);
  if (!doc) return null;
  const done = settled(doc.status);
  if (done) return done;
  const session = await getSession(doc.receiptReference);
  if (!session) return "pending"; // ακόμα στο τερματικό
  if (session.success === true) { await completeCredit(doc.id, session as Prisma.InputJsonObject, orgId); return "completed"; }
  // 1008 = η πληρωμή με κάρτα έχει ήδη ακυρωθεί ή επιστραφεί στο τερματικό, εκτός ταμείου
  const why = session.eventId === 1008 ? "η πληρωμή με κάρτα έχει ήδη ακυρωθεί ή επιστραφεί στο τερματικό Viva" : session.eventId === 1003 ? "το τερματικό δεν είδε κάρτα εγκαίρως" : `eventId ${String(session.eventId)}`;
  await failCredit(doc.id, `Η επιστροφή δεν ολοκληρώθηκε: ${why}`, session as Prisma.InputJsonObject, orgId);
  return "failed";
}

/**
 * «Ακύρωση» όσο η επιστροφή περιμένει στο POS: σταματά το τερματικό. Αν η Viva λέει ότι πέρασε, μετράει η Viva.
 * "pending" = η ακύρωση ζητήθηκε αλλά το τερματικό δεν απάντησε ακόμα· ο καλών ρωτά ξανά με το syncCredit.
 */
export async function cancelCredit(orgId: string, documentId: string, cashRegisterId: string): Promise<CreditState | null> {
  const doc = await pendingCredit(orgId, documentId, cashRegisterId);
  if (!doc) return null;
  const done = settled(doc.status);
  if (done) return done;
  if ((await abortSession(doc.receiptReference, cashRegisterId)) === "not_found") {
    await failCredit(doc.id, "Η επιστροφή ακυρώθηκε πριν φτάσει στο POS", undefined, orgId);
    return "failed";
  }
  return syncCredit(orgId, documentId);
}
