import assert from "node:assert/strict";
import { test } from "node:test";
import { athensDayRange, baseQuantityToGrams, prepareProductionDayClose, type DayClosePlanInput } from "./production-day-close.ts";
import type { RecipeGraphNode } from "./recipe-graph.ts";

const recipes: RecipeGraphNode[] = [
  { id: "base", name: "Βάση", batchGrams: 1000, outputGenericItemId: "base-item", items: [{ genericItemId: "raw", grams: 1000 }] },
  { id: "final", name: "Τελικό", batchGrams: 2000, outputGenericItemId: "final-item", items: [{ genericItemId: "base-item", grams: 500 }, { genericItemId: "raw", grams: 1500 }] },
];
const plan = (overrides: Partial<DayClosePlanInput> = {}): DayClosePlanInput => ({ id: "plan-1", recipeId: "final", quantityGrams: 2000, actualQuantityGrams: 1800, scrapReason: "Φύρα", ...overrides });

test("day close: παράγει μόνο το missing ημιέτοιμο και εκτελεί παιδί πριν από γονέα", () => {
  const jobs = prepareProductionDayClose(recipes, [plan()], [{ genericItemId: "base-item", baseQuantity: 200_000, dimension: "mass" }]);
  assert.deepEqual(jobs.map((job) => [job.key, job.expectedQuantityGrams, job.actualQuantityGrams]), [["auto:base", 300, 300], ["plan:plan-1", 2000, 1800]]);
  assert.deepEqual(jobs[1]?.leafGenericItemIds, ["base-item"]);
  assert.equal(jobs[0]?.automatic, true);
  assert.equal(jobs[1]?.automatic, false);
});

test("day close: ρητή υποσυνταγή καλύπτει ζήτηση χωρίς duplicate auto batch", () => {
  const jobs = prepareProductionDayClose(recipes, [plan({ id: "base-plan", recipeId: "base", quantityGrams: 1000, actualQuantityGrams: 900 }), plan({ id: "final-plan", actualQuantityGrams: 2000 })], []);
  assert.deepEqual(jobs.map((job) => job.key), ["plan:base-plan", "plan:final-plan"]);
  assert.equal(jobs.some((job) => job.automatic), false);
});

test("day close: αθροίζει ζήτηση πολλών γονέων και κάνει clamp στο μηδέν", () => {
  const jobs = prepareProductionDayClose(recipes, [plan({ id: "p1" }), plan({ id: "p2" })], [{ genericItemId: "base-item", baseQuantity: 2_000_000, dimension: "mass" }]);
  assert.deepEqual(jobs.map((job) => job.key), ["plan:p1", "plan:p2"]);
});

test("day close: mass lots αθροίζονται πριν από τη μετατροπή σε ακέραια γραμμάρια", () => {
  const jobs = prepareProductionDayClose(recipes, [plan()], [
    { genericItemId: "base-item", baseQuantity: 250_000, dimension: "mass" },
    { genericItemId: "base-item", baseQuantity: 250_000, dimension: "mass" },
  ]);
  assert.equal(jobs[0]?.key, "plan:plan-1");
  assert.equal(jobs.some((job) => job.automatic), false);
});

test("day close: count conversion απαιτεί βάρος τεμαχίου", () => {
  assert.equal(baseQuantityToGrams({ baseQuantity: 3, dimension: "count", gramsPerPiece: 55 }), 165);
  assert.throws(() => baseQuantityToGrams({ baseQuantity: 3, dimension: "count" }), /βάρος τεμαχίου/);
});

test("day close: κυκλική αναφορά απορρίπτεται", () => {
  const cyclic: RecipeGraphNode[] = [
    { id: "a", name: "A", batchGrams: 100, outputGenericItemId: "a-item", items: [{ genericItemId: "b-item", grams: 100 }] },
    { id: "b", name: "B", batchGrams: 100, outputGenericItemId: "b-item", items: [{ genericItemId: "a-item", grams: 100 }] },
  ];
  assert.throws(() => prepareProductionDayClose(cyclic, [plan({ recipeId: "a", quantityGrams: 100, actualQuantityGrams: 100 })], []), /Κυκλική/);
});

test("day close: επιχειρησιακή ημέρα Αθήνας και θερινή ώρα", () => {
  const winter = athensDayRange("2026-11-24");
  assert.equal(winter.start.toISOString(), "2026-11-23T22:00:00.000Z");
  assert.equal(winter.end.toISOString(), "2026-11-24T22:00:00.000Z");
  const summer = athensDayRange("2026-07-01");
  assert.equal(summer.start.toISOString(), "2026-06-30T21:00:00.000Z");
  assert.equal(summer.end.toISOString(), "2026-07-01T21:00:00.000Z");
  assert.throws(() => athensDayRange("2026-02-30"), /Άκυρη/);
});
