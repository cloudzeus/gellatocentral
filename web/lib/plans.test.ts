import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedPermissions, moduleOfPath, pathOpen } from "./modules.ts";
import { chargeFor, monthlyPreview, pauseDaysLeft, pauseSettlement, storeMonthly } from "./plans.ts";

const plan = { storeCents: 5900, devicePrices: { POS_WEB: 1500, POS_ANDROID: 2000, FRIDGE: 300 }, pausePercent: 30 };
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const pause = (startedAt: string, endedAt: string | null, settledThrough: string | null = null, maxDays = 240) => ({ id: "p1", startedAt: d(startedAt), endedAt: endedAt ? d(endedAt) : null, settledThrough: settledThrough ? d(settledThrough) : null, maxDays });

test("τιμή καταστήματος = κατάστημα + συσκευές ανά είδος", () => {
  assert.deepEqual(storeMonthly(plan, ["POS_WEB", "POS_ANDROID", "FRIDGE", "SCALE"]), { storeCents: 5900, devicesCents: 3800, fullCents: 9700 });
  assert.equal(storeMonthly(plan, []).fullCents, 5900);
});

test("παύση κάτω από 30 ημέρες δεν δίνει έκπτωση", () => {
  assert.deepEqual(pauseSettlement(pause("2026-11-01", "2026-11-20"), d("2026-12-01"), d("2027-01-01")), { deltaDays: 0, through: null });
  // συνεχίζεται αλλά είναι ακόμα στη 10η ημέρα
  assert.equal(pauseSettlement(pause("2026-11-21", null), d("2026-12-01"), d("2027-01-01")).deltaDays, 0);
});

test("παύση που συνεχίζεται 30+ ημέρες: έκπτωση από την πρώτη ημέρα ως το τέλος της περιόδου", () => {
  const r = pauseSettlement(pause("2026-10-15", null), d("2026-12-01"), d("2027-01-01"));
  assert.equal(r.deltaDays, 78); // 15/10 → 1/1
  assert.deepEqual(r.through, d("2027-01-01"));
  // στην επόμενη χρέωση δίνονται μόνο οι νέες ημέρες
  assert.equal(pauseSettlement(pause("2026-10-15", null, "2027-01-01"), d("2027-01-01"), d("2027-02-01")).deltaDays, 31);
});

test("άνοιξε νωρίτερα από όσο είχε προπληρωθεί: οι ημέρες χρεώνονται πίσω", () => {
  const r = pauseSettlement(pause("2026-10-15", "2026-12-10", "2027-01-01"), d("2027-01-01"), d("2027-02-01"));
  assert.equal(r.deltaDays, -22); // 10/12 → 1/1
  assert.deepEqual(r.through, d("2026-12-10"));
});

test("όριο ημερών έκπτωσης ανά παύση", () => {
  assert.equal(pauseSettlement(pause("2026-01-01", null, null, 100), d("2026-09-01"), d("2026-10-01")).deltaDays, 100);
});

test("χρέωση μήνα με ένα ανοιχτό και ένα κατάστημα σε παύση", () => {
  const c = chargeFor(plan, [
    { id: "a", name: "Αθήνα", deviceKinds: ["POS_WEB"], pauses: [] },
    { id: "t", name: "Τήνος", deviceKinds: ["POS_WEB"], pauses: [pause("2026-10-01", null, "2026-12-01")] },
  ], d("2026-12-01"), d("2027-01-01"));
  assert.equal(c.lines[0].cents, 7400);
  assert.equal(c.lines[1].pauseDays, 31);
  assert.equal(c.lines[1].discountCents, Math.round(((7400 * 12) / 365) * 0.7 * 31)); // 70% έκπτωση για 31 ημέρες
  assert.equal(c.totalCents, 7400 + 7400 - c.lines[1].discountCents);
  assert.deepEqual(c.settled, [{ pauseId: "p1", through: d("2027-01-01") }]);
});

test("ένας πλήρης χρόνος σε παύση κοστίζει περίπου το ποσοστό του πακέτου", () => {
  const full = 7400, days = 365;
  const discount = Math.round(((full * 12) / 365) * 0.7 * days);
  assert.equal(full * 12 - discount, Math.round(full * 12 * 0.3));
});

test("τρέχουσα μηνιαία εικόνα και υπόλοιπο ημερών παύσης", () => {
  const m = monthlyPreview(plan, [{ id: "a", name: "Α", deviceKinds: ["POS_WEB"], paused: false }, { id: "t", name: "Τ", deviceKinds: [], paused: true }]);
  assert.equal(m.totalCents, 7400 + 1770);
  assert.equal(m.fullCents, 7400 + 5900);
  assert.equal(pauseDaysLeft(240, [{ startedAt: d("2026-01-01"), endedAt: d("2026-04-11") }], d("2026-12-01")), 140);
  assert.equal(pauseDaysLeft(240, [{ startedAt: d("2025-01-01"), endedAt: d("2025-06-01") }], d("2026-12-01")), 240); // παλιότερη από 12 μήνες δεν μετρά
});

test("ενότητες πακέτου: κλείνουν δικαιώματα και σελίδες", () => {
  const role = ["dashboard.read", "pos.use", "receipts.read", "users.read", "billing.read"];
  assert.deepEqual(allowedPermissions(role, ["receipts"]), ["receipts.read", "users.read", "billing.read"]); // χρήστες και συνδρομή πάντα ανοιχτά
  assert.equal(moduleOfPath("/pos"), "pos");
  assert.equal(moduleOfPath("/"), "dashboard");
  assert.equal(moduleOfPath("/billing"), null);
  assert.equal(pathOpen("/customers/abc", ["pos"]), false);
  assert.equal(pathOpen("/support", []), true);
});

test("ημέρες παύσης πριν αρχίσει η χρέωση (δωρεάν δοκιμή) δεν δίνουν έκπτωση", () => {
  // παύση από 1/10, πρώτη χρεώσιμη ημέρα 16/12, περίοδος ως 16/1
  const r = pauseSettlement(pause("2026-10-01", null), d("2026-11-17"), d("2027-01-16"), d("2026-12-16"));
  assert.equal(r.deltaDays, 31);
  assert.deepEqual(r.through, d("2027-01-16"));
});

test("έκπτωση μεγαλύτερη από τον μήνα: το υπόλοιπο μεταφέρεται ως πιστωτικό", () => {
  const one = [{ id: "t", name: "Τήνος", deviceKinds: [] as string[], pauses: [pause("2026-10-01", null)] }];
  const c = chargeFor(plan, one, d("2026-12-01"), d("2027-01-01")); // 92 ημέρες έκπτωσης μαζί: 2 μήνες που πληρώθηκαν ολόκληροι + ο επόμενος
  assert.equal(c.totalCents, 0);
  assert.equal(c.carryCents, Math.round(((5900 * 12) / 365) * 0.7 * 92) - 5900);
  const next = chargeFor(plan, [{ ...one[0], pauses: [pause("2026-10-01", null, "2027-01-01")] }], d("2027-01-01"), d("2027-02-01"), undefined, c.carryCents);
  assert.equal(next.totalCents, 0); // ο Ιανουάριος σε παύση κοστίζει λιγότερο από το πιστωτικό που έμεινε
  assert.ok(next.carryCents > 0 && next.carryCents < c.carryCents);
});
