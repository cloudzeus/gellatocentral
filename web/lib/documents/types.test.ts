// Tests των κανόνων τύπων παραστατικών (κοινός κατάλογος myDATA).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOC_TYPES, docTypeInfo } from "./types.ts";

test("κάθε τύπος έχει κωδικό myDATA της μορφής «είδος.τύπος» και τίτλο", () => {
  for (const [code, info] of Object.entries(DOC_TYPES)) {
    assert.match(code, /^\d+\.\d+$/);
    assert.equal(info.code, code);
    assert.ok(info.title.length > 0);
  }
});

test("τα πιστωτικά (5.x, 11.4) έχουν αρνητικό πρόσημο και τα συσχετιζόμενα είναι πάντα πιστωτικά", () => {
  for (const info of Object.values(DOC_TYPES)) {
    if (info.code.startsWith("5.") || info.code === "11.4") assert.equal(info.sign, -1, info.code);
    if (info.needsRelated) assert.equal(info.sign, -1, info.code);
  }
});

test("η ΑΛΠ (11.1) εκδίδεται· η ανάπτυξη νέων τύπων δηλώνεται με receiptCase null μέχρι το δείγμα της Viva", () => {
  assert.equal(typeof DOC_TYPES["11.1"].receiptCase, "bigint");
  assert.equal(DOC_TYPES["11.1"].retail, true);
  assert.equal(DOC_TYPES["5.2"].receiptCase, null);
});

test("docTypeInfo: άγνωστος τύπος απορρίπτεται", () => {
  assert.equal(docTypeInfo("11.4").title, "Πιστωτικό Στοιχείο Λιανικής");
  assert.throws(() => docTypeInfo("4.1"), RangeError);
});
