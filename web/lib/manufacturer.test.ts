import { test } from "node:test";
import assert from "node:assert/strict";
import { findManufacturerDuplicates, formatManufacturerBrand, manufacturerMatchKeys, normalizeManufacturerName, sameManufacturer } from "./manufacturer.ts";

test("όνομα κατασκευαστή: κεφαλαία, χωρίς τόνους και με καθαρά κενά", () => {
  assert.equal(normalizeManufacturerName("  Μεβγάλ   Άλφα "), "ΜΕΒΓΑΛ ΑΛΦΑ");
  assert.equal(normalizeManufacturerName("Crème brûlée"), "CREME BRULEE");
  assert.equal(normalizeManufacturerName("ΐϊ ΰϋ"), "ΙΙ ΥΥ");
  assert.equal(normalizeManufacturerName("Straße"), "STRASSE");
});

test("εμφάνιση κατασκευαστή και brand: κεφαλαία χωρίς διπλό ίδιο όνομα", () => {
  assert.equal(formatManufacturerBrand("Tasty", "TASTY"), "TASTY");
  assert.equal(formatManufacturerBrand("Μεβγάλ", "ΜΕΒΓΑΛ"), "ΜΕΒΓΑΛ");
  assert.equal(formatManufacturerBrand("Μεβγάλ", "Σοκολάτα"), "ΜΕΒΓΑΛ · ΣΟΚΟΛΑΤΑ");
  assert.equal(formatManufacturerBrand("Tasty"), "TASTY");
});

test("διπλότυπα: πεζά/κεφαλαία, τόνοι, στίξη και κολλημένες λέξεις", () => {
  assert.equal(sameManufacturer("Mr . Grand", "mrgrand"), true);
  assert.equal(sameManufacturer("Μεβγάλ", "ΜΕΒΓΑΛ"), true);
  assert.equal(sameManufacturer("Νέα-Υόρκη", "νεα υορκη"), true);
  assert.equal(sameManufacturer("ΔΕΛΤΑ", "ΦΑΓΕ"), false);
});

test("διπλότυπα: ελληνικά, λατινικά και συνήθεις μεταγραφές", () => {
  assert.equal(sameManufacturer("ΔΕΛΤΑ", "delta"), true);
  assert.equal(sameManufacturer("ΦΑΓΕ", "Phage"), true);
  assert.equal(sameManufacturer("ΜΕΒΓΑΛ", "MEVGAL"), true);
  assert.equal(sameManufacturer("ΝΟΥΝΟΥ", "Nounou"), true);
  assert.equal(sameManufacturer("ΚΡΙ ΚΡΙ", "Cri Cri"), true);
  assert.equal(sameManufacturer("ΧΑΡΑΛΑΜΠΟΣ", "Haralambos"), true);
  assert.equal(sameManufacturer("ΩΡΑ", "WRA"), true);
});

test("τα κλειδιά αγνοούν σύμβολα και δεν επιστρέφουν κενά", () => {
  assert.equal(sameManufacturer("Mr. Grand®", "mr grand"), true);
  assert.deepEqual(manufacturerMatchKeys("---"), []);
  assert.equal(sameManufacturer("---", "!!!"), false);
});

test("διπλότυπα: εταιρικά επιθέματα, supermarket και SS στη μεταγραφή", () => {
  assert.equal(sameManufacturer("ACME S. A.", "ACME"), true);
  assert.equal(sameManufacturer("ACME SUPER MARKET", "ACME SUPERMARKET"), true);
  assert.equal(sameManufacturer("ACME VASSILOPOULOS", "ACME VASILOPOULOS"), true);
  assert.equal(sameManufacturer("ACME FOODS", "ACME"), false);
});

test("διπλότυπα: όλες οι γνωστές γραφές της ΑΒ έχουν κοινή ταυτότητα", () => {
  const variants = ["AB", "ΑΒ", "AB SUPER MARKET", "AB VASILIPOULOS", "AB VASILOPOULOS", "AB VASSILOPOULOS S. A."];
  for (const left of variants) for (const right of variants) assert.equal(sameManufacturer(left, right), true, `${left} ↔ ${right}`);
  assert.equal(sameManufacturer("AB FOODS", "AB"), false);
  assert.equal(sameManufacturer("AB VASILOPOULOS", "AB FOODS"), false);
});

test("ομαδοποίηση: πιάνει και αλυσίδα διαφορετικών γραφών", () => {
  const groups = findManufacturerDuplicates([
    { id: "3", name: "mrgrand" },
    { id: "2", name: "Mr . Grand" },
    { id: "1", name: "ΔΕΛΤΑ" },
    { id: "4", name: "delta" },
    { id: "5", name: "ΦΑΓΕ" },
  ]);
  assert.deepEqual(groups.map((g) => g.ids), [["1", "4"], ["2", "3"]]);
});
