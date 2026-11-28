import assert from "node:assert/strict";
import { test } from "node:test";
import { allocate, assertNoCycle, checkShares, CostCenterError, overlaps } from "./cost-centers-rules.ts";

const sum = (m: Map<string, number>) => [...m.values()].reduce((t, v) => t + v, 0);
const d = (s: string) => new Date(`${s}T00:00:00Z`);

test("ενοίκιο 1.000,00 € με 50/30/20 → 500/300/200", () => {
  const r = allocate(100_000, "FIXED", [{ costCenterId: "a", weight: 5000 }, { costCenterId: "b", weight: 3000 }, { costCenterId: "c", weight: 2000 }], []);
  assert.deepEqual([...r.cents], [["a", 50_000], ["b", 30_000], ["c", 20_000]]);
});

test("1.000,01 € σε τρία ίσα αθροίζει ακριβώς", () => {
  const r = allocate(100_001, "EQUAL", [], ["a", "b", "c"]);
  assert.equal(sum(r.cents), 100_001);
  assert.ok([...r.cents.values()].every((c) => c === 33_333 || c === 33_334));
});

test("τζίρος: αναλογικά· μηδενικός τζίρος παντού → ισόποσα με προειδοποίηση", () => {
  const r = allocate(1000, "REVENUE", [], ["a", "b"], new Map([["a", 300], ["b", 100]]));
  assert.deepEqual([...r.cents], [["a", 750], ["b", 250]]);
  const z = allocate(1000, "REVENUE", [], ["a", "b"], new Map());
  assert.deepEqual([...z.cents], [["a", 500], ["b", 500]]);
  assert.match(z.warning!, /ισόποσα/);
});

test("μερίδια: άθροισμα 100%, διπλό κέντρο, μερίδια σε βάση που δεν τα παίρνει", () => {
  assert.throws(() => checkShares("FIXED", [{ costCenterId: "a", weight: 5000 }, { costCenterId: "b", weight: 4000 }]), /100%/);
  assert.throws(() => checkShares("FIXED", [{ costCenterId: "a", weight: 5000 }, { costCenterId: "a", weight: 5000 }]), /δύο φορές/);
  assert.throws(() => checkShares("REVENUE", [{ costCenterId: "a", weight: 1 }]), CostCenterError);
  assert.doesNotThrow(() => checkShares("AREA", [{ costCenterId: "a", weight: 40 }, { costCenterId: "b", weight: 85 }]));
});

test("περίοδοι: επικάλυψη, συνεχόμενες, ανοιχτή λήξη", () => {
  assert.equal(overlaps({ validFrom: d("2026-01-01"), validTo: d("2026-06-30") }, { validFrom: d("2026-06-30"), validTo: null }), true);
  assert.equal(overlaps({ validFrom: d("2026-01-01"), validTo: d("2026-06-30") }, { validFrom: d("2026-07-01"), validTo: null }), false);
  assert.equal(overlaps({ validFrom: d("2026-07-01"), validTo: null }, { validFrom: d("2027-01-01"), validTo: null }), true);
  assert.throws(() => overlaps({ validFrom: d("2026-07-01"), validTo: d("2026-06-01") }, { validFrom: d("2027-01-01"), validTo: null }), /πριν από την έναρξη/);
});

test("ιεραρχία: κύκλος απορρίπτεται", () => {
  const parentOf = new Map<string, string | null>([["10", null], ["10.1", "10"]]);
  assert.throws(() => assertNoCycle("10", "10.1", parentOf), /εαυτό του/);
  assert.throws(() => assertNoCycle("10", "10", parentOf), /εαυτό του/);
  assert.doesNotThrow(() => assertNoCycle("20", "10", parentOf));
});
