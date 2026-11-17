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
