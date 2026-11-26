import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedCash, sumMovements } from "./till-figures.ts";

const at = (hhmm: string) => new Date(`2026-11-26T${hhmm}:00+02:00`);

test("το συρτάρι: έναρξη + μετρητά − επιστροφές μετρητών· η κάρτα δεν μετρά", () => {
  const f = sumMovements([
    { at: at("09:10"), cents: 1000, cash: true },
    { at: at("09:40"), cents: 2500, cash: false },
    { at: at("11:05"), cents: 480, cash: true },
    { at: at("11:30"), cents: 480, cash: true, refund: true },
    { at: at("11:35"), cents: 2500, cash: false, refund: true },
  ], 3);
  assert.equal(f.incomeCents, 3980);
  assert.equal(f.cashCents, 1480);
  assert.equal(f.cardCents, 2500);
  assert.equal(f.refunds, 2);
  assert.equal(f.refundCents, 2980);
  assert.equal(expectedCash(10000, f), 10000 + 1480 - 480);
});

test("ωριαίο γράφημα: συνεχείς ώρες, και οι άδειες ενδιάμεσα", () => {
  const f = sumMovements([{ at: at("09:10"), cents: 100, cash: true }, { at: at("11:59"), cents: 200, cash: false }], 2);
  assert.deepEqual(f.hours, [{ h: 9, card: 0, cash: 100 }, { h: 10, card: 0, cash: 0 }, { h: 11, card: 200, cash: 0 }]);
  assert.deepEqual(sumMovements([], 0).hours, []);
});
