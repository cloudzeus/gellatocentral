import assert from "node:assert/strict";
import test from "node:test";
import { expand, freeSeries, type Plan, planProblems, readiness, type ReadyInput, TEMPLATES } from "./store-setup.ts";

const shop = (): Plan => structuredClone(TEMPLATES.SHOP_TABLES.plan);

test("όλα τα πρότυπα είναι έγκυρα σχέδια", () => {
  for (const [k, t] of Object.entries(TEMPLATES)) assert.deepEqual(planProblems(t.plan), [], k);
});

test("expand: ονόματα με αριθμό μόνο όταν είναι πάνω από ένα, και το ταμείο πουλά από τη βιτρίνα", () => {
  const p = shop();
  p.zones.push({ name: "Πεζοδρόμιο", prefix: "Ε", count: 2, seats: 2 });
  const e = expand(p);
  assert.deepEqual(e.spaces.map((s) => s.name), ["Βιτρίνα παγωτού", "Καταψύκτης 1", "Καταψύκτης 2", "Ψυγείο", "Ξηρή αποθήκη"]);
  assert.equal(e.sellFrom, "Βιτρίνα παγωτού");
  assert.deepEqual(e.tills, [{ name: "Κεντρικό ταμείο", handheld: false }, { name: "Φορητό ταμείο", handheld: true }]);
  assert.deepEqual(e.tables.slice(-2).map((t) => [t.name, t.zone, t.seats, t.position]), [["Ε1", "Πεζοδρόμιο", 2, 8], ["Ε2", "Πεζοδρόμιο", 2, 9]]);
});

test("planProblems: ίδια ονόματα τραπεζιών, φορητά χωρίς τραπέζια, ταμείο χωρίς χώρο", () => {
  const p = shop();
  p.zones.push({ name: "Αυλή", prefix: "", count: 2, seats: 4 });
  assert.match(planProblems(p).join(), /ίδια ονόματα/);
  const v = structuredClone(TEMPLATES.VENDING.plan);
  v.handhelds = 1;
  assert.match(planProblems(v).join(), /φορητά ταμεία/);
  const empty = structuredClone(TEMPLATES.VENDING.plan);
  empty.spaces.vending = 0; empty.tills = 1;
  assert.match(planProblems(empty).join(), /τουλάχιστον έναν χώρο/);
  const big = shop(); big.spaces.freezer = 21;
  assert.match(planProblems(big).join(), /Έως 20/);
});

test("freeSeries: παραλείπει όσες υπάρχουν", () => {
  assert.deepEqual(freeSeries(["P1", "A1", null, "P3"], 3), ["P2", "P4", "P5"]);
});

test("readiness: τι λείπει, τι μετρά ως έτοιμο και πότε πουλά", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  const base: ReadyInput = {
    issuer: { name: "Η επιχείρηση", viva: true, mydata: true }, products: 12,
    tills: [{ id: "t1", name: "Κεντρικό ταμείο", series: "P1", vivaTerminalId: null, pairedAt: null, pairCodeLive: false }],
    printers: [{ id: "p1", name: "Εκτυπωτής αποδείξεων", role: "RECEIPTS", connection: "USB", address: null }, { id: "p2", name: "Εκτυπωτής παραγγελιών", role: "ORDERS", connection: "NETWORK", address: null }],
    coldDevices: [{ name: "Βιτρίνα", vending: false, tempMin: -14, tempMax: -11, lastReadingAt: new Date(now.getTime() - 60_000) }, { name: "Καταψύκτης", vending: false, tempMin: -22, tempMax: -18, lastReadingAt: null }],
    tables: 8, zones: 1,
  };
  const r = readiness(base, now);
  const tones = Object.fromEntries(r.groups.flatMap((g) => g.checks).map((c) => [c.key, c.tone]));
  assert.deepEqual(tones, { issuer: "ok", catalog: "ok", "pair-t1": "wait", "viva-t1": "bad", "printer-p1": "ok", "printer-p2": "wait", limits: "ok", sensors: "wait", tables: "ok" });
  assert.equal(r.total, 9);
  assert.equal(r.ok, 5);
  assert.equal(r.canSell, false);
  const paired = readiness({ ...base, tills: [{ ...base.tills[0], pairedAt: now }] }, now);
  assert.equal(paired.canSell, true);
  const vending = readiness({ ...base, tills: [], printers: [], tables: 0, zones: 0 }, now);
  assert.deepEqual(vending.groups.map((g) => g.key), ["cold"]);
});
