import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRecipeQty, lineCost, parseRecipeQty, recipeQtyInput, SalesRecipeError, typicalCost } from "./sales-recipes.ts";

test("ποσότητα συνταγής: g → mg, ml και τμχ, κόμμα, αρνητικό μόνο στις επιλογές", () => {
  assert.equal(parseRecipeQty("70", "mass"), 70_000);
  assert.equal(parseRecipeQty("0,5", "mass"), 500);
  assert.equal(parseRecipeQty("20", "volume"), 20);
  assert.equal(parseRecipeQty("1", "count"), 1);
  assert.equal(parseRecipeQty("-15", "volume", true), -15);
  for (const [raw, dim] of [["", "mass"], ["0", "mass"], ["abc", "mass"], ["1,5", "count"], ["-5", "mass"]] as const) {
    assert.throws(() => parseRecipeQty(raw, dim), SalesRecipeError);
  }
  assert.equal(formatRecipeQty(70_000, "mass"), "70 g");
  assert.equal(formatRecipeQty(1, "count"), "1 τμχ");
  assert.equal(recipeQtyInput(500, "mass"), "0,5");
});

test("κόστος: 70 g στα 6 €/kg = 42 λεπτά· τυπικό κόστος με 2 γεύσεις από υποχρεωτική ομάδα", () => {
  assert.equal(lineCost(70_000, 60_000, "mass"), 42);
  assert.equal(lineCost(1, 9_000, "count"), 0.09);
  // βάση 11 λεπτά (κύπελλο + κουτάλι), 2 γεύσεις με μέσο 42, σαντιγί προαιρετική εκτός
  assert.deepEqual(typicalCost(11, [{ kind: "REQUIRED", pick: 2, optionCosts: [40, 44, null] }, { kind: "OPTIONAL", pick: 1, optionCosts: [10] }]), { cents: 95, missingOptions: 1 });
});
