// Tests για τη FEFO κατανομή παραγωγής (lib/production.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateFefo, fefoShortfall, nextBatchNumber, type LotStock } from "./production.ts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const lot = (id: string, expires: string | null, available: number): LotStock => ({ id, expiresAt: expires ? d(expires) : null, available });

test("FEFO: πρώτα η παρτίδα που λήγει νωρίτερα", () => {
  const lots = [lot("b", "2026-12-01", 100), lot("a", "2026-06-01", 50), lot("c", null, 500)];
  assert.deepEqual(allocateFefo(lots, 120), [
    { lotId: "a", qty: 50 },
    { lotId: "b", qty: 70 },
  ]);
  // η χύμα (χωρίς λήξη) πάει τελευταία
  assert.deepEqual(allocateFefo(lots, 650), [
    { lotId: "a", qty: 50 },
    { lotId: "b", qty: 100 },
    { lotId: "c", qty: 500 },
  ]);
});

test("FEFO: παρτίδες με μηδενικό υπόλοιπο αγνοούνται", () => {
  const lots = [lot("a", "2026-01-01", 0), lot("b", "2026-02-01", 30)];
  assert.deepEqual(allocateFefo(lots, 10), [{ lotId: "b", qty: 10 }]);
});

test("FEFO: ανεπαρκές απόθεμα → null και υπολογισμός ελλείμματος", () => {
  const lots = [lot("a", null, 40), lot("b", "2026-01-01", 10)];
  assert.equal(allocateFefo(lots, 60), null);
  assert.equal(fefoShortfall(lots, 60), 10);
  assert.equal(fefoShortfall(lots, 30), 0);
});

test("FEFO: άκυρη ποσότητα απορρίπτεται", () => {
  assert.throws(() => allocateFefo([], 0));
  assert.throws(() => allocateFefo([], 1.5));
});

test("αριθμός παρτίδας παραγωγής: YYYYMMDD-N", () => {
  assert.equal(nextBatchNumber(d("2026-11-20"), 1), "20261120-1");
  assert.equal(nextBatchNumber(d("2026-01-05"), 12), "20260105-12");
});
