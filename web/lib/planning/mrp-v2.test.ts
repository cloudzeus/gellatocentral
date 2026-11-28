// Fixtures των παλιών mrp.test.ts / mrp-sporadic.test.ts (τα kg εδώ ως ακέραια g όπου μετρά η ακρίβεια).
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays } from "./production-suggest.ts";
import { learnedSafety, mrpV2Suggestion, resolveLeadDays, reviewPeriodDays, sporadicUsage, supplierLeadDays, usageStats, weekdayProfile } from "./mrp-v2.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("χρόνος παράδοσης: διάμεσος ανά προμηθευτή, ≥ 1· ιστορικό με ≥ 3 παραγγελίες υπερισχύει του χειροκίνητου", () => {
  const history = [
    { supplierId: "a", orderId: "1", orderDay: "2026-10-01", receivedDay: "2026-10-02" },
    { supplierId: "a", orderId: "2", orderDay: "2026-10-05", receivedDay: "2026-10-06" },
    { supplierId: "a", orderId: "3", orderDay: "2026-10-10", receivedDay: "2026-10-18" },
    { supplierId: "a", orderId: "3", orderDay: "2026-10-10", receivedDay: "2026-10-20" }, // ίδια παραγγελία: ένα δείγμα
    { supplierId: "b", orderId: "4", orderDay: "2026-10-10", receivedDay: "2026-10-10" },
  ];
  assert.deepEqual(supplierLeadDays(history), { a: 1, b: 1 });
  const r = resolveLeadDays(history, { a: 5, b: 4, c: 3 });
  assert.deepEqual(r.days, { a: 1, b: 4, c: 3 });
  assert.deepEqual(r.source, { a: "history", b: "manual", c: "manual" });
  assert.equal(reviewPeriodDays("2026-11-02", [4]), 3); // Δευτέρα → Πέμπτη
  assert.equal(reviewPeriodDays("2026-11-02", []), 0);
});

test("ασφάλεια που μαθαίνεται: στατιστικά, μεγαλύτερη ημέρα, χειροκίνητο με λίγο ιστορικό, σποραδικό όριο, ευαλλοίωτα", () => {
  const st = usageStats({ "2026-10-28": 2, "2026-10-26": 4 }, "2026-10-28", 4);
  assert.deepEqual([st.avgDaily, st.maxDaily, st.usageDays], [1.5, 4, 2]);
  close(st.sdDaily, Math.sqrt(11 / 3));
  assert.ok(learnedSafety(usageStats({ "2026-10-27": 1200, "2026-10-20": 1200, "2026-10-13": 1200, "2026-10-06": 1200 }, "2026-10-28", 28), 1, 0).value >= 1200);
  assert.deepEqual(learnedSafety(usageStats({ "2026-10-27": 100 }, "2026-10-28", 28), 1, 80), { value: 80, source: "manual" });
  assert.deepEqual(learnedSafety(usageStats({}, "2026-10-28", 28), 1, 500), { value: 500, source: "manual" });
  const meringue = learnedSafety(usageStats({ "2026-10-05": 90, "2026-10-12": 90 }, "2026-10-28", 28), 2, 200);
  assert.equal(meringue.capped, true);
  close(meringue.value, 90);
  const cream = learnedSafety(usageStats({ "2026-10-07": 806.45, "2026-10-15": 1612.9, "2026-10-25": 1612.9 }, "2026-10-28", 28), 2, 2500);
  close(cream.value, 1612.9);
  const stats = { avgDaily: 20, sdDaily: 21, maxDaily: 53, usageDays: 15 };
  assert.equal(learnedSafety(stats, 1, 42, true).value, 40);
  assert.equal(learnedSafety(stats, 1, 42, false).value, 53);
});

test("σποραδική χρήση: διάμεσος με ≥ 3 ημέρες, αλλιώς η τελευταία, εκτός παραθύρου τίποτα", () => {
  const today = "2026-11-10";
  const ago = (m: Record<number, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [addDays(today, -Number(k)), v]));
  const u = sporadicUsage(ago({ 2: 1, 9: 3, 16: 2 }), today, 28);
  assert.deepEqual(u, { typical: 2, lastUsage: 1, lastUsageDate: addDays(today, -2), usageDays: 3 });
  assert.equal(sporadicUsage(ago({ 3: 1.5, 20: 4 }), today, 28).typical, 1.5);
  assert.deepEqual(sporadicUsage(ago({ 40: 2 }), today, 28), { typical: 0, lastUsage: 0, lastUsageDate: null, usageDays: 0 });
});

test("MRP v2: σταθερή χρήση 500/ημέρα, Σάββατο διπλό, βέβαιη ζήτηση και ασφάλεια", () => {
  const today = "2026-11-02"; // Δευτέρα
  const usage: Record<string, number> = {};
  for (let i = 1; i <= 56; i++) { const d = addDays(today, -i); usage[d] = new Date(`${d}T00:00:00Z`).getUTCDay() === 6 ? 1000 : 500; }
  const profile = weekdayProfile(usage, addDays(today, -1))!;
  close(profile[5]! / profile[0]!, 2); // Σάββατο / Δευτέρα
  const r = mrpV2Suggestion({ today, onHandBaseQty: 1000, usageByDay: usage, leadDays: 1, coverDays: 4, firmByDay: { [today]: 3000 } });
  assert.equal(r.mode, "regular");
  assert.equal(r.horizonDays, 5);
  assert.equal(r.firmBaseQty, 3000);
  // Δευ 3000 (βέβαιη) + Τρι–Παρ 4 × (μ.ο. 571 × συντελεστής καθημερινής 0,875 = 500)
  assert.ok(Math.abs(r.forecastBaseQty - 5000) <= 1);
  assert.equal(r.safetyBaseQty, 1000); // η μεγαλύτερη ημέρα (σ μικρό)
  assert.ok(r.suggestedBaseQty > 0);
  const sporadic = mrpV2Suggestion({ today, onHandBaseQty: 0, usageByDay: { [addDays(today, -5)]: 700 }, coverDays: 4, manualMinBaseQty: 100 });
  assert.equal(sporadic.mode, "sporadic");
  assert.equal(sporadic.forecastBaseQty, 700);
  assert.equal(sporadic.safetyBaseQty, 100);
});
