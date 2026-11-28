// Fixtures της παλιάς mrp-demand.test.ts, σε γραμμάρια.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecipeGraphNode } from "../recipe-graph.ts";
import { firmDemandFromBatches, firmDemandWithWholesale, wholesaleShortfall } from "./mrp-demand.ts";

// Βάση: 700 g γάλα + 300 g ζάχαρη · Γεύση: 900 g βάση + 100 g πάστα
const recipes: RecipeGraphNode[] = [
  { id: "r-base", name: "Βάση", batchGrams: 1000, outputGenericItemId: "base", items: [{ genericItemId: "milk", grams: 700 }, { genericItemId: "sugar", grams: 300 }] },
  { id: "r-flavor", name: "Γεύση", batchGrams: 1000, outputGenericItemId: "flavor", items: [{ genericItemId: "base", grams: 900 }, { genericItemId: "paste", grams: 100 }] },
];
const batch = (genericItemId: string, day: string, kg: number) => ({ genericItemId, day, grams: kg * 1000 });

test("χωρίς απόθεμα βάσης όλη η βάση σπάει· με 5 kg έτοιμη σπάνε μόνο τα 4 που λείπουν", () => {
  const none = firmDemandFromBatches(recipes, [batch("flavor", "2026-10-29", 10)], {}).firm["2026-10-29"]!;
  assert.deepEqual(none, { milk: 6300, sugar: 2700, paste: 1000 });
  const some = firmDemandFromBatches(recipes, [batch("flavor", "2026-10-29", 10)], { base: 5000 });
  assert.equal(some.firm["2026-10-29"]!.milk, 2800);
  assert.equal(some.firm["2026-10-29"]!.paste, 1000);
  assert.equal(some.usedChildStock.base, 5000);
});

test("το απόθεμα βάσης μοιράζεται με σειρά ημέρας, μία φορά", () => {
  const { firm } = firmDemandFromBatches(recipes, [batch("flavor", "2026-10-30", 10), batch("flavor", "2026-10-29", 10)], { base: 9000 });
  assert.equal(firm["2026-10-29"]!.milk ?? 0, 0);
  assert.equal(firm["2026-10-30"]!.milk, 6300);
});

test("προγραμματισμένη βάση την ίδια ημέρα τροφοδοτεί τη γεύση χωρίς διπλή μέτρηση· άλλη ημέρα δεν καλύπτει", () => {
  const same = firmDemandFromBatches(recipes, [batch("flavor", "2026-11-02", 10), batch("base", "2026-11-02", 9)], {});
  assert.deepEqual(same.firm["2026-11-02"], { milk: 6300, sugar: 2700, paste: 1000 });
  assert.equal(same.usedChildStock.base, undefined);
  assert.equal(firmDemandFromBatches(recipes, [batch("base", "2026-11-02", 5), batch("flavor", "2026-11-02", 10)], {}).firm["2026-11-02"]!.milk, 6300);
  const apart = firmDemandFromBatches(recipes, [batch("flavor", "2026-11-02", 10), batch("base", "2026-11-03", 9)], {}).firm;
  assert.deepEqual([apart["2026-11-02"]!.milk, apart["2026-11-03"]!.milk], [6300, 6300]);
});

test("χονδρική: πρώτα το απόθεμα, μετά παρτίδες ≤ ημέρας, το υπόλοιπο την προηγούμενη ημέρα", () => {
  const r = wholesaleShortfall([{ genericItemId: "flavor", day: "2026-11-06", grams: 10_000 }, { genericItemId: "flavor", day: "2026-11-08", grams: 8000 }], [batch("flavor", "2026-11-05", 3), batch("flavor", "2026-11-07", 4)], { flavor: 2000 }, "2026-11-04");
  assert.deepEqual(r.batches, [batch("flavor", "2026-11-05", 5), batch("flavor", "2026-11-07", 4)]);
  assert.equal(r.usedStock.flavor, 2000);
  assert.equal(r.usedPlanned.flavor, 7000);
  const old = wholesaleShortfall([{ genericItemId: "p", day: "2026-11-01", grams: 5 }, { genericItemId: "p", day: "2026-11-04", grams: 1 }], [], {}, "2026-11-04");
  assert.deepEqual(old.batches, [{ genericItemId: "p", day: "2026-11-04", grams: 1 }]);
});

test("η χονδρική χωρίζεται από τις παρτίδες και μοιράζεται το απόθεμα βάσης μία φορά· εμπορεύματα εξαιρούνται", () => {
  const { firm, wholesale } = firmDemandWithWholesale(recipes, [batch("flavor", "2026-11-05", 10)], [batch("flavor", "2026-11-05", 10)], { base: 9000 });
  assert.equal(firm["2026-11-05"]!.milk ?? 0, 0);
  assert.equal(firm["2026-11-05"]!.paste, 1000);
  assert.deepEqual(wholesale["2026-11-05"], { milk: 6300, sugar: 2700, paste: 1000 });
  const day = firmDemandFromBatches(recipes, [batch("flavor", "2026-10-29", 10)], {}, new Set(["sugar"])).firm["2026-10-29"]!;
  assert.equal(day.sugar, undefined);
  assert.equal(day.milk, 6300);
});
