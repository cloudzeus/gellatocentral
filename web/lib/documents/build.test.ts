// Tests του ενιαίου builder παραστατικών (lib/documents/build.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocument } from "./build.ts";
import { buildReceipt } from "../viva/fiscal.ts";

const base = {
  merchantVat: "099565360",
  series: "AB",
  aa: 7,
  reference: "ref-1",
  moment: new Date("2026-11-20T10:00:00.000Z"),
  payItem: { description: "Μετρητά", payItemCase: 1 },
  lines: [
    { name: "Παγωτό", quantity: 2, unitPriceCents: 250, vatRate: 24 },
    { name: "Χυμός", quantity: 1, unitPriceCents: 124, vatRate: 13 },
  ],
};

test("11.1: το buildDocument παράγει ακριβώς το ίδιο αποτέλεσμα με το buildReceipt του POS", () => {
  const fromReceipt = buildReceipt(base);
  const fromDocument = buildDocument({ ...base, docType: "11.1" });
  assert.deepEqual(fromDocument, fromReceipt);
});

test("11.4 πιστωτικό λιανικής: αρνητικά ποσά, συσχέτιση με το αρχικό και τύπος στο mydataoverride", () => {
  const { totalCents, data } = buildDocument({ ...base, docType: "11.4", relatedReference: "orig-receipt" });
  assert.equal(totalCents, -(2 * 250 + 124));
  assert.equal(data.cbReceiptAmount, totalCents);
  assert.equal(data.cbPreviousReceiptReference, "orig-receipt");
  assert.equal(data.cbChargeItems[0].amount, -500);
  assert.equal(data.cbChargeItems[0].vatAmount, -Math.round((500 * 24) / 124));
  assert.equal(data.cbPayItems[0].amount, totalCents);
  const gr = data.ftReceiptCaseData.GR as unknown as { HashPayload: string; mydataoverride: { invoice: { invoiceHeader: { invoiceType: string } } } };
  assert.equal(gr.mydataoverride.invoice.invoiceHeader.invoiceType, "11.4");
  assert.ok(gr.HashPayload.endsWith("-6.24"), gr.HashPayload); // hashAmount με πρόσημο
});

test("11.4 χωρίς αρχικό παραστατικό απορρίπτεται (συσχετιζόμενο)", () => {
  assert.throws(() => buildDocument({ ...base, docType: "11.4" }), /συσχετιζόμενος/);
});

test("τύπος χωρίς επαληθευμένο δείγμα Viva (receiptCase null) δεν εκδίδεται", () => {
  assert.throws(() => buildDocument({ ...base, docType: "5.2", party: { vatNumber: "123456789", name: "Πελάτης ΑΕ" } }), /δεν εκδίδεται ακόμη/);
});

test("άγνωστος τύπος απορρίπτεται", () => {
  assert.throws(() => buildDocument({ ...base, docType: "4.1" }), RangeError);
});

test("11.1: τα δεδομένα πελάτη μπαίνουν όταν δίνονται (απλοποιημένο με ΑΦΜ)", () => {
  const { data } = buildDocument({ ...base, docType: "11.1", party: { vatNumber: "123456789", name: "Πελάτης ΑΕ", street: "Πανεπιστημίου 1", city: "Αθήνα", zip: "10679" } });
  const c = data.cbCustomer as { customerVATId: string; customerCountry: string };
  assert.equal(c.customerVATId, "123456789");
  assert.equal(c.customerCountry, "GR");
});

const party = { vatNumber: "801946016", name: "Πελάτης ΑΕ", street: "Οδός 1", zip: "10431", city: "Αθήνα" };

test("2.1 συνδρομή: ftReceiptCase και γραμμή υπηρεσίας όπως στο επαληθευμένο demo, κάρτα με transactionId", () => {
  const { data, totalCents } = buildDocument({ ...base, docType: "2.1", party, payItem: { description: "Κάρτα", payItemCase: 0x02, transactionId: "a9a4835d-9097-4f5d-b66a-0c60c1008a4f" },
    lines: [{ name: "Συνδρομή", quantity: 1, unitPriceCents: 100, vatRate: 24, nature: "SERVICE" }] });
  assert.equal(totalCents, 100);
  assert.equal(data.ftReceiptCase, 5139205309155774466n);
  assert.equal(data.cbChargeItems[0].ftChargeItemCase, 5139205309155246115n); // …0023
  assert.equal(data.cbPayItems[0].ftPayItemCase, 5139205309155246082n);
  assert.equal((data.cbPayItems[0] as { transactionId?: string }).transactionId, "a9a4835d-9097-4f5d-b66a-0c60c1008a4f");
  const gr = data.ftReceiptCaseData.GR as unknown as { mydataoverride: { invoice: { invoiceHeader: { invoiceType: string } } } };
  assert.equal(gr.mydataoverride.invoice.invoiceHeader.invoiceType, "2.1");
});

