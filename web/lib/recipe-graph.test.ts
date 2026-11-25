import { test } from "node:test";
import assert from "node:assert/strict";
import { expandRecipe, type RecipeGraphNode } from "./recipe-graph.ts";

const recipes: RecipeGraphNode[] = [
  { id: "base", name: "Βάση", batchGrams: 1000, outputGenericItemId: "base-stock", items: [{ genericItemId: "milk", grams: 700 }, { genericItemId: "sugar", grams: 200 }] },
  { id: "gelato", name: "Παγωτό", batchGrams: 2000, outputGenericItemId: "gelato-stock", items: [{ genericItemId: "base-stock", grams: 1500 }, { genericItemId: "cacao", grams: 100 }] },
];

test("υποσυνταγή: αναδρομική κλιμάκωση και συνένωση πρώτων υλών", () => {
  const result = expandRecipe(recipes, "gelato", 4000);
  assert.deepEqual(result.lines.map(({ genericItemId, grams }) => ({ genericItemId, grams })), [
    { genericItemId: "milk", grams: 2100 },
    { genericItemId: "sugar", grams: 600 },
    { genericItemId: "cacao", grams: 200 },
  ]);
  assert.equal((result.snapshot.recipe as { id: string }).id, "gelato");
});

test("κυκλική υποσυνταγή απορρίπτεται με κατανοητό μήνυμα", () => {
  assert.throws(() => expandRecipe([
    { id: "a", name: "Α", batchGrams: 100, outputGenericItemId: "a-stock", items: [{ genericItemId: "b-stock", grams: 50 }] },
    { id: "b", name: "Β", batchGrams: 100, outputGenericItemId: "b-stock", items: [{ genericItemId: "a-stock", grams: 50 }] },
  ], "a", 100), /Κυκλική αναφορά/);
});

test("ίδια πρώτη ύλη από δύο κλαδιά αθροίζεται χωρίς διπλή συνταγή", () => {
  const result = expandRecipe([
    { id: "sub", name: "Υπο", batchGrams: 100, outputGenericItemId: "sub-stock", items: [{ genericItemId: "milk", grams: 80 }] },
    { id: "root", name: "Κύρια", batchGrams: 100, items: [{ genericItemId: "sub-stock", grams: 50 }, { genericItemId: "milk", grams: 20 }] },
  ], "root", 200);
  assert.deepEqual(result.lines, [{ genericItemId: "milk", grams: 120, viaRecipeIds: ["root", "sub"] }]);
});
