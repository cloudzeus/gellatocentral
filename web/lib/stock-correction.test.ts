// Tests για τη διόρθωση υπολοίπου παρτίδας (lib/stock-correction.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { correctionBaseQty } from "./stock-correction.ts";

test("μάζα: τα γραμμάρια γίνονται mg με το σωστό πρόσημο", () => {
  assert.equal(correctionBaseQty({ direction: "in", amount: 250, dimension: "mass", remaining: 0 }), 250_000);
  assert.equal(correctionBaseQty({ direction: "out", amount: 250, dimension: "mass", remaining: 500_000 }), -250_000);
});

test("όγκος και τεμάχια είναι ήδη σε βασική μονάδα", () => {
  assert.equal(correctionBaseQty({ direction: "in", amount: 300, dimension: "volume", remaining: 0 }), 300);
  assert.equal(correctionBaseQty({ direction: "out", amount: 2, dimension: "count", remaining: 5 }), -2);
});

test("αφαίρεση πάνω από το υπόλοιπο απορρίπτεται", () => {
  assert.throws(() => correctionBaseQty({ direction: "out", amount: 600, dimension: "mass", remaining: 500_000 }), /υπόλοιπο/);
  assert.equal(correctionBaseQty({ direction: "out", amount: 500, dimension: "mass", remaining: 500_000 }), -500_000);
});

test("άκυρη ποσότητα απορρίπτεται", () => {
  assert.throws(() => correctionBaseQty({ direction: "in", amount: 0, dimension: "mass", remaining: 0 }));
  assert.throws(() => correctionBaseQty({ direction: "in", amount: 1.5, dimension: "count", remaining: 0 }));
  assert.throws(() => correctionBaseQty({ direction: "out", amount: -5, dimension: "volume", remaining: 100 }));
});
