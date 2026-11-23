import assert from "node:assert/strict";
import test from "node:test";
import { fiscalRequestDetails, summarizePartyAccount } from "./party-account.ts";

test("το υπόλοιπο περιλαμβάνει μόνο διαβιβασμένες χρεώσεις/πιστώσεις και επιτυχείς πληρωμές", () => {
  const summary = summarizePartyAccount([
    { status: "SIGNED", sign: 1, totalCents: 10_000 },
    { status: "SIGNED", sign: -1, totalCents: 2_500 },
    { status: "NOT_SENT", sign: 1, totalCents: 4_000 },
    { status: "PENDING", sign: 1, totalCents: 3_000 },
    { status: "FAILED", sign: 1, totalCents: 2_000 },
    { status: "SIGNED", sign: null, totalCents: 9_999 },
    { status: "SIGNED", sign: 1, totalCents: null },
  ], [
    { success: true, amountCents: 1_500 },
    { success: false, amountCents: 900 },
  ]);
  assert.deepEqual(summary, { chargesCents: 10_000, creditsCents: 2_500, paymentsCents: 1_500, balanceCents: 6_000 });
});

test("πληρωμή μεγαλύτερη από τη χρέωση δίνει πιστωτικό υπόλοιπο υπέρ του πελάτη", () => {
  const summary = summarizePartyAccount([{ status: "SIGNED", sign: 1, totalCents: 1_000 }], [{ success: true, amountCents: 1_200 }]);
  assert.equal(summary.balanceCents, -200);
});

test("το request δίνει αριθμό και απόλυτη αξία πιστωτικού", () => {
  assert.deepEqual(fiscalRequestDetails({
    cbReceiptAmount: -624,
    ftReceiptCaseData: { GR: { Series: "ΠΑ1", AA: 17 } },
  }), { totalCents: 624, series: "ΠΑ1", aa: 17 });
});

test("μη έγκυρα δεδομένα request δεν μετατρέπονται σε ποσό ή αρίθμηση", () => {
  assert.deepEqual(fiscalRequestDetails(null), { totalCents: null, series: null, aa: null });
  assert.deepEqual(fiscalRequestDetails({ cbReceiptAmount: "100", ftReceiptCaseData: { GR: { Series: 4, AA: 1.5 } } }), { totalCents: null, series: null, aa: null });
});
