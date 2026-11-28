// Δοκιμές της αντιστοίχισης «Λείπουν από τις αγορές»: MARK πρώτα, αλλιώς ΑΦΜ + αριθμός· δελτία εκτός· παράθυρο ελέγχου.
import assert from "node:assert/strict";
import test from "node:test";
import { findOurs, isExpense, syncWindow, type OurDoc } from "./mydata-incoming-match.ts";

const doc = (o: Partial<OurDoc>): OurDoc => ({ id: "x", mydataMark: null, checkedMark: null, supplierVat: "099887766", number: null, ...o });
const aade = { mark: "400001", supplierVat: "099887766", series: "Α", number: "2231" };

test("ταιριάζει πρώτα με MARK, ακόμα κι αν άλλο έχει ίδιο αριθμό", () => {
  const ours = [doc({ id: "byNumber", number: "Α2231" }), doc({ id: "byMark", mydataMark: "400001" })];
  assert.equal(findOurs(aade, ours)?.id, "byMark");
});

test("MARK από τον έλεγχο σκαναρισμένου μετρά όσο και το δικό μας", () => {
  assert.equal(findOurs(aade, [doc({ id: "c", checkedMark: "400001" })])?.id, "c");
});

test("ίδιος ΑΦΜ και αριθμός με ή χωρίς σειρά", () => {
  assert.equal(findOurs(aade, [doc({ id: "a", number: "2231" })])?.id, "a");
  assert.equal(findOurs(aade, [doc({ id: "b", number: "Α-2231" })])?.id, "b");
});

test("άλλος ΑΦΜ ή παραστατικό με άλλο MARK δεν ταιριάζει", () => {
  assert.equal(findOurs(aade, [doc({ supplierVat: "111111111", number: "2231" })]), null);
  assert.equal(findOurs(aade, [doc({ mydataMark: "999", number: "2231" })]), null);
  assert.equal(findOurs(aade, [doc({ number: null })]), null);
});

test("δελτία 8.x/9.x δεν είναι έξοδα", () => {
  assert.equal(isExpense("1.1"), true);
  assert.equal(isExpense("5.1"), true);
  assert.equal(isExpense(null), true);
  assert.equal(isExpense("9.3"), false);
  assert.equal(isExpense("8.1"), false);
});

test("το παράθυρο ξεκινά την 1η του προηγούμενου μήνα, και τον Ιανουάριο", () => {
  assert.equal(syncWindow(new Date("2026-11-28T10:00:00Z")).from.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(syncWindow(new Date("2026-01-05T10:00:00Z")).from.toISOString(), "2025-12-01T00:00:00.000Z");
});
