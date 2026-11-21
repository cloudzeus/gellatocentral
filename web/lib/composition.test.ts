// Tests για τις μετατροπές σύστασης (lib/composition.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pctToPm, pmToInput, compositionFromRow, compositionFromForm, ALLERGENS, ALLERGEN_LABEL } from "./composition.ts";

test("pctToPm: κόμμα, κενό, όρια", () => {
  assert.equal(pctToPm("3,5"), 3500);
  assert.equal(pctToPm("0.456"), 456);
  assert.equal(pctToPm(""), null);
  assert.equal(pctToPm("  "), null);
  assert.throws(() => pctToPm("101"));
  assert.throws(() => pctToPm("-1"));
  assert.throws(() => pctToPm("abc"));
  // υπερκαλύψεις: επιτρέπουν πάνω από 100 (δεξτρόζη 190)
  assert.equal(pctToPm("190", true), 190000);
  assert.throws(() => pctToPm("190"));
});

test("pmToInput: χιλιοστά → κείμενο με κόμμα", () => {
  assert.equal(pmToInput(3500), "3,5");
  assert.equal(pmToInput(null), "");
  assert.equal(pmToInput(456), "0,456");
});

test("compositionFromRow: χιλιοστά → ποσοστά ανάλυσης", () => {
  const m = compositionFromRow({ fatPm: 3500, msnfPm: 8500, proteinAvailablePm: 3300, glucoseDe: 38, containsCocoa: 0, containsStarch: 1 });
  assert.equal(m.fatPct, 3.5);
  assert.equal(m.msnfPct, 8.5);
  assert.equal(m.proteinAvailablePct, 3.3);
  assert.equal(m.glucoseDe, 38);
  assert.equal(m.containsCocoa, false);
  assert.equal(m.containsStarch, true);
  assert.equal(m.sucrosePct, null); // κενό πεδίο βάσης → null
});

test("compositionFromForm: πλήρης κύκλος με σημαίες και αλλεργιογόνα", () => {
  const form = new FormData();
  form.set("fatPct", "3,5");
  form.set("glucoseDe", "38");
  form.set("acidityLevel", "high");
  form.set("containsCocoa", "on");
  form.set("isVegan", "on");
  form.append("allergensContains", "milk");
  form.append("allergensContains", "nuts");
  form.append("allergensContains", "αλλιώς"); // άγνωστο κλειδί αγνοείται
  form.set("allergensTraces", "sesame");
  const r = compositionFromForm(form);
  assert.ok("data" in r);
  assert.equal(r.data.fatPm, 3500);
  assert.equal(r.data.msnfPm, null);
  assert.equal(r.data.glucoseDe, 38);
  assert.equal(r.data.acidityLevel, "high");
  assert.equal(r.data.containsCocoa, true);
  assert.equal(r.data.containsStarch, false);
  assert.equal(r.data.isVegan, true);
  assert.equal(r.data.isVegetarian, false); // τα checkboxes χωρίς tick δεν στέλνονται
  assert.deepEqual(r.data.allergensContains, ["milk", "nuts"]);
  assert.deepEqual(r.data.allergensTraces, ["sesame"]);
});

test("compositionFromForm: σφάλματα με κατανοητό μήνυμα", () => {
  const bad = new FormData();
  bad.set("fatPct", "150");
  const r = compositionFromForm(bad);
  assert.ok("error" in r);
  assert.match(r.error, /Λιπαρά/);
  const badDe = new FormData();
  badDe.set("glucoseDe", "38,5");
  assert.ok("error" in compositionFromForm(badDe));
});

test("ο κατάλογος αλλεργιογόνων είναι τα 14 της ΕΕ", () => {
  assert.equal(ALLERGENS.length, 14);
  assert.equal(ALLERGEN_LABEL.milk, "Γάλα (λακτόζη)");
});
