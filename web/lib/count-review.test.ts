import assert from "node:assert/strict";
import { test } from "node:test";
import { countReview, countReviewTotals, type CountReviewLine } from "./count-review.ts";

const kg = (n: number) => Math.round(n * 1_000_000);
const line = (id: string, expected: number, actual: number | null, waste = 0, extra: Partial<CountReviewLine> = {}): CountReviewLine => ({
  genericItemId: id, name: id, dimension: "mass", consumptionSource: "COUNT", expectedQty: kg(expected), actualQty: actual === null ? null : kg(actual), wasteQty: kg(waste), consumptionQty: null, unitCostHundredths: 60_000, ...extra,
});

test("απογραφή βιτρίνας: κατανάλωση, απόκλιση από πωλήσεις, εξάντληση, εκκρεμότητα, παρτίδες ενωμένες", () => {
  const items = countReview([
    line("pistachio", 6.9, 1.8, 0.2), // 4,9 kg έναντι 4,76 → +2,9%
    line("kaimaki", 2.8, 1.1, 0.6), // 1,1 kg έναντι 0,84 → +31%
    line("strawberry", 1.2, 0), // τελείωσε
    line("vanilla", 1.9, null), // δεν μετρήθηκε
    line("choc", 3, 1), line("choc", 4.55, 1.05), // δύο παρτίδες: 5,5 kg
    line("cup", 100, 90, 0, { consumptionSource: "SALE", dimension: "count" }), // είδος SALE: εκτός
  ], new Map([["pistachio", kg(4.76)], ["kaimaki", kg(0.84)], ["strawberry", kg(1.26)], ["choc", kg(6.5)]]));
  const by = Object.fromEntries(items.map((i) => [i.genericItemId, i]));
  assert.equal(items.length, 5);
  assert.deepEqual([by.pistachio!.consumption, by.pistachio!.deviationPct, by.pistachio!.status], [kg(4.9), 2.9, "ok"]);
  assert.deepEqual([by.kaimaki!.deviationPct, by.kaimaki!.status], [31, "high"]);
  assert.equal(by.strawberry!.status, "stockout");
  assert.equal(by.vanilla!.status, "pending");
  assert.deepEqual([by.choc!.consumption, by.choc!.status], [kg(5.5), "low"]);
  const totals = countReviewTotals(items);
  assert.equal(totals.consumption, kg(4.9 + 1.1 + 1.2 + 5.5));
  assert.equal(totals.pending, 1);
  // η φράουλα (εξάντληση) δεν μπαίνει στη σύγκριση: (4,9+1,1+5,5) έναντι (4,76+0,84+6,5)
  assert.equal(totals.deviationPct, -5);
});

test("οριστικοποιημένη γραμμή: κρατά τη γραμμένη κατανάλωση", () => {
  const [item] = countReview([line("x", 5, 2, 0, { consumptionQty: kg(2.5) })], new Map([["x", kg(2.5)]]));
  assert.deepEqual([item!.consumption, item!.deviationPct, item!.status], [kg(2.5), 0, "ok"]);
});
