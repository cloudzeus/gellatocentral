import assert from "node:assert/strict";
import { test } from "node:test";
import { busyTables, fits, isoDay, nextByTable, type Reservation, slots, untilText } from "./reservations.ts";

const r = (id: string, tableId: string | null, h: number, m: number, status: Reservation["status"] = "BOOKED", guests = 4): Reservation => ({
  id, tableId, tableName: tableId, startsAt: new Date(2026, 10, 26, h, m).toISOString(), durationMin: 90, guests,
  name: id, phone: null, note: null, status, billId: null, phase: "later",
});
const at = (h: number, m = 0) => new Date(2026, 10, 26, h, m);

test("ώρες: ανά 30′ από 12:00, χωρίς όσες πέρασαν", () => {
  assert.equal(slots("2026-11-27", at(20)).length, 24);
  const today = slots("2026-11-26", at(20, 10));
  assert.equal(today[0].getHours(), 20); // 20:00 μένει: πέρασαν μόνο 10′
  assert.equal(today.at(-1)!.getMinutes(), 30);
});

test("πιασμένα τραπέζια: μόνο ενεργές κρατήσεις που επικαλύπτονται", () => {
  const all = [r("a", "t1", 20, 0), r("b", "t2", 18, 0), r("c", "t3", 21, 0, "NO_SHOW"), r("d", "t4", 21, 0, "SEATED")];
  assert.deepEqual([...busyTables(all, at(21, 0))].sort(), ["t1", "t4"]);
  assert.deepEqual([...busyTables(all, at(21, 30))], ["t4"]); // η 20:00 τελειώνει 21:30
});

test("χωράει η παρέα: μετρά άτομα σε ενεργές κρατήσεις", () => {
  const all = [r("a", "t1", 20, 0, "BOOKED", 6), r("b", null, 20, 30, "BOOKED", 4), r("c", "t2", 20, 0, "CANCELLED", 8)];
  assert.equal(fits(all, 12, at(20), 2), true);
  assert.equal(fits(all, 12, at(20), 3), false);
  assert.equal(fits(all, 12, at(22, 30), 12), true);
});

test("επόμενη κράτηση ανά τραπέζι και κείμενα", () => {
  const next = nextByTable([r("a", "t1", 20, 0, "SEATED"), r("b", "t1", 22, 0), r("c", "t1", 23, 0)]);
  assert.equal(next.get("t1")?.id, "b");
  assert.equal(untilText(at(20, 30).toISOString(), at(20, 15)), "σε 15′");
  assert.equal(untilText(at(21, 35).toISOString(), at(20, 15)), "σε 1 ώ 20′");
  assert.equal(untilText(at(20, 0).toISOString(), at(20, 12)), "αργεί 12′");
  assert.equal(isoDay(at(23, 50), 1), "2026-11-27");
});
