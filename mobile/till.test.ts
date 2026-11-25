import assert from "node:assert/strict";
import { test } from "node:test";
import { amountCents, amountText, quickAmounts, retryDelayMs, totals, typeAmount } from "./till.ts";

test("σύνολα: τελικές τιμές, καθαρή αξία και ΦΠΑ που αθροίζουν στο σύνολο", () => {
  const t = totals([{ priceCents: 350, vatRate: 13, quantity: 2 }, { priceCents: 120, vatRate: 24, quantity: 1 }]);
  assert.equal(t.totalCents, 820);
  assert.equal(t.netCents, 619 + 97);
  assert.equal(t.netCents + t.vatCents, t.totalCents);
  assert.deepEqual(totals([]), { totalCents: 0, netCents: 0, vatCents: 0 });
});

test("γρήγορα ποσά: τα επόμενα χαρτονομίσματα πάνω από το σύνολο", () => {
  assert.deepEqual(quickAmounts(820), [1000, 2000, 5000]);
  assert.deepEqual(quickAmounts(1000), [2000, 5000, 10000]);
  assert.deepEqual(quickAmounts(25000), []);
});

test("πληκτρολόγιο ποσού: ένα κόμμα, δύο δεκαδικά, σβήσιμο", () => {
  const typed = (keys: string) => [...keys].reduce(typeAmount, "");
  assert.equal(typed("20"), "20");
  assert.equal(typed("0"), "0");
  assert.equal(typed("05"), "5");
  assert.equal(typed(",5"), "0,5");
  assert.equal(typed("12,,345"), "12,34");
  assert.equal(typed("12,3⌫⌫"), "12");
  assert.equal(typed("1234567"), "12345");
  assert.equal(amountCents("12,3"), 1230);
  assert.equal(amountCents("20"), 2000);
  assert.equal(amountCents(""), 0);
  assert.equal(amountText(820), "8,20");
  assert.equal(amountText(2000), "20");
});

test("αυτόματος έλεγχος: αυξανόμενη αναμονή με ταβάνι", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelayMs), [5000, 10000, 20000, 40000, 60000, 60000]);
});
