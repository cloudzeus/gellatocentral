// Tests για τις μετατροπές μονάδων (lib/units.ts) — τρέχουν με `npm test` (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertUnits, formatBaseQty, fromBaseUnits, gramsToBaseQty, packToBase, toBaseUnits, type UnitLike } from "./units.ts";

const mg: UnitLike = { code: "mg", dimension: "mass", toBase: 1 };
const g: UnitLike = { code: "g", dimension: "mass", toBase: 1_000 };
const kg: UnitLike = { code: "kg", dimension: "mass", toBase: 1_000_000 };
const ml: UnitLike = { code: "ml", dimension: "volume", toBase: 1 };
const l: UnitLike = { code: "l", dimension: "volume", toBase: 1_000 };
const pcs: UnitLike = { code: "pcs", dimension: "count", toBase: 1 };

test("toBaseUnits: ακέραιος πολλαπλασιασμός προς τη βασική μονάδα", () => {
  assert.equal(toBaseUnits(25, kg), 25_000_000); // 25 kg → mg, χωράει σε Int32
  assert.equal(toBaseUnits(3, g), 3_000);
  assert.equal(toBaseUnits(2, l), 2_000);
  assert.equal(toBaseUnits(7, pcs), 7);
});

test("toBaseUnits: απορρίπτει κλασματική είσοδο (η βάση είναι ακέραια)", () => {
  assert.throws(() => toBaseUnits(1.5, kg), /ακέραια/);
});

test("fromBaseUnits: βασικές → μονάδα εμφάνισης, επιτρέπει κλάσμα", () => {
  assert.equal(fromBaseUnits(1_500, g), 1.5);
  assert.equal(fromBaseUnits(25_000_000, kg), 25);
  assert.equal(fromBaseUnits(1_000, l), 1);
});

test("convertUnits: μέσα στην ίδια διάσταση", () => {
  assert.equal(convertUnits(1, kg, g), 1_000);
  assert.equal(convertUnits(500, ml, l), 0.5);
  assert.equal(convertUnits(2_500, g, kg), 2.5);
});

test("convertUnits: αλλιώτικες διαστάσεις δεν μετατρέπονται", () => {
  assert.throws(() => convertUnits(1, kg, l), /δεν μετατρέπεται/);
  assert.throws(() => convertUnits(1, pcs, g), /δεν μετατρέπεται/);
});

test("packToBase: σπάσιμο συσκευασίας σε βασικές μονάδες", () => {
  // κιβώτιο 12 φιαλών × 1000 ml = 12_000 ml
  assert.equal(packToBase(12, 1_000), 12_000);
  assert.throws(() => packToBase(0, 1_000), /θετικός ακέραιος/);
  assert.throws(() => packToBase(1, 0), /θετικός ακέραιος/);
});

test("formatBaseQty: διαλέγει την πιο αναγνώσιμη μονάδα", () => {
  const mass = [mg, g, kg];
  assert.equal(formatBaseQty(1_500_000, mass, "en-US"), "1.5 kg");
  assert.equal(formatBaseQty(2_500, mass, "en-US"), "2.5 g");
  assert.equal(formatBaseQty(500, mass, "en-US"), "500 mg");
});

test("gramsToBaseQty: μάζα σε mg, όγκος σε ml, τεμάχια μέσω βάρους", () => {
  assert.equal(gramsToBaseQty(1500, g), 1_500_000);
  assert.equal(gramsToBaseQty(1500, kg), 1_500_000); // η βασική του είδους δεν αλλάζει το αποτέλεσμα
  assert.equal(gramsToBaseQty(800, ml), 800);
  assert.equal(gramsToBaseQty(110, pcs, 55), 2);
  assert.throws(() => gramsToBaseQty(110, pcs)); // χωρίς βάρος τεμαχίου
  assert.throws(() => gramsToBaseQty(20, pcs, 55)); // δεν φτάνει για ένα τεμάχιο
  assert.throws(() => gramsToBaseQty(0, g));
});
