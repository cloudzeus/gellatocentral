import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanCoords, cleanEuroCents, cleanIban, cleanNonNegativeInt, cleanRoles, cleanWeekdays, DB_INT_MAX, distanceKm, maskIban, roleText, showIban, weekdayText } from "./parties.ts";

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
test("IBAN στην καρτέλα: μόνο πρώτα και τελευταία 4, χωρίς διαρροή μεσαίων ψηφίων", () => {
  const iban = "GR1601101250000000012300695";
  const masked = maskIban("gr16 0110 1250 0000 0001 2300 695");
  assert.equal(masked, "GR16 •••• •••• •••• 0695");
  assert.equal(masked.includes(iban), false);
  assert.equal(masked.includes("0110125000000000123"), false);
  assert.equal(maskIban("GR16"), "••••");
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

test("εμπορικά ποσά: κόμμα ή τελεία, ακριβή λεπτά και καθαρισμός με κενό", () => {
  assert.equal(cleanEuroCents("1234,56"), 123_456);
  assert.equal(cleanEuroCents(" 1234.5 "), 123_450);
  assert.equal(cleanEuroCents("0"), 0);
  assert.equal(cleanEuroCents(""), null);
  assert.equal(cleanEuroCents("   "), null);
});

test("εμπορικά ποσά: απορρίπτονται αρνητικά, άκυρα και υπερχείλιση Int", () => {
  for (const value of ["-1", "abc", "1,234", "1.2.3", "1e3", "NaN", "Infinity", "21474836,48", "999999999999999999999999"]) assert.equal(cleanEuroCents(value), null, value);
  assert.equal(cleanEuroCents("21474836,47"), DB_INT_MAX);
});

test("ημέρες προετοιμασίας: μόνο μη αρνητικοί ακέραιοι εντός Int", () => {
  assert.equal(cleanNonNegativeInt("0"), 0);
  assert.equal(cleanNonNegativeInt(" 30 "), 30);
  assert.equal(cleanNonNegativeInt(String(DB_INT_MAX)), DB_INT_MAX);
  for (const value of ["-1", "1.5", "1,5", "abc", "1e3", String(DB_INT_MAX + 1), "999999999999999999999999"]) assert.equal(cleanNonNegativeInt(value), null, value);
});

test("ημέρες εβδομάδας: σταθερή σειρά, dedupe, κενό και αυστηρός έλεγχος", () => {
  assert.deepEqual(cleanWeekdays(["5", "1", "5", "3"]), [1, 3, 5]);
  assert.deepEqual(cleanWeekdays([7, 2, 7]), [2, 7]);
  assert.deepEqual(cleanWeekdays([]), []);
  for (const values of [["0"], ["8"], ["-1"], ["1.5"], ["Δευτέρα"], ["1", "x"], [DB_INT_MAX + 1]]) assert.equal(cleanWeekdays(values), null);
  assert.equal(weekdayText(["7", "1", "7"]), "Δευτέρα, Κυριακή");
  assert.equal(weekdayText([]), null);
});
