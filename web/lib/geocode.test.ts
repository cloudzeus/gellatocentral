import assert from "node:assert/strict";
import { test } from "node:test";
import { addressQueries } from "./geocode.ts";

test("διεύθυνση όπως τη δίνει η ΑΑΔΕ: πρώτα χωρίς «ΛΕΩΦΟΡΟΣ» και Τ.Κ., μετά όπως γράφτηκε", () => {
  assert.deepEqual(addressQueries({ street: "ΛΕΩΦΟΡΟΣ ΚΗΦΙΣΙΑΣ 99", postalCode: "15124", city: "ΜΑΡΟΥΣΙ" }), ["ΚΗΦΙΣΙΑΣ 99, ΜΑΡΟΥΣΙ", "ΛΕΩΦΟΡΟΣ ΚΗΦΙΣΙΑΣ 99, 15124, ΜΑΡΟΥΣΙ"]);
  assert.deepEqual(addressQueries({ street: "Λεωφ. Συγγρού 12", city: "Αθήνα" }), ["Συγγρού 12, Αθήνα", "Λεωφ. Συγγρού 12, Αθήνα"]);
});
test("απλή οδός: δύο μορφές, με και χωρίς Τ.Κ.", () => assert.deepEqual(addressQueries({ street: "Τσιμισκή 43", postalCode: "54624", city: "Θεσσαλονίκη" }), ["Τσιμισκή 43, Θεσσαλονίκη", "Τσιμισκή 43, 54624, Θεσσαλονίκη"]));
test("χωρίς οδό δεν ψάχνει (ποτέ πινέζα μόνο από την πόλη)", () => {
  assert.deepEqual(addressQueries({ street: "", city: "Αθήνα" }), []);
  assert.deepEqual(addressQueries({ city: "Αθήνα" }), []);
});

import { matchRegion, parseSuggestions } from "./geocode.ts";
const REGIONS = ["Αττική", "Θεσσαλία", "Στερεά Ελλάδα", "Βόρειο Αιγαίο", "Νότιο Αιγαίο", "Κρήτη"];
test("περιοχή από το κείμενο του χάρτη: μόνο όταν ταιριάζει ακριβώς μία", () => {
  assert.equal(matchRegion("Αποκεντρωμένη Διοίκηση Αττικής", REGIONS), "Αττική");
  assert.equal(matchRegion("Αποκεντρωμένη Διοίκηση Κρήτης", REGIONS), "Κρήτη");
  assert.equal(matchRegion("Αποκεντρωμένη Διοίκηση Θεσσαλίας - Στερεάς Ελλάδας", REGIONS), null);
  assert.equal(matchRegion("Αποκεντρωμένη Διοίκηση Αιγαίου", REGIONS), null);
  assert.equal(matchRegion("Περιφερειακή Ενότητα Θεσσαλονίκης", REGIONS), null);
});
test("προτάσεις διεύθυνσης: μόνο όσες έχουν οδό, με Τ.Κ. χωρίς κενό και χωρίς διπλές", () => {
  const house = { properties: { type: "house", street: "Ερμού", housenumber: "15", city: "Αθήνα", postcode: "105 63", countrycode: "GR", state: "Αποκεντρωμένη Διοίκηση Αττικής" }, geometry: { coordinates: [23.7318, 37.9758] } };
  const got = parseSuggestions({ features: [house, house, { properties: { type: "city", name: "Αθήνα" }, geometry: { coordinates: [23.7, 37.9] } }, { properties: { type: "street", name: "Τσιμισκή", city: "Θεσσαλονίκη" }, geometry: { coordinates: [22.94, 40.63] } }] }, REGIONS);
  assert.deepEqual(got[0], { label: "Ερμού 15, 10563 Αθήνα", street: "Ερμού 15", postalCode: "10563", city: "Αθήνα", region: "Αττική", countryCode: "GR", latitude: 37.9758, longitude: 23.7318 });
  assert.deepEqual(got.map((x) => x.street), ["Ερμού 15", "Τσιμισκή"]);
  assert.deepEqual(parseSuggestions(null), []);
});

import { keepHouseNumber } from "./geocode.ts";
test("ο αριθμός που γράφτηκε μένει όταν ο χάρτης έχει την οδό χωρίς αριθμούς", () => {
  const row = { label: "Κάστορος, 18545 Πειραιάς", street: "Κάστορος", postalCode: "18545", city: "Πειραιάς", region: null, countryCode: "GR", latitude: 0, longitude: 0 };
  assert.deepEqual(keepHouseNumber([row], "Κάστορος 24").map((r) => [r.street, r.label]), [["Κάστορος 24", "Κάστορος 24, 18545 Πειραιάς"]]);
  assert.equal(keepHouseNumber([{ ...row, street: "Κάστορος 10" }], "Κάστορος 24")[0].street, "Κάστορος 10");
  assert.equal(keepHouseNumber([row], "Κάστορος 24 Πειραιάς")[0].street, "Κάστορος 24");
  assert.equal(keepHouseNumber([row], "Κάστορος")[0].street, "Κάστορος");
});
