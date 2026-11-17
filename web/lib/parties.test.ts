import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanCoords, cleanIban, cleanRoles, distanceKm, roleText, showIban } from "./parties.ts";

test("ρόλοι: πολλοί μαζί, μόνο έγκυροι, σταθερή σειρά", () => {
  assert.deepEqual(cleanRoles(["supplier", "customer", "άκυρο", "customer"]), ["customer", "supplier"]);
  assert.deepEqual(cleanRoles([]), []);
  assert.equal(roleText(["customer", "supplier"]), "Πελάτης, Προμηθευτής");
  assert.equal(roleText([]), "Χωρίς ρόλο");
});
test("IBAN: δέχεται κενά και πεζά, ελέγχει μήκος και ψηφία ελέγχου", () => {
  assert.equal(cleanIban("gr16 0110 1250 0000 0001 2300 695"), "GR1601101250000000012300695"); // το παράδειγμα της ECB για την Ελλάδα
  assert.equal(cleanIban("DE89 3704 0044 0532 0130 00"), "DE89370400440532013000");
  assert.equal(cleanIban("GR16 0110 1250 0000 0001 2300 696"), null); // λάθος τελευταίο ψηφίο
  assert.equal(cleanIban("GR16 0110 1250 0000 0001 2300 69"), null); // λάθος μήκος
  assert.equal(cleanIban("δεν είναι IBAN"), null);
  assert.equal(showIban("GR1601101250000000012300695"), "GR16 0110 1250 0000 0001 2300 695");
});
test("συντεταγμένες: ελληνικό κόμμα, όρια, ποτέ μισό ζευγάρι", () => {
  assert.deepEqual(cleanCoords("37,9838", " 23.7275 "), { latitude: 37.9838, longitude: 23.7275 });
  assert.equal(cleanCoords("37.98", ""), null);
  assert.equal(cleanCoords("97", "23"), null);
  assert.equal(cleanCoords("abc", "23"), null);
});
test("απόσταση σε ευθεία: Αθήνα – Θεσσαλονίκη περίπου 300 χλμ", () => {
  const km = distanceKm({ latitude: 37.9838, longitude: 23.7275 }, { latitude: 40.6401, longitude: 22.9444 });
  assert.ok(km > 295 && km < 310, String(km));
  assert.equal(distanceKm({ latitude: 37, longitude: 23 }, { latitude: 37, longitude: 23 }), 0);
});
