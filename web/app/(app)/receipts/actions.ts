"use server";

import { flashFail, flashOk } from "@/lib/flash-server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { refundSale, syncCredit } from "@/lib/pos-refund";

/**
 * Πιστωτικό λιανικής (11.4) για την απόδειξη: πλήρης επιστροφή, συσχετιζόμενη πάντα.
 * Με κλειδιά Viva η επιστροφή στέλνεται στο τερματικό· αλλιώς μένει δοκιμαστική (NOT_SENT).
 */
export async function issueCreditNote(saleId: string) {
  const { org } = await currentOrg("receipts.reissue");
  const r = await refundSale(org.id, z.string().cuid().parse(saleId));
  if (!r.ok) throw new Error(r.message);
  revalidatePath(`/receipts/${saleId}`);
  // Άγνωστο αποτέλεσμα: η επιστροφή μπορεί να έφτασε στο τερματικό. Το πιστωτικό μένει σε αναμονή και ο χρήστης ρωτά με τον «Έλεγχο».
  if (r.unknown) { await flashFail("Δεν ξέρουμε αν η επιστροφή έφτασε στο τερματικό Viva", "Κοίταξε το τερματικό και πάτα «Έλεγχος» στο πιστωτικό. Μην εκδώσεις δεύτερο."); return; }
  await flashOk(r.live ? "Το πιστωτικό εκδόθηκε και η επιστροφή στάλθηκε στο τερματικό Viva" : "Το πιστωτικό εκδόθηκε δοκιμαστικά: δεν στάλθηκε στη Viva");
}

/** Ρωτά τη Viva για το πιστωτικό που περιμένει. Ασφαλές να κληθεί ξανά και ξανά. */
export async function syncCreditNote(documentId: string, saleId: string) {
  const { org } = await currentOrg("receipts.reissue");
  const state = await syncCredit(org.id, z.string().cuid().parse(documentId));
  revalidatePath(`/receipts/${saleId}`);
  if (state === null) await flashFail("Δεν έγινε: το πιστωτικό δεν βρέθηκε", "Ανανέωσε τη σελίδα και δοκίμασε ξανά.");
  else if (state === "pending") await flashFail("Δεν ολοκληρώθηκε ακόμα: η επιστροφή περιμένει στο τερματικό", "Δοκίμασε ξανά σε λίγο.");
  else if (state === "completed") await flashOk("Το πιστωτικό ολοκληρώθηκε");
  else await flashFail("Η επιστροφή δεν ολοκληρώθηκε στο τερματικό", "Έλεγξε το τερματικό και δοκίμασε ξανά.");
}
