import assert from "node:assert/strict";
import { test } from "node:test";
import { amountCents, amountText, dropOption, equalSplit, type Group, missingIn, quickAmounts, retryDelayMs, tapOption, totals, typeAmount, unitPrice } from "./till.ts";

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

const flavours: Group = { id: "g", name: "Γεύσεις", kind: "REQUIRED", pick: 2, options: [{ id: "a", name: "Φιστίκι", priceCents: 30 }, { id: "b", name: "Βανίλια", priceCents: 0 }, { id: "c", name: "Λεμόνι", priceCents: 0 }] };
const extras: Group = { id: "e", name: "Έξτρα", kind: "EXTRA", pick: 0, options: [{ id: "x", name: "Σαντιγί", priceCents: 60 }] };
const without: Group = { id: "r", name: "Χωρίς", kind: "REMOVE", pick: 0, options: [{ id: "n", name: "Χωρίς ζάχαρη", priceCents: 50 }] };

test("γεύσεις: ίδια δύο φορές, η γεμάτη ομάδα αντικαθιστά την παλαιότερη", () => {
  let c = tapOption([], flavours, "a");
  c = tapOption(c, flavours, "a");
  assert.deepEqual(c, ["a", "a"]);
  assert.equal(missingIn(flavours, c), 0);
  assert.deepEqual(tapOption(["x", "a", "b"], flavours, "c"), ["x", "b", "c"]);
  assert.deepEqual(dropOption(["a", "b", "a"], "a"), ["a", "b"]);
  assert.equal(missingIn(flavours, ["b"]), 1);
});

test("έξτρα ανάβει/σβήνει, το «χωρίς» δεν χρεώνεται", () => {
  assert.deepEqual(tapOption(tapOption([], extras, "x"), extras, "x"), []);
  assert.equal(unitPrice(450, [flavours, extras, without], ["a", "a", "x", "n"]), 450 + 60 + 60);
});

test("ίσα σε N: αθροίζουν ακριβώς στο ποσό", () => {
  assert.deepEqual(equalSplit(1000, 3), [334, 333, 333]);
  assert.deepEqual(equalSplit(900, 3), [300, 300, 300]);
  assert.deepEqual(equalSplit(250, 1), [250]);
  for (const [c, n] of [[2011, 4], [7, 6], [100000, 7]]) assert.equal(equalSplit(c, n).reduce((a, b) => a + b, 0), c);
});
