import assert from "node:assert/strict";
import { test } from "node:test";
import { issuerReadiness, missingTypes, WHOLESALE_TYPES } from "./settings.ts";

test("missingTypes: ανενεργή σειρά ή σειρά άλλου καταστήματος δεν καλύπτει, σειρά χωρίς κατάστημα καλύπτει", () => {
  const series = [
    { docType: "1.1", storeId: "s1", active: true },
    { docType: "9.3", storeId: "s1", active: false },
    { docType: "9.3", storeId: "s2", active: true },
    { docType: "5.1", storeId: null, active: true },
  ];
  assert.deepEqual(missingTypes(WHOLESALE_TYPES, series, "s1"), ["9.3"]);
  assert.deepEqual(missingTypes(WHOLESALE_TYPES, series, "s2"), ["1.1"]);
});

test("issuerReadiness: λέει τι λείπει με λέξεις", () => {
  const r = issuerReadiness({ name: "Βορράς ΙΚΕ", vatNumber: "802345678", taxOffice: " ", address: "Τσιμισκή 48", city: "Θεσσαλονίκη", postalCode: null, aadeUserId: "u", aadeSubKey: "k" });
  assert.deepEqual(r.missingFields, ["ΔΟΥ", "ΤΚ"]);
  assert.equal(r.mydata, true);
  assert.equal(r.viva, false);
});
