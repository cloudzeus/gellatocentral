import assert from "node:assert/strict";
import test from "node:test";
import { addAging, agingBucket, allocateCents, emptyAging, netFromGrossCents, productionCostProfiles, reportPeriod, signedDocument, splitStockCostCents, stockCostCents, type ProductionCostBatch, type ProductionCostItem } from "./reports.ts";

test("περίοδος αναφοράς: inclusive ημερομηνίες Αθήνας και DST", () => {
  const period = reportPeriod("2026-03-29", "2026-03-29");
  assert.equal(period.fromAt.toISOString(), "2026-03-28T22:00:00.000Z");
  assert.equal(period.toAt.toISOString(), "2026-03-29T21:00:00.000Z");
  assert.equal((period.toAt.getTime() - period.fromAt.getTime()) / 3_600_000, 23);
  assert.throws(() => reportPeriod("2026-02-02", "2026-02-01"));
  assert.throws(() => reportPeriod("2026-02-30", "2026-03-01"));
});

test("ΦΠΑ, πιστωτικό και πραγματική κλίμακα mg/ml/τεμαχίου", () => {
  assert.equal(netFromGrossCents(1240, 24), 1000);
  assert.equal(netFromGrossCents(1000, 0), 1000);
  assert.deepEqual(signedDocument({ docType: "5.1", netCents: 1000, vatCents: 240, totalCents: 1240 }), { netCents: -1000, vatCents: -240, totalCents: -1240 });
  assert.equal(stockCostCents(1_000_000, 400_000, "mass"), 4000);
  assert.equal(stockCostCents(1000, 400_000, "volume"), 4000);
  assert.equal(stockCostCents(1000, 400_000, "count"), 4000);
});

test("aging buckets και μη αρνητικά υπόλοιπα", () => {
  const at = new Date("2026-11-24T12:00:00Z");
  assert.equal(agingBucket(null, at), "current");
  assert.equal(agingBucket(new Date("2026-10-25T12:00:00Z"), at), "days1to30");
  assert.equal(agingBucket(new Date("2026-09-25T12:00:00Z"), at), "days31to60");
  const totals = addAging(emptyAging(), 500, new Date("2026-10-25T12:00:00Z"), at);
  assert.equal(totals.days1to30, 500);
  assert.throws(() => addAging(totals, -1, null, at));
});

test("επιμερισμός λεπτών: hand-computed αναλογία, largest remainder και σταθερές ισοπαλίες", () => {
  assert.deepEqual([...allocateCents(100, [{ id: "a", weight: 60 }, { id: "b", weight: 40 }])], [["a", 60], ["b", 40]]);
  // 5 × 1/3 = 1,666…: δύο υπόλοιπα λεπτά πάνε στα a,b με αλφαβητική ισοπαλία.
  assert.deepEqual([...allocateCents(5, [{ id: "c", weight: 1 }, { id: "a", weight: 1 }, { id: "b", weight: 1 }])].sort(), [["a", 2], ["b", 2], ["c", 1]]);
  assert.throws(() => allocateCents(1, [{ id: "a", weight: 0 }]));
  assert.throws(() => allocateCents(-1, [{ id: "a", weight: 1 }]));
});

test("κόστος γεύσης: 1.000 υλικά + 500 εργασία, 10% φύρα και πώληση 300 cents", () => {
  const batch: ProductionCostBatch = { id: "batch", outputLotId: "lot", costHundredths: 100_000, labourCostCents: 500, expectedQuantityGrams: 1000, quantityGrams: 900, wasteGrams: 100 };
  const profile = productionCostProfiles([batch], []).get("batch")!;
  // Φύρα: 100 υλικά + 50 εργασία. Πωλήσιμο: 900 υλικά + 450 εργασία + 150 φύρα = 1.500.
  assert.deepEqual(profile, { materialsCents: 900, labourCents: 450, wasteCents: 150 });
  assert.deepEqual(splitStockCostCents(300, profile), { materialsCents: 180, labourCents: 90, wasteCents: 30 });
  assert.deepEqual(splitStockCostCents(400), { materialsCents: 400, labourCents: 0, wasteCents: 0 });
});

test("κόστος γεύσης: ημιέτοιμο κληρονομεί components χωρίς διπλομέτρηση", () => {
  const batches: ProductionCostBatch[] = [
    { id: "child", outputLotId: "child-lot", costHundredths: 100_000, labourCostCents: 500, expectedQuantityGrams: 1000, quantityGrams: 900, wasteGrams: 100 },
    { id: "parent", outputLotId: "parent-lot", costHundredths: 60_000, labourCostCents: 100, expectedQuantityGrams: 2000, quantityGrams: 2000, wasteGrams: 0 },
  ];
  const items: ProductionCostItem[] = [{ id: "parent-item", batchId: "parent", lotId: "child-lot", costHundredths: 60_000 }];
  const profile = productionCostProfiles(batches, items).get("parent")!;
  // 600 cents ημιέτοιμου = 360 υλικά + 180 εργασία + 60 φύρα· +100 δική του εργασία.
  assert.deepEqual(profile, { materialsCents: 360, labourCents: 280, wasteCents: 60 });
  assert.equal(profile.materialsCents + profile.labourCents + profile.wasteCents, 700);
  assert.deepEqual(splitStockCostCents(70, profile), { materialsCents: 36, labourCents: 28, wasteCents: 6 });
});

test("κόστος γεύσης: δεν γίνεται επιμερισμός σε κυκλική ή μη έγκυρη παρτίδα", () => {
  const invalid: ProductionCostBatch = { id: "bad", outputLotId: "bad-lot", costHundredths: 100, labourCostCents: 0, expectedQuantityGrams: 100, quantityGrams: 90, wasteGrams: 200 };
  assert.throws(() => productionCostProfiles([invalid], []), /φύρα/);
  const cyclic: ProductionCostBatch = { ...invalid, id: "cycle", outputLotId: "cycle-lot", wasteGrams: 0, quantityGrams: 100 };
  assert.throws(() => productionCostProfiles([cyclic], [{ id: "cycle-item", batchId: "cycle", lotId: "cycle-lot", costHundredths: 100 }]), /Κυκλική/);
});
