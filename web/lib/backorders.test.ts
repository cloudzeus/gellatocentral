import assert from "node:assert/strict";
import test from "node:test";
import { creditAwaitedCents, lineValueCents, missingQty, orderStatus } from "./backorders.ts";

test("λείπουν = παραγγελία − ήρθαν − κλεισμένα, ποτέ αρνητικό", () => {
  assert.equal(missingQty({ orderedBaseQty: 30, receivedBaseQty: 18, closedBaseQty: 0 }), 12);
  assert.equal(missingQty({ orderedBaseQty: 20, receivedBaseQty: 12, closedBaseQty: 8 }), 0);
  assert.equal(missingQty({ orderedBaseQty: 5, receivedBaseQty: 6, closedBaseQty: 0 }), 0);
});

test("η παραγγελία ολοκληρώνεται όταν ήρθαν + πιστωτικό = παραγγελία", () => {
  const full = { orderedBaseQty: 40, receivedBaseQty: 40, closedBaseQty: 0 };
  const credited = { orderedBaseQty: 20, receivedBaseQty: 12, closedBaseQty: 8 };
  const waiting = { orderedBaseQty: 30, receivedBaseQty: 18, closedBaseQty: 0 };
  assert.equal(orderStatus([full, credited]), "RECEIVED");
  assert.equal(orderStatus([full, credited, waiting]), "PARTIAL");
  assert.equal(orderStatus([{ orderedBaseQty: 3, receivedBaseQty: 0, closedBaseQty: 0 }]), "SENT");
  // μόνο κλεισμένα χωρίς παραλαβή: ολοκληρωμένη, τίποτα δεν περιμένουμε
  assert.equal(orderStatus([{ orderedBaseQty: 3, receivedBaseQty: 0, closedBaseQty: 3 }]), "RECEIVED");
});

test("αξία ποσότητας όπως στο τιμολόγιο: 8 βούτυρα × 8,06 € + 24% ΦΠΑ", () => {
  // τεμάχια: κλίμακα κόστους 1000 → τιμή ανά 1000 τεμ.
  assert.equal(lineValueCents(8, { unitPriceCents: 806_000, discountBps: 0, vatRate: 24 }, 1000), 7996);
  assert.equal(lineValueCents(0, { unitPriceCents: 806_000, discountBps: 0, vatRate: 24 }, 1000), 0);
  // 10% έκπτωση πριν τον ΦΠΑ
  assert.equal(lineValueCents(10, { unitPriceCents: 100_000, discountBps: 1000, vatRate: 0 }, 1000), 900);
});

test("αναμένεται πιστωτικό όσο το 5.1 δεν καλύπτει το αίτημα", () => {
  assert.equal(creditAwaitedCents(8000, 0), 8000);
  assert.equal(creditAwaitedCents(8000, 8000), 0);
  assert.equal(creditAwaitedCents(8000, 9000), 0);
});
