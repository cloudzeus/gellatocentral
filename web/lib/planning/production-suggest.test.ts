// Fixtures της παλιάς plan-suggest.test.ts, σε mg (1 kg = 1.000.000).
import assert from "node:assert/strict";
import { test } from "node:test";
import { breakdownLine, censoredDemand, containersLabel, coverageDays, isProductionDay, nextProductionDay, productionWeekdays, suggestProduction, type DemandEstimate } from "./production-suggest.ts";

const KG = 1_000_000;
const fmt = (v: number) => (Math.round(v / KG * 10) / 10).toFixed(1).replace(".", ",");
const est = (kg: number, extra: Partial<DemandEstimate> = {}): DemandEstimate => ({ avg: Math.round(kg * KG), samples: 4, stockouts: 0, lowerBound: false, ...extra });

test("λογοκριμένη ζήτηση: η ημέρα εξάντλησης μετρά τουλάχιστον όσο ο μέσος όρος των υπόλοιπων", () => {
  assert.equal(censoredDemand([{ consumption: 6 * KG, stockout: false }, { consumption: 4 * KG, stockout: false }]).avg, 5 * KG);
  const d = censoredDemand([{ consumption: 6 * KG, stockout: false }, { consumption: 4 * KG, stockout: false }, { consumption: 3 * KG, stockout: true }, { consumption: 7 * KG, stockout: true }]);
  assert.equal(d.avg, (6 + 4 + 5 + 7) / 4 * KG);
  assert.equal(d.stockouts, 2);
  assert.equal(d.lowerBound, false);
  const all = censoredDemand([{ consumption: 3 * KG, stockout: true }, { consumption: 5 * KG, stockout: true }]);
  assert.deepEqual([all.avg, all.lowerBound], [4 * KG, true]);
  assert.equal(censoredDemand([{ consumption: -2 * KG, stockout: false }]).avg, 0);
  assert.equal(censoredDemand([]).samples, 0);
});

test("ημέρες παραγωγής από το ιστορικό: Δευτέρα–Παρασκευή, η Παρασκευή καλύπτει το Σαββατοκύριακο", () => {
  const dates: string[] = [];
  for (let w = 1; w <= 4; w++) for (let d = 0; d < 5; d++) dates.push(new Date(Date.UTC(2026, 10, 9 - w * 7 + d)).toISOString().slice(0, 10));
  const wd = productionWeekdays(dates, "2026-11-09");
  assert.deepEqual(wd, [1, 2, 3, 4, 5]);
  assert.equal(nextProductionDay("2026-11-13", wd), "2026-11-16");
  assert.deepEqual(coverageDays("2026-11-13", wd), ["2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.deepEqual(coverageDays("2026-11-10", wd), ["2026-11-10"]);
  assert.equal(isProductionDay("2026-11-14", wd), false);
  assert.equal(productionWeekdays(["2026-11-02"], "2026-11-09"), null);
  assert.deepEqual(coverageDays("2026-11-13", null), ["2026-11-13"]);
  assert.equal(isProductionDay("2026-11-14", null), true);
});

test("μ.ο. − απόθεμα + χονδρική + ελάχιστο → καραπίνες, με κανονική φύρα στο μίγμα", () => {
  const s = suggestProduction({ dimension: "mass", shopDays: [{ day: "2026-11-10", demand: est(6.2) }], shopStock: 1.8 * KG, minShowcase: KG, wholesale: [{ day: "2026-11-10", qty: 3 * KG }], labStock: 0, alreadyPlanned: 0, lossPct: 4, containerCap: 4.5 * KG, containerName: "Καραπίνα" });
  assert.equal(s.need, 8_400_000);
  assert.equal(s.containers, 2);
  assert.equal(s.output, 9 * KG);
  assert.equal(s.mix, 9_380_000); // 9 ÷ 0,96 = 9,375 → 9,38 kg
  assert.equal(breakdownLine(s, fmt, "kg"), "μ.ο. Τρίτης 6,2 kg − απόθεμα 1,8 + ελάχιστο βιτρίνας 1,0 + χονδρική 3,0 → 2 καραπίνες (9,0 kg) · μίγμα 9,4 kg (φύρα 4,0%)");
});

test("το έτοιμο του εργαστηρίου και το ήδη προγραμματισμένο αφαιρούνται· το απόθεμα καταστήματος δεν καλύπτει χονδρική", () => {
  const s = suggestProduction({ dimension: "mass", shopDays: [{ day: "2026-11-10", demand: est(5) }], shopStock: KG, minShowcase: 0, wholesale: [], labStock: 1.5 * KG, alreadyPlanned: KG, lossPct: 0 });
  assert.equal(s.need, 1.5 * KG);
  assert.equal(s.containers, null);
  assert.deepEqual(s.parts.map((p) => p.key), ["avg", "stock", "lab", "planned"]);
  assert.equal(suggestProduction({ dimension: "mass", shopDays: [{ day: "2026-11-10", demand: est(2) }], shopStock: 10 * KG, minShowcase: 0, wholesale: [{ day: "2026-11-10", qty: 4 * KG }], labStock: 0, alreadyPlanned: 0, lossPct: 0 }).need, 4 * KG);
});

test("τίποτα δεν χρειάζεται → 0· Παρασκευή με τρεις ημέρες και κύκλους· τεμάχια ακέραια", () => {
  const none = suggestProduction({ dimension: "mass", shopDays: [{ day: "2026-11-10", demand: est(2) }], shopStock: 5 * KG, minShowcase: 0, wholesale: [], labStock: 3 * KG, alreadyPlanned: 0, lossPct: 5, containerCap: 5 * KG });
  assert.deepEqual([none.output, none.mix, none.containers], [0, 0, null]);
  assert.match(breakdownLine(none, fmt, "kg"), /δεν χρειάζεται/);
  const fri = suggestProduction({ dimension: "mass", shopDays: [{ day: "2026-11-13", demand: est(5) }, { day: "2026-11-14", demand: est(8, { stockouts: 1 }) }, { day: "2026-11-15", demand: est(7) }], shopStock: 2 * KG, minShowcase: 0, wholesale: [{ day: "2026-11-14", qty: 3 * KG }], labStock: 0, alreadyPlanned: 0, lossPct: 0, batchCap: 12 * KG });
  assert.deepEqual([fri.need, fri.cycles, fri.stockouts], [21 * KG, 2, 1]);
  const pcs = suggestProduction({ dimension: "count", shopDays: [{ day: "2026-11-10", demand: { avg: 10, samples: 4, stockouts: 0, lowerBound: false } }], shopStock: 3, minShowcase: 0, wholesale: [], labStock: 0, alreadyPlanned: 0, lossPct: 0 });
  assert.deepEqual([pcs.output, pcs.mix], [7, 7]);
  assert.equal(containersLabel(1, null), "1 καραπίνα");
  assert.equal(containersLabel(2, "Καραπίνα"), "2 καραπίνες");
  assert.equal(containersLabel(2, "Λεκάνη 5L"), "2 × Λεκάνη 5L");
});
