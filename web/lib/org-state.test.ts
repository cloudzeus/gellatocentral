import assert from "node:assert/strict";
import { test } from "node:test";
import { canDelete, orgState } from "./org-state.ts";

const now = new Date("2026-12-10T10:00:00Z");
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const base = { suspendedAt: null, closingAt: null, deleteAfter: null, subscription: { status: "ACTIVE", currentPeriodEnd: d("2026-12-30") } };

test("ενεργή συνδρομή: όλα ανοιχτά", () => assert.deepEqual(orgState(base, now), { kind: "ok", restricted: false, daysLeft: null }));
test("χωρίς συνδρομή ακόμα: δεν κλειδώνει", () => assert.equal(orgState({ ...base, subscription: null }, now).restricted, false));
test("έληξε πριν από 3 ημέρες: περίοδος χάριτος, όλα ανοιχτά", () => {
  const s = orgState({ ...base, subscription: { status: "PAST_DUE", currentPeriodEnd: d("2026-12-07") } }, now);
  assert.equal(s.kind, "grace"); assert.equal(s.restricted, false); assert.equal(s.daysLeft, 4);
});
test("έληξε πριν από 8 ημέρες: περιορισμένη λειτουργία", () => assert.deepEqual(orgState({ ...base, subscription: { status: "PAST_DUE", currentPeriodEnd: d("2026-12-02") } }, now), { kind: "unpaid", restricted: true, daysLeft: null }));
test("δοκιμή που έληξε μετρά όπως η ληξιπρόθεσμη, ακόμα κι αν δεν έτρεξε ο έλεγχος", () => assert.equal(orgState({ ...base, subscription: { status: "TRIALING", currentPeriodEnd: d("2026-11-20") } }, now).kind, "unpaid"));
test("ακυρωμένη: περιορισμένη αμέσως", () => assert.equal(orgState({ ...base, subscription: { status: "CANCELLED", currentPeriodEnd: d("2026-12-30") } }, now).kind, "unpaid"));
test("αναστολή υπερισχύει της πληρωμένης συνδρομής", () => assert.equal(orgState({ ...base, suspendedAt: d("2026-12-01") }, now).kind, "suspended"));
test("κλείσιμο υπερισχύει όλων και μετρά ημέρες ως τη διαγραφή", () => {
  const s = orgState({ ...base, suspendedAt: d("2026-12-01"), closingAt: d("2026-12-05"), deleteAfter: d("2027-01-04") }, now);
  assert.equal(s.kind, "closing"); assert.equal(s.daysLeft, 25);
});
test("διαγραφή μόνο μετά την προθεσμία", () => {
  assert.equal(canDelete({ closingAt: d("2026-11-01"), deleteAfter: d("2026-12-01") }, now), true);
  assert.equal(canDelete({ closingAt: d("2026-12-05"), deleteAfter: d("2027-01-04") }, now), false);
  assert.equal(canDelete({ closingAt: null, deleteAfter: null }, now), false);
});
