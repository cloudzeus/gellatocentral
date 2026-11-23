// Δοκιμές των καθαρών συναρτήσεων του OCR: ανάλυση της απάντησης του μοντέλου και χρέωση.
import assert from "node:assert/strict";
import test from "node:test";
import { chargeCents, parseInvoiceJson } from "./ocr.ts";

test("καθαρό JSON με όλα τα πεδία", () => {
  const inv = parseInvoiceJson(JSON.stringify({
    number: "ΤΔΑ-1234", issuedAt: "2026-11-18", vatNumber: "094123456", mydataMark: "400001234567890",
    paymentMethod: "Επί πιστώσει", shippingCost: 3.5, expensesVatRate: 24,
    lines: [{ description: "ΓΑΛΑ ΕΒΟΛ 3,5% 1L x12", quantity: 4, unitPrice: 12.4, discountPercent: 12.5, vatRate: 13, supplierCode: "GAL-01", ean: "5201234567890", batchNumber: "L2611", expiresAt: "2026-12-20" }],
  }));
  assert.equal(inv.number, "ΤΔΑ-1234");
  assert.equal(inv.issuedAt?.toISOString().slice(0, 10), "2026-11-18");
  assert.equal(inv.vatNumber, "094123456");
  assert.equal(inv.lines.length, 1);
  assert.equal(inv.lines[0].unitPriceCents, 1240);
  assert.equal(inv.lines[0].discountBps, 1250);
  assert.equal(inv.lines[0].vatRate, 13);
  assert.equal(inv.mydataMark, "400001234567890");
  assert.equal(inv.paymentMethod, "Επί πιστώσει");
  assert.equal(inv.shippingCostCents, 350);
  assert.equal(inv.lines[0].ean, "5201234567890");
  assert.equal(inv.lines[0].expiresAt?.toISOString().slice(0, 10), "2026-12-20");
});

test("τυλιγμένο σε ```json με πρόλογο: κρατιέται μόνο το αντικείμενο", () => {
  const inv = parseInvoiceJson('Ορίστε:\n```json\n{"number": null, "issuedAt": null, "lines": [{"description": "ΖΑΧΑΡΗ 25KG", "quantity": 2, "unitPrice": 18.9}]}\n```');
  assert.equal(inv.lines.length, 1);
  assert.equal(inv.lines[0].supplierCode, null);
  assert.equal(inv.lines[0].unitPriceCents, 1890);
});

test("σάπιες γραμμές (κενή περιγραφή, μη ακέραια ποσότητα, αρνητική τιμή) πετιούνται", () => {
  const inv = parseInvoiceJson('{"lines": [{"description": "", "quantity": 1, "unitPrice": 1}, {"description": "Χ", "quantity": 1.5, "unitPrice": 1}, {"description": "OK ΕΙΔΟΣ", "quantity": 1, "unitPrice": -2}, {"description": "ΣΥΝΟΛΟ", "quantity": 3, "unitPrice": 5.5}]}');
  assert.equal(inv.lines.length, 1);
  assert.equal(inv.lines[0].description, "ΣΥΝΟΛΟ");
});

test("χωρίς έγκυρη γραμμή ή χωρίς JSON: αποτυχία", () => {
  assert.throws(() => parseInvoiceJson("δεν κατάλαβα"), /δομημένα/);
  assert.throws(() => parseInvoiceJson("{όχι json}"), /JSON/);
  assert.throws(() => parseInvoiceJson('{"lines": []}'), /καμία γραμμή/);
});

test("EAN και ΑΦΜ: μόνο ψηφία, σωστό μήκος, αλλιώς null", () => {
  const inv = parseInvoiceJson('{"vatNumber": "EL094123456", "lines": [{"description": "ΤΥΡΙ", "quantity": 1, "unitPrice": 4, "ean": "52 01 234"}]}');
  assert.equal(inv.vatNumber, "094123456");
  assert.equal(inv.lines[0].ean, null); // 7 ψηφία — πολύ λίγα
});

test("χρέωση: κόστος × ισοτιμία × (1 + markup), στρογγυλή σε λεπτό", () => {
  assert.equal(chargeCents(0.01, 0.92, 30), 1); // 0.01196 $ → 1,2 λεπτά → 1
  assert.equal(chargeCents(0.05, 1, 0), 5);
  assert.equal(chargeCents(0, 0.92, 30), 0);
});
