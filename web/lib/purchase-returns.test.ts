import assert from "node:assert/strict";
import test from "node:test";
import { awaitingCredit, checkQuantities, returnable } from "./purchase-returns-rules.ts";

const lines = [{ id: "a", quantity: 12 }, { id: "b", quantity: 5 }];
const names = new Map([["a", "Γάλα"], ["b", "Ποτηράκια"]]);

test("όσα μένουν να επιστραφούν: παραλήφθηκαν μείον όσα ήδη επιστράφηκαν", () => {
  const left = returnable(lines, [{ sourceLineId: "a", quantity: 6 }, { sourceLineId: "a", quantity: 2 }, { sourceLineId: null, quantity: 9 }]);
  assert.equal(left.get("a"), 4);
  assert.equal(left.get("b"), 5);
});

test("οι ποσότητες της φόρμας μένουν μέσα στα όρια", () => {
  const left = returnable(lines, []);
  assert.deepEqual(checkQuantities([{ lineId: "a", quantity: 6 }, { lineId: "b", quantity: 0 }], left, names), [{ lineId: "a", quantity: 6 }]);
  assert.throws(() => checkQuantities([{ lineId: "b", quantity: 6 }], left, names), /έως 5/);
  assert.throws(() => checkQuantities([{ lineId: "a", quantity: 0 }], left, names), /τουλάχιστον μία/);
  assert.throws(() => checkQuantities([{ lineId: "x", quantity: 1 }], left, names), /δεν ανήκει/);
});

test("η επιστροφή περιμένει πιστωτικό μέχρι να καλυφθεί", () => {
  assert.equal(awaitingCredit(1897, 0), 1897);
  assert.equal(awaitingCredit(1897, 1500), 397);
  assert.equal(awaitingCredit(1897, 2000), 0);
});
