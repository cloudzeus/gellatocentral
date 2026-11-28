import assert from "node:assert/strict";
import { test } from "node:test";
import { ConsumptionRuleError, countConsumption, explodeSale, spreadOverDays, type ExplodeGeneric, type ExplodeRecipe } from "./consumption-rules.ts";

const g = (id: string, extra: Partial<ExplodeGeneric> = {}): [string, ExplodeGeneric] => [id, { id, consumptionSource: "SALE", madeToOrder: false, trackStock: true, dimension: "mass", gramsPerPiece: null, ...extra }];
const generics = new Map([
  g("cup", { dimension: "count" }), g("spoon", { dimension: "count" }), g("sauce"),
  g("strawberry", { consumptionSource: "COUNT" }),
  g("crepe", { madeToOrder: true }), g("flour"), g("milk", { dimension: "volume" }), g("egg", { dimension: "count", gramsPerPiece: 55 }), g("butter"),
  g("tap", { trackStock: false }),
]);
const crepe: ExplodeRecipe = { id: "r-crepe", batchGrams: 1000, items: [{ genericItemId: "flour", grams: 300 }, { genericItemId: "milk", grams: 500 }, { genericItemId: "egg", grams: 165 }, { genericItemId: "butter", grams: 35 }] };

test("κατανάλωση απογραφής: φράουλα 4,0 + 5,0 − 3,2 − 0,3 = 5,5 kg", () => {
  assert.deepEqual(countConsumption({ expectedQty: 9_000_000, actualQty: 3_200_000, wasteQty: 300_000 }), { consumption: 5_500_000, waste: 300_000, needsReview: false, stockedOut: false });
  assert.equal(countConsumption({ expectedQty: 1_000, actualQty: 2_000, wasteQty: 0 }).needsReview, true);
  assert.equal(countConsumption({ expectedQty: 1_000, actualQty: 0, wasteQty: 0 }).stockedOut, true);
  assert.throws(() => countConsumption({ expectedQty: 1_000, actualQty: 0, wasteQty: 2_000 }), ConsumptionRuleError);
});

test("κύπελλο 2 μπάλες + topping: κύπελλο, κουτάλι, σάλτσα· η γεύση μένει θεωρητική", () => {
  const lines = [{ genericItemId: "cup", quantityBase: 1 }, { genericItemId: "spoon", quantityBase: 1 }, { genericItemId: "strawberry", quantityBase: 70_000 }, { genericItemId: "strawberry", quantityBase: 70_000 }, { genericItemId: "sauce", quantityBase: 20_000 }];
  const out = explodeSale(lines, 1, generics, new Map());
  assert.deepEqual(out.sort((a, b) => a.genericItemId.localeCompare(b.genericItemId)), [
    { genericItemId: "cup", quantity: 1, theoretical: false },
    { genericItemId: "sauce", quantity: 20_000, theoretical: false },
    { genericItemId: "spoon", quantity: 1, theoretical: false },
    { genericItemId: "strawberry", quantity: 140_000, theoretical: true },
  ]);
});

test("επιλογή με αρνητική γραμμή αφαιρεί από το βασικό· μη παρακολουθούμενο είδος παραλείπεται", () => {
  const out = explodeSale([{ genericItemId: "sauce", quantityBase: 20_000 }, { genericItemId: "sauce", quantityBase: -20_000 }, { genericItemId: "tap", quantityBase: 100 }, { genericItemId: "cup", quantityBase: 1 }], 3, generics, new Map());
  assert.deepEqual(out, [{ genericItemId: "cup", quantity: 3, theoretical: false }]);
});

test("κρέπα (φτιάχνεται τη στιγμή) σπάει σε αλεύρι, γάλα, αυγά, βούτυρο", () => {
  const out = explodeSale([{ genericItemId: "crepe", quantityBase: 200_000 }], 2, generics, new Map([["crepe", crepe]]));
  const by = new Map(out.map((r) => [r.genericItemId, r.quantity]));
  assert.equal(by.get("flour"), 120_000); // 400 g κρέπας × 300/1000 = 120 g = 120.000 mg
  assert.equal(by.get("milk"), 200); // ml
  assert.equal(by.get("egg"), 1); // 66 g ÷ 55 g ≈ 1 αυγό
  assert.equal(by.get("butter"), 14_000);
  assert.equal(by.has("crepe"), false);
});

test("κύκλος σε συνταγή «φτιάχνεται τη στιγμή» απορρίπτεται", () => {
  const loop = new Map([g("a", { madeToOrder: true }), g("b", { madeToOrder: true })]);
  const recipes = new Map<string, ExplodeRecipe>([["a", { id: "ra", batchGrams: 100, items: [{ genericItemId: "b", grams: 100 }] }], ["b", { id: "rb", batchGrams: 100, items: [{ genericItemId: "a", grams: 100 }] }]]);
  assert.throws(() => explodeSale([{ genericItemId: "a", quantityBase: 1000 }], 1, loop, recipes), (e: unknown) => e instanceof ConsumptionRuleError && e.code === "RECIPE_CYCLE");
});

test("μοίρασμα κατανάλωσης σε ημέρες χωρίς απογραφή: βάρη από πωλήσεις, αλλιώς ισόποσα, χωρίς απώλεια", () => {
  assert.deepEqual([...spreadOverDays(1000, [{ day: "a", weight: 1 }, { day: "b", weight: 3 }])], [["a", 250], ["b", 750]]);
  const equal = spreadOverDays(1001, [{ day: "a", weight: 0 }, { day: "b", weight: 0 }]);
  assert.equal([...equal.values()].reduce((s, v) => s + v, 0), 1001);
});
