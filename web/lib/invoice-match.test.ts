import assert from "node:assert/strict";
import { test } from "node:test";
import { matchInvoiceLine } from "./invoice-match.ts";

const baseline = {
  receivedQuantityBase: 1_000_000,
  costScale: 1_000_000,
  order: { unitPriceCents: 1000, discountBps: 0, vatRate: 24 },
  receipt: { unitPriceCents: 1000, discountBps: 0, vatRate: 24 },
};

test("three-way match: ακριβές τιμολόγιο χωρίς discrepancy", () => {
  const result = matchInvoiceLine({ quantityBase: 1_000_000, unitPriceCents: 1000, vatRate: 24 }, baseline);
  assert.equal(result.grossCents, 1000);
  assert.equal(result.priceBasis, "ORDER");
  assert.deepEqual(result.discrepancies, []);
});

test("three-way match: τιμή μετά έκπτωσης και προτεραιότητα συμφωνίας", () => {
  const matched = matchInvoiceLine(
    { quantityBase: 1_000_000, unitPriceCents: 1000, discountBps: 1000, vatRate: 24 },
    { ...baseline, agreement: { priceCents: 450, contentQty: 500_000 } },
  );
  assert.equal(matched.priceBasis, "AGREEMENT");
  assert.equal(matched.expectedUnitPriceCents, 900);
  assert.deepEqual(matched.discrepancies, []);

  const mismatch = matchInvoiceLine({ quantityBase: 1_000_000, unitPriceCents: 1100, vatRate: 24 }, baseline);
  assert.deepEqual(mismatch.discrepancies.map((row) => [row.kind, row.expectedUnitPriceCents, row.actualUnitPriceCents]), [["PRICE_MISMATCH", 1000, 1100]]);
});

test("three-way match: ποσότητα, συνδυασμός και λογιστική απόκλιση ΦΠΑ", () => {
  const quantity = matchInvoiceLine({ quantityBase: 500_000, unitPriceCents: 1000, vatRate: 24 }, baseline);
  assert.equal(quantity.grossCents, 500);
  assert.deepEqual(quantity.discrepancies.map((row) => row.kind), ["QUANTITY_MISMATCH"]);

  const combined = matchInvoiceLine({ quantityBase: 500_000, unitPriceCents: 1100, vatRate: 13 }, baseline);
  assert.deepEqual(combined.discrepancies.map((row) => row.kind), ["QUANTITY_MISMATCH", "PRICE_MISMATCH", "VAT_MISMATCH"]);
});

test("three-way match: μερική παραλαβή είναι νόμιμη και χωρίς σύγκριση με order quantity", () => {
  const result = matchInvoiceLine(
    { quantityBase: 400_000, unitPriceCents: 475, vatRate: 24 },
    { ...baseline, receivedQuantityBase: 400_000, order: { unitPriceCents: 500, discountBps: 500, vatRate: 24 } },
  );
  assert.equal(result.grossCents, 190);
  assert.deepEqual(result.discrepancies, []);
});

test("three-way match: receipt fallback και ακέραιη μετατροπή μεγάλου ποσού", () => {
  const result = matchInvoiceLine(
    { quantityBase: 2_000_000, unitPriceCents: 333, vatRate: 24 },
    { receivedQuantityBase: 2_000_000, costScale: 1_000_000, receipt: { unitPriceCents: 333, discountBps: 0, vatRate: 24 } },
  );
  assert.equal(result.priceBasis, "RECEIPT");
  assert.equal(result.grossCents, 666);
  assert.deepEqual(result.discrepancies, []);
});
