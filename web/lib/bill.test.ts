import assert from "node:assert/strict";
import test from "node:test";
import { type BillLineState, billStage, billTotals, canVoid, isSettled, pickDue, remaining } from "./bill.ts";

const line = (id: string, quantity: number, price: number, paid: [number, BillLineState["saleLines"][number]["sale"]["status"]][] = [], voided = false): BillLineState => ({
  id, quantity, unitPriceCents: price, voidedAt: voided ? new Date() : null,
  saleLines: paid.map(([q, status]) => ({ quantity: q, sale: { status } })),
});

test("ανοιχτός λογαριασμός χωρίς πληρωμές χρωστάει όλα εκτός από τα ακυρωμένα", () => {
  const lines = [line("a", 2, 320), line("b", 1, 280), line("c", 1, 320, [], true)];
  assert.deepEqual(billTotals(lines), { totalCents: 920, paidCents: 0, dueCents: 920, pendingCents: 0 });
  assert.equal(isSettled(lines), false);
});

test("μερική πληρωμή γραμμής: 1 από 3 πληρώθηκε, 1 περιμένει, 1 μένει", () => {
  const l = line("a", 3, 320, [[1, "COMPLETED"], [1, "AWAITING_PAYMENT"], [1, "DRAFT"]]);
  assert.equal(remaining(l), 1); // η πρόχειρη (αποτυχημένη) προσπάθεια δεν δεσμεύει
  assert.deepEqual(billTotals([l]), { totalCents: 960, paidCents: 320, dueCents: 320, pendingCents: 320 });
  assert.equal(canVoid(l), false);
});

test("κλείνει μόνο όταν όλα πληρώθηκαν ή ακυρώθηκαν, όχι όσο περιμένει πληρωμή", () => {
  assert.equal(isSettled([line("a", 2, 100, [[2, "AWAITING_PAYMENT"]])]), false);
  assert.equal(isSettled([line("a", 2, 100, [[1, "COMPLETED"], [1, "COMPLETED"]]), line("b", 1, 50, [], true)]), true);
});

test("ακύρωση μόνο σε γραμμή που δεν άγγιξε απόδειξη", () => {
  assert.equal(canVoid(line("a", 1, 100)), true);
  assert.equal(canVoid(line("a", 1, 100, [[1, "DRAFT"]])), true);
  assert.equal(canVoid(line("a", 1, 100, [[1, "COMPLETED"]])), false);
  assert.equal(canVoid(line("a", 1, 100, [], true)), false);
});

test("μοίρασμα ανά είδη: παίρνει όσα διάλεξε, όχι περισσότερα από όσα μένουν", () => {
  const due = [{ l: { id: "a" }, q: 3 }, { l: { id: "b" }, q: 1 }];
  assert.deepEqual(pickDue(due, [{ lineId: "a", quantity: 1 }]), [{ l: { id: "a" }, q: 1 }]);
  assert.deepEqual(pickDue(due, [{ lineId: "a", quantity: 2 }, { lineId: "a", quantity: 1 }, { lineId: "b", quantity: 1 }]), [{ l: { id: "a" }, q: 3 }, { l: { id: "b" }, q: 1 }]);
  assert.equal(pickDue(due, [{ lineId: "a", quantity: 4 }]), null); // άλλη συσκευή πλήρωσε στο μεταξύ
  assert.equal(pickDue(due, [{ lineId: "x", quantity: 1 }]), null); // πληρωμένη ή ακυρωμένη γραμμή
});

test("«Μετά»: γραμμή που περιμένει δεν χρωστιέται, δεν πληρώνεται και κρατά τον λογαριασμό ανοιχτό", () => {
  const held = { ...line("d", 1, 650), round: { held: true } };
  const lines = [line("a", 1, 280, [[1, "COMPLETED"]]), held];
  assert.deepEqual(billTotals(lines), { totalCents: 280, paidCents: 280, dueCents: 0, pendingCents: 0 });
  assert.equal(remaining(held), 0);
  assert.equal(canVoid(held), true); // ακυρώνεται πριν βγει
  assert.equal(isSettled(lines), false);
});

test("στάδιο τραπεζιού: παρήγγειλαν → τρώνε → λογαριασμός, με την τελευταία κίνηση", () => {
  const opened = new Date("2026-11-28T18:00:00Z");
  const sent = new Date("2026-11-28T18:05:00Z");
  const served = new Date("2026-11-28T18:12:00Z");
  const round = { held: false, sentAt: sent };
  const waiting = [{ voidedAt: null, servedAt: null, round }];
  assert.deepEqual(billStage({ openedAt: opened, billAskedAt: null }, waiting), { stage: "ordered", lastAt: sent, heldItems: 0, unserved: 1, readyIds: [], readySince: null, kitchenSince: null });
  const eating = [{ voidedAt: null, servedAt: served, round }, { voidedAt: null, servedAt: null, round: { held: true, sentAt: sent } }];
  assert.deepEqual(billStage({ openedAt: opened, billAskedAt: null }, eating), { stage: "eating", lastAt: served, heldItems: 1, unserved: 0, readyIds: [], readySince: null, kitchenSince: null });
  assert.equal(billStage({ openedAt: opened, billAskedAt: served }, eating).stage, "asked");
  assert.equal(billStage({ openedAt: opened, billAskedAt: null }, []).stage, "empty");
});

test("έτοιμο από την κουζίνα και ακόμα στην κουζίνα", () => {
  const opened = new Date(2026, 10, 28, 21, 0), sent = new Date(2026, 10, 28, 21, 5), ready = new Date(2026, 10, 28, 21, 12);
  const r = { held: false, sentAt: sent };
  const s = billStage({ openedAt: opened, billAskedAt: null }, [
    { id: "a", voidedAt: null, servedAt: null, readyAt: ready, station: "KITCHEN", round: r },
    { id: "b", voidedAt: null, servedAt: null, readyAt: null, station: "BAR", round: r },
    { id: "c", voidedAt: null, servedAt: null, readyAt: null, station: null, round: r }, // παγωτό από τη βιτρίνα: δεν είναι «στην κουζίνα»
  ]);
  assert.deepEqual([s.readyIds, s.readySince, s.kitchenSince], [["a"], ready, sent]);
});
