import assert from "node:assert/strict";
import { test } from "node:test";
import { affectedScheduleEmployeeIds, hourlyCostCents, intervalsOverlap, shiftsForEmployee, workedMinutes } from "./staff.ts";

test("προσωπικό: καθαρός χρόνος και αμοιβή σε λεπτά", () => {
  assert.equal(workedMinutes(new Date("2026-11-23T08:00:00Z"), new Date("2026-11-23T16:30:00Z"), 30), 480);
  assert.equal(hourlyCostCents(480, 750), 6000);
  assert.throws(() => workedMinutes(new Date("2026-11-23T08:00:00Z"), new Date("2026-11-23T08:30:00Z"), 30));
  assert.throws(() => hourlyCostCents(-1, 750));
});

test("προσωπικό: overlap χωρίς σύγκρουση σε διαδοχικά άκρα", () => {
  const a = { startsAt: new Date("2026-11-23T08:00:00Z"), endsAt: new Date("2026-11-23T12:00:00Z") };
  assert.equal(intervalsOverlap(a, { startsAt: new Date("2026-11-23T11:00:00Z"), endsAt: new Date("2026-11-23T15:00:00Z") }), true);
  assert.equal(intervalsOverlap(a, { startsAt: new Date("2026-11-23T12:00:00Z"), endsAt: new Date("2026-11-23T15:00:00Z") }), false);
});

test("προσωπικό: public snapshot μόνο για τον κάτοχο του token", () => {
  const snapshot = { shifts: [{ id: "a", employeeId: "own", startsAt: "x", endsAt: "y", breakMinutes: 0, note: null, departmentName: null, storeName: null }, { id: "b", employeeId: "other", startsAt: "x", endsAt: "y", breakMinutes: 0, note: null, departmentName: null, storeName: null }] };
  assert.deepEqual(shiftsForEmployee(snapshot, "own").map((row) => row.id), ["a"]);
  assert.deepEqual(shiftsForEmployee({ private: true }, "own"), []);
});

test("προσωπικό: notifications μόνο σε added/removed/changed, όχι σε ανέγγιχτους", () => {
  const row = (id: string, employeeId: string, startsAt = "2026-11-24T08:00:00Z") => ({ id, employeeId, startsAt, endsAt: "2026-11-24T16:00:00Z", breakMinutes: 0, note: null, departmentName: null, storeName: null });
  const previous = { shifts: [row("same", "same"), row("changed", "changed"), row("removed", "removed")] };
  const next = { shifts: [row("same", "same"), row("changed", "changed", "2026-11-24T09:00:00Z"), row("added", "added")] };
  assert.deepEqual(affectedScheduleEmployeeIds(previous, next), ["added", "changed", "removed"]);
  assert.deepEqual(affectedScheduleEmployeeIds(previous, previous), []);
});
