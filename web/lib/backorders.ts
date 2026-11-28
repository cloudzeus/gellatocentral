// Μερικές παραλαβές παραγγελίας: τι λείπει ανά γραμμή, πότε ολοκληρώνεται και πόσο αξίζουν όσα κλείνουμε με πιστωτικό.
// Καθαρές συναρτήσεις, χωρίς βάση, για να ελέγχονται με node --test.
import { calculatePurchaseDocument } from "./purchase-document.ts";

export type OrderLineQty = { orderedBaseQty: number; receivedBaseQty: number; closedBaseQty: number };
export type OrderLinePrice = { unitPriceCents: number; discountBps: number; vatRate: number };

/** Όσα δεν έχουν έρθει ούτε έχουν κλείσει: αυτά περιμένουμε ή αποφασίζουμε τι θα γίνουν. */
export const missingQty = (l: OrderLineQty) => Math.max(0, l.orderedBaseQty - l.receivedBaseQty - l.closedBaseQty);

/** Η κατάσταση της παραγγελίας από τις γραμμές της: ολοκληρώνεται όταν ήρθαν + κλείστηκαν = παραγγελία. */
export function orderStatus(lines: readonly OrderLineQty[]): "SENT" | "PARTIAL" | "RECEIVED" {
  if (lines.every((l) => missingQty(l) === 0)) return "RECEIVED";
  return lines.every((l) => l.receivedBaseQty === 0 && l.closedBaseQty === 0) ? "SENT" : "PARTIAL";
}

/**
 * Τελική αξία (με ΦΠΑ) μιας ποσότητας της γραμμής, γραμμένη όπως ακριβώς τη χρεώνει το τιμολόγιο της παραγγελίας:
 * μία γραμμή με συνολικό ποσό σε λεπτά για όλη την ποσότητα.
 */
export function lineValueCents(quantityBase: number, price: OrderLinePrice, costScale: number) {
  if (quantityBase <= 0) return 0;
  return calculatePurchaseDocument([{ quantity: 1, unitPriceCents: Math.round(quantityBase * price.unitPriceCents / costScale), discountBps: price.discountBps, vatRate: price.vatRate }]).totalCents;
}

/** Πόση αξία από το αίτημα πιστωτικού δεν έχει έρθει ακόμα με 5.1. */
export const creditAwaitedCents = (requested: number, credited: number) => Math.max(0, requested - credited);
