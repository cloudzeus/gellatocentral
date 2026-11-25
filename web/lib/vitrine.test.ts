import assert from "node:assert/strict";
import test from "node:test";
import { buildVitrineSnapshot, publicVitrineItems, publicVitrineSubscription } from "./vitrine.ts";

test("snapshot βιτρίνας: αλλεργιογόνα, traces και διατροφικά χωρίς κόστος", () => {
  const snapshot = buildVitrineSnapshot({ productName: "Βανίλια", priceCents: 300, recipeName: "Βανίλια", batchGrams: 1000, lines: [
    { name: "Γάλα", grams: 600, composition: { name: "Γάλα", fatPct: 3.5, msnfPm: undefined, allergensContains: ["milk"], isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: false } as never },
    { name: "Ζάχαρη", grams: 400, composition: { name: "Ζάχαρη", sucrosePct: 100, allergensTraces: ["nuts", "milk"], isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true } },
  ] });
  assert.deepEqual(snapshot.allergensContains, ["milk"]);
  assert.deepEqual(snapshot.allergensTraces, ["nuts"]);
  assert.equal(snapshot.dietary.vegan, false);
  assert.equal(snapshot.dietary.glutenFree, true);
  assert.equal(snapshot.nutritionPer100g?.sugars, 40);
  assert.equal("costBatchHundredths" in snapshot, false);
  assert.equal("orgId" in snapshot, false);
});

test("δημόσια λίστα: μόνο selected, όχι sold out ή μη διαθέσιμα", () => {
  const base = { priceCents: 100, position: 0, snapshot: {}, selected: true, soldOut: false };
  const items = publicVitrineItems([
    { ...base, productId: "a", name: "Α" },
    { ...base, productId: "b", name: "Β", soldOut: true },
    { ...base, productId: "c", name: "Γ", selected: false },
    { ...base, productId: "d", name: "Δ" },
  ], new Map([["d", false]]));
  assert.deepEqual(items.map((item) => item.productId), ["a"]);
  assert.equal("soldOut" in items[0], false);
});

test("δημόσια βιτρίνα σταματά σε αναστολή, κλείσιμο και ληγμένη grace", () => {
  const future = new Date(Date.now() + 86_400_000);
  assert.equal(publicVitrineSubscription({ suspendedAt: null, closingAt: null, subscription: { status: "ACTIVE", currentPeriodEnd: future } }), true);
  assert.equal(publicVitrineSubscription({ suspendedAt: new Date(), closingAt: null, subscription: null }), false);
  assert.equal(publicVitrineSubscription({ suspendedAt: null, closingAt: null, subscription: { status: "CANCELLED", currentPeriodEnd: future } }), false);
  assert.equal(publicVitrineSubscription({ suspendedAt: null, closingAt: null, subscription: { status: "ACTIVE", currentPeriodEnd: new Date(Date.now() - 8 * 86_400_000) } }), false);
});
