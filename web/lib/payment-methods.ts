// Τρόποι πληρωμής (PaymentMethod): κοινή λίστα της πλατφόρμας — όχι ανά επιχείρηση.
// Προεπιλογή: όσους υποστηρίζει η Viva· ο διαχειριστής προσθέτει άλλους από την κονσόλα (/platform/payment-methods).
import { cache } from "react";
import { db } from "./db";

const orderBy = [{ sort: "asc" as const }, { name: "asc" as const }];

/** Ενεργοί τρόποι πληρωμής (φόρμες συναλλασσομένων, αναφορές). */
export const paymentMethods = cache(() => db.paymentMethod.findMany({ where: { active: true }, orderBy }));

/** Όσοι εμφανίζονται ως κουμπιά πληρωμής στο ταμείο. */
export const posPaymentMethods = cache(() => db.paymentMethod.findMany({ where: { active: true, posEnabled: true }, orderBy }));

/** Ένας τρόπος με το id του, μόνο αν είναι ενεργός. */
export const activePaymentMethod = cache((id: string) => db.paymentMethod.findFirst({ where: { id, active: true } }));

export const PAYMENT_PROVIDER_LABEL = {
  VIVA_TERMINAL: "Viva τερματικό",
  VIVA_CHECKOUT: "Viva Smart Checkout",
  MANUAL: "Χειροκίνητος",
} as const;

export const PAYMENT_LEDGER_LABEL = {
  CASH: "Ταμείο",
  CARD_CLEARING: "Διακανονισμός καρτών",
  BANK: "Τράπεζα",
  CREDIT: "Απαίτηση (πίστωση)",
} as const;