test("5.1 με MARK: αρνητικές ποσότητες και ποσά, σημαία επιστροφής, correlatedInvoices όπως στο δείγμα", () => {
  const { data } = buildDocument({ ...base, docType: "5.1", party, relatedMark: "400001962591055", lines: [{ name: "Couch", quantity: 1, unitPriceCents: 1240, vatRate: 24 }] });
  assert.equal(data.ftReceiptCase, 5139205309172551682n);
  assert.equal(data.cbChargeItems[0].quantity, -100);
  assert.equal(data.cbChargeItems[0].amount, -1240);
  assert.equal(data.cbChargeItems[0].vatAmount, -240);
  assert.equal(data.cbChargeItems[0].ftChargeItemCase, 5139205309155377171n);
  const gr = data.ftReceiptCaseData.GR as unknown as { HashPayload: string; mydataoverride: { invoice: { invoiceHeader: { correlatedInvoices: bigint[] } } } };
  assert.deepEqual(gr.mydataoverride.invoice.invoiceHeader.correlatedInvoices, [400001962591055n]);
  assert.ok(gr.HashPayload.endsWith("--12.4"), gr.HashPayload);
  assert.throws(() => buildDocument({ ...base, docType: "5.1", party, relatedMark: "abc", lines: base.lines }), /MARK/);
});

test("9.3 δελτίο αποστολής: μηδενική αξία, γραμμές V=8 με ακριβή ποσότητα και στοιχεία διακίνησης", () => {
  const where = { street: "Παπαδιαμάντη 24", postalCode: "56429", city: "Θεσσαλονίκη" };
  const { data, totalCents } = buildDocument({ ...base, docType: "9.3", party, payItem: undefined,
    dispatch: { moment: new Date("2026-01-28T16:11:06Z"), movePurpose: 8, vehicleNumber: "NBX8311", loading: where, delivery: where },
    lines: [{ name: "Παγωτό βανίλια", quantity: 2.233, unitPriceCents: 0, vatRate: 13, amountCents: 0, measurementUnit: 2 }] });
  assert.equal(totalCents, 0);
  assert.equal(data.ftReceiptCase, 5139205309222879237n);
  assert.deepEqual(data.cbPayItems, []);
  const line = data.cbChargeItems[0] as unknown as { amount: number; vatRate: number; ftChargeItemCase: bigint; quantity: number; ftChargeItemCaseData: { GR: { mydataoverride: { invoiceDetails: { quantity: number; measurementUnit: number } } } } };
  assert.equal(line.amount, 0);
  assert.equal(line.vatRate, 0);
  assert.equal(line.quantity, 223);
  assert.equal(line.ftChargeItemCase, 5139205309155246088n);
  assert.deepEqual(line.ftChargeItemCaseData.GR.mydataoverride.invoiceDetails, { quantity: 2.233, measurementUnit: 2 });
  const gr = data.ftReceiptCaseData.GR as unknown as { HashPayload: string; mydataoverride: { invoice: { invoiceHeader: Record<string, unknown> } } };
  assert.ok(gr.HashPayload.endsWith("-0.0"), gr.HashPayload);
  assert.equal(gr.mydataoverride.invoice.invoiceHeader.movePurpose, 8);
  assert.equal(gr.mydataoverride.invoice.invoiceHeader.invoiceType, undefined);
  assert.throws(() => buildDocument({ ...base, docType: "9.3", party, lines: base.lines }), /διακίνησης/);
});

test("1.1 χονδρικής: δεκαδική ποσότητα σε κιλά με έτοιμο σύνολο, προϊόν δικής παραγωγής, επί πιστώσει", () => {
  const { data, totalCents } = buildDocument({ ...base, docType: "1.1", party, payItem: { description: "Επί πιστώσει", payItemCase: 0x09 },
    lines: [{ name: "Παγωτό σοκολάτα", quantity: 4.5, unitPriceCents: 0, vatRate: 13, amountCents: 5085, nature: "PRODUCT", measurementUnit: 2 }] });
  assert.equal(totalCents, 5085);
  assert.equal(data.cbChargeItems[0].quantity, 450);
  assert.equal(data.cbChargeItems[0].ftChargeItemCase, 5139205309155246161n); // …0051
  assert.equal(data.cbPayItems[0].ftPayItemCase, 5139205309155246089n);
  assert.throws(() => buildDocument({ ...base, docType: "1.1", party, lines: [{ name: "x", quantity: 1.5, unitPriceCents: 100, vatRate: 24 }] }), /ποσότητα/);
});
