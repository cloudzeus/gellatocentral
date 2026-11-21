import { test } from "node:test";
import assert from "node:assert/strict";
import { findManufacturerDuplicates, manufacturerMatchKeys, normalizeManufacturerName, sameManufacturer } from "./manufacturer.ts";

test("όνομα κατασκευαστή: κεφαλαία, χωρίς τόνους και με καθαρά κενά", () => {
  assert.equal(normalizeManufacturerName("  Μεβγάλ   Άλφα "), "ΜΕΒΓΑΛ ΑΛΦΑ");
  assert.equal(normalizeManufacturerName("Crème brûlée"), "CREME BRULEE");
  assert.equal(normalizeManufacturerName("ΐϊ ΰϋ"), "ΙΙ ΥΥ");
  assert.equal(normalizeManufacturerName("Straße"), "STRASSE");
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
