import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDigit, gtinToEan, parseGs1, validGtin } from "./gs1.ts";

const GS = "\x1D";
// Επαληθευμένο ζεύγος: EAN-13 μονάδας ↔ GTIN-14 κιβωτίου (indicator 0, ξαναϋπολογισμένο check digit)
const EAN = "5201234567894";
const GTIN14 = "05201234567894";

test("validGtin / checkDigit", () => {
  assert.equal(checkDigit("520123456789"), 4);
  assert.equal(validGtin(EAN), true);
  assert.equal(validGtin(GTIN14), true);
  assert.equal(validGtin("5201234567895"), false); // λάθος check digit
  assert.equal(validGtin("abc"), false);
  assert.equal(validGtin("123"), false);
});

test("απλό EAN-13", () => {
  const r = parseGs1(EAN);
  assert.equal(r?.ean, EAN);
  assert.equal(r?.gtin, undefined);
  assert.equal(r?.batch, undefined);
});

test("απλό GTIN-14 με indicator 0: βγαίνει και το EAN της μονάδας", () => {
  const r = parseGs1(GTIN14);
  assert.equal(r?.gtin, GTIN14);
  assert.equal(r?.ean, EAN);
});

test("gtinToEan: μόνο indicator 0 και έγκυρο check digit", () => {
  assert.equal(gtinToEan(GTIN14), EAN);
  assert.equal(gtinToEan("15201234567890"), undefined); // indicator 1 = συσκευασία, όχι μονάδα
  assert.equal(gtinToEan("05201234567895"), undefined); // λάθος check digit
});

test("GS1-128 με GTIN + λήξη + παρτίδα (το 10 στο τέλος, χωρίς FNC1)", () => {
  const r = parseGs1(`01${GTIN14}1726123110ABC123`);
  assert.equal(r?.gtin, GTIN14);
  assert.equal(r?.ean, EAN);
  assert.equal(r?.batch, "ABC123");
  assert.equal(r?.expiry?.toISOString().slice(0, 10), "2026-12-31");
});

test("GS1 με prefix symbology και FNC1 ανάμεσα στα AI", () => {
  const r = parseGs1(`]C101${GTIN14}17260630${GS}10LOT99`);
  assert.equal(r?.ean, EAN);
  assert.equal(r?.batch, "LOT99");
  assert.equal(r?.expiry?.toISOString().slice(0, 10), "2026-06-30");
});

test("ημερομηνία με ημέρα 00 = τελευταία του μήνα", () => {
  const r = parseGs1(`01${GTIN14}17270200`);
  assert.equal(r?.expiry?.toISOString().slice(0, 10), "2027-02-28");
});

test("η (17) λήξη υπερισχύει της (15) «ανάλωση έως»", () => {
  const r = parseGs1(`01${GTIN14}1526010117261231`);
  assert.equal(r?.expiry?.toISOString().slice(0, 10), "2026-12-31");
});

test("μη αναγνωρίσιμα / άκυρα", () => {
  assert.equal(parseGs1(""), undefined);
  assert.equal(parseGs1("   "), undefined);
  assert.equal(parseGs1("5201234567895"), undefined); // λάθος check digit
  assert.equal(parseGs1("γεια"), undefined);
  assert.equal(parseGs1(`010520123456789317261231`), undefined); // AI(01) με λάθος check digit
});
