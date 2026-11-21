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
  assert.throws(() => buildDocument({ ...base, docType: "1.1", party: { vatNumber: "123456789", name: "Πελάτης ΑΕ" } }), /δεν εκδίδεται ακόμη/);
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
