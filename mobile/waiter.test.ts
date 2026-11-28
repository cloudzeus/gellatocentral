import assert from "node:assert/strict";
import test from "node:test";
import type { BillLine, BillSummary } from "./api.ts";
import { durText, seatDue, seatPick, seatsOf, urgentList } from "./waiter.ts";

const euro = (c: number) => `${c}`;
const now = new Date("2026-11-28T20:00:00Z");
const bill = (id: string, x: Partial<BillSummary>): BillSummary => ({ id, tableId: id, label: null, guests: 2, openedAt: "2026-11-28T19:00:00Z", openedByName: null, totalCents: 1000, paidCents: 0, dueCents: 1000, pendingCents: 0, heldCents: 0, items: 2, ...x });
const line = (id: string, seat: number | null, remaining: number, price = 100): BillLine => ({ id, roundId: "r", productId: "p", name: id, quantity: remaining, unitPriceCents: price, vatRate: 13, options: null, note: null, voidedAt: null, voidReason: null, remaining, paid: 0, canVoid: true, seat });

test("σε περιμένουν: λογαριασμός πρώτα, μετά κράτηση, «Μετά» που περιμένει, ήσυχο τραπέζι", () => {
  const tables = [{ id: "a", name: "1", zone: null, seats: 2 }, { id: "b", name: "2", zone: null, seats: 2 }, { id: "c", name: "3", zone: null, seats: 2 }, { id: "d", name: "4", zone: null, seats: 4 }];
  const bills = [
    bill("a", { stage: "eating", lastAt: "2026-11-28T19:50:00Z", heldItems: 1 }),
    bill("b", { stage: "eating", lastAt: "2026-11-28T19:30:00Z" }),
    bill("c", { stage: "asked", billAskedAt: "2026-11-28T19:57:00Z", billAskedCash: true }),
  ];
  const res = [{ id: "r1", tableId: "d", status: "BOOKED", startsAt: "2026-11-28T20:16:00Z", guests: 4 }] as never;
  const u = urgentList(bills, tables, res, now, euro);
  assert.deepEqual(u.map((x) => x.kind), ["asked", "reservation", "held", "quiet"]);
  assert.equal(u[0].sub, "1000 · μετρητά στο ταμείο");
  assert.equal(u[1].sub, "4 άτομα · σε 16′");
  assert.equal(u[3].title, "Τ2 · 30′ χωρίς κίνηση");
});

test("έτοιμο από την κουζίνα: πρώτο, πάνω κι από τον λογαριασμό", () => {
  const tables = [{ id: "a", name: "5", zone: null, seats: 2 }, { id: "c", name: "3", zone: null, seats: 2 }];
  const bills = [bill("c", { stage: "asked", billAskedAt: "2026-11-28T19:57:00Z" }), bill("a", { stage: "ordered", lastAt: "2026-11-28T19:55:00Z", readyIds: ["l1", "l2", "l3"], readySince: "2026-11-28T19:58:00Z" })];
  const u = urgentList(bills, tables, [], now, euro);
  assert.deepEqual(u.map((x) => x.kind), ["ready", "asked"]);
  assert.deepEqual([u[0].title, u[0].sub, u[0].since], ["Τ5 · Έτοιμο στην κουζίνα", "3 είδη", 2]);
});

test("θέσεις: ό,τι μένει ανά θέση και η επιλογή πληρωμής της θέσης", () => {
  const lines = [line("x", 1, 2), line("y", 2, 1, 650), line("z", null, 1, 200), line("w", 1, 0)];
  assert.deepEqual([...seatDue(lines)], [[1, 200], [2, 650], [0, 200]]);
  assert.deepEqual(seatPick(lines, 1), [{ lineId: "x", quantity: 2 }]);
  assert.deepEqual(seatPick(lines, 0), [{ lineId: "z", quantity: 1 }]);
  assert.equal(seatsOf({ guests: 2, lines }, 4), 2);
  assert.equal(seatsOf({ guests: null, lines: [line("q", 3, 1)] }, 2), 3);
});

test("durText: λεπτά, ώρες, μέρες", () => {
  assert.equal(durText(25), "25′");
  assert.equal(durText(125), "2 ώ 05′");
  assert.equal(durText(2741), "1 μέρα");
  assert.equal(durText(4000), "2 μέρες");
});
