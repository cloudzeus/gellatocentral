import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedTypes, checkCombo, DEFAULT_EXPENSE_TYPES, ExpenseRuleError, needsApproval, splitByMonth, vatTypeFor } from "./expense-rules.ts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

test("ΑΑΔΕ: E3_102_002 (λιανικές) όχι σε 1.1, ναι σε 13.1· μήνυμα με πρόταση", () => {
  assert.throws(() => checkCombo("1.1", "category2_1", "E3_102_002"), /Το E3_102_002 δεν επιτρέπεται σε Τιμολόγιο πώλησης 1.1. Διάλεξε E3_102_001/);
  assert.doesNotThrow(() => checkCombo("13.1", "category2_1", "E3_102_002"));
  assert.doesNotThrow(() => checkCombo("1.1", "category2_4", "E3_585_011"));
  assert.throws(() => checkCombo("17.1", "category2_4", "E3_585_011"), /κατηγορία/);
  assert.throws(() => checkCombo("11.1", "category2_4", "E3_585_011"), /δεν παίρνει χαρακτηρισμό εξόδου/);
  assert.doesNotThrow(() => checkCombo(null, "category2_1", "E3_102_002"), "χωρίς τύπο παραστατικού δεν ελέγχεται");
  assert.ok(allowedTypes("14.30", "category2_5").includes("E3_585_014"));
  // ενοίκιο: το 16.1 δέχεται μόνο category2_5, γι' αυτό η προεπιλογή E07 είναι εκεί (περνά και σε 1.1/2.1)
  const rent = DEFAULT_EXPENSE_TYPES.find((t) => t.code === "E07")!;
  for (const doc of ["16.1", "1.1", "2.1"]) assert.ok(allowedTypes(doc, rent.mydataCategory).includes(rent.mydataType), doc);
});

test("ΑΑΔΕ: κάθε προεπιλογή demo είναι επιτρεπτή σε 1.1 ή 2.1 (μισθοδοσία σε 17.1)", () => {
  for (const t of DEFAULT_EXPENSE_TYPES) {
    const docs = t.kind === "PAYROLL_COST" ? ["17.1"] : ["1.1", "2.1"];
    assert.ok(docs.some((doc) => allowedTypes(doc, t.mydataCategory).includes(t.mydataType)), `${t.code} ${t.mydataType}`);
  }
});

test("ασφάλιστρο 300 € Ιαν–Μαρ 2026: ανά ημέρα, άθροισμα ακριβώς", () => {
  const parts = splitByMonth(30_000, d("2026-01-01"), d("2026-03-31"));
  assert.deepEqual(parts.map((p) => p.month), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(parts.reduce((t, p) => t + p.cents, 0), 30_000);
  assert.deepEqual(parts.map((p) => p.cents), [10_334, 9_333, 10_333]); // 31/28/31 ημέρες από τις 90· στην ισοπαλία το λεπτό στον πρώτο
  assert.deepEqual(splitByMonth(100, d("2026-05-10"), d("2026-05-10")), [{ month: "2026-05", cents: 100 }]);
  assert.throws(() => splitByMonth(100, d("2026-05-10"), d("2026-05-01")), ExpenseRuleError);
});

test("έγκριση πάνω από όριο· ΦΠΑ χωρίς χαρακτηρισμό σε απαλλαγή", () => {
  assert.equal(needsApproval(60_000, 50_000), true);
  assert.equal(needsApproval(50_000, 50_000), false);
  assert.equal(needsApproval(60_000, null), false);
  assert.equal(vatTypeFor("VAT_361", 0), null);
  assert.equal(vatTypeFor("VAT_361", 2400), "VAT_361");
});
