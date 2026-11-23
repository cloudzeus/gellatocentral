// Καθαρός υπολογισμός οικονομικής καρτέλας: μόνο διαβιβασμένα παραστατικά και επιτυχείς
// πληρωμές επηρεάζουν το υπόλοιπο. Δοκιμαστικά και αποτυχημένα παραμένουν ορατά στο ιστορικό.
export type PartyAccountStatus = "NOT_SENT" | "PENDING" | "SIGNED" | "FAILED";

export type PartyAccountDocument = {
  id: string;
  type: string;
  title: string;
  sign: 1 | -1 | null;
  totalCents: number | null;
  status: PartyAccountStatus;
  at: Date;
  number: string;
  href: string | null;
  reference: string;
  error: string | null;
  origin: string;
};

export type PartyAccountPayment = {
  id: string;
  at: Date;
  amountCents: number;
  success: boolean;
  method: string;
  saleId: string;
  saleNumber: string;
  origin: string;
};

export type PartyAccountSummary = {
  chargesCents: number;
  creditsCents: number;
  paymentsCents: number;
  balanceCents: number;
};

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Αριθμός και απόλυτη αξία από το fiscalisationData· δεν δεχόμαστε κείμενο ή μη ακέραια λεπτά. */
export function fiscalRequestDetails(request: unknown) {
  const root = object(request);
  const gr = object(object(root?.ftReceiptCaseData)?.GR);
  const rawTotal = root?.cbReceiptAmount;
  const totalCents = typeof rawTotal === "number" && Number.isSafeInteger(rawTotal) ? Math.abs(rawTotal) : null;
  const rawAa = gr?.AA;
  return {
    totalCents,
    series: typeof gr?.Series === "string" ? gr.Series : null,
    aa: typeof rawAa === "number" && Number.isSafeInteger(rawAa) ? rawAa : null,
  };
}

/** Θετικό υπόλοιπο = ο πελάτης χρωστά· αρνητικό = υπάρχει πιστωτικό υπέρ του. */
export function summarizePartyAccount(
  documents: readonly Pick<PartyAccountDocument, "status" | "sign" | "totalCents">[],
  payments: readonly Pick<PartyAccountPayment, "success" | "amountCents">[],
): PartyAccountSummary {
  let chargesCents = 0;
  let creditsCents = 0;
  for (const doc of documents) {
    if (doc.status !== "SIGNED" || doc.sign === null || doc.totalCents === null) continue;
    if (doc.sign === 1) chargesCents += doc.totalCents;
    else creditsCents += doc.totalCents;
  }
  const paymentsCents = payments.reduce((sum, payment) => sum + (payment.success ? payment.amountCents : 0), 0);
  return { chargesCents, creditsCents, paymentsCents, balanceCents: chargesCents - creditsCents - paymentsCents };
}
