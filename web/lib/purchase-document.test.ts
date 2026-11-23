import assert from "node:assert/strict";
import test from "node:test";
import { calculatePurchaseDocument, calculatePurchaseLine, documentParty, partySnapshot } from "./purchase-document.ts";

test("γραμμή: αρχική αξία, έκπτωση, καθαρή αξία, ΦΠΑ και τελικό σύνολο σε λεπτά", () => {
  assert.deepEqual(calculatePurchaseLine({ quantity: 3, unitPriceCents: 1_005, discountBps: 1_250, vatRate: 24 }), {
    quantity: 3, unitPriceCents: 1_005, discountBps: 1_250, vatRate: 24,
    grossCents: 3_015, discountCents: 377, netCents: 2_638, vatCents: 633, totalCents: 3_271,
  });
});

test("παραστατικό: ανάλυση ΦΠΑ και έξοδα συμμετέχουν στο σωστό συντελεστή", () => {
  const total = calculatePurchaseDocument([
    { quantity: 2, unitPriceCents: 1_000, discountBps: 1_000, vatRate: 13 },
    { quantity: 1, unitPriceCents: 500, discountBps: 0, vatRate: 24 },
  ], { shippingCostCents: 300, otherExpensesCents: 200, expensesVatRate: 24 });
  assert.equal(total.grossCents, 2_500);
  assert.equal(total.discountCents, 200);
  assert.equal(total.netCents, 2_300);
  assert.equal(total.vatCents, 234 + 120);
  assert.equal(total.chargesNetCents, 500);
  assert.equal(total.chargesVatCents, 120);
  assert.equal(total.totalNetCents, 2_800);
  assert.equal(total.totalVatCents, 474);
  assert.equal(total.totalCents, 3_274);
  assert.deepEqual(total.vat, [
    { vatRate: 24, netCents: 1_000, vatCents: 240, totalCents: 1_240 },
    { vatRate: 13, netCents: 1_800, vatCents: 234, totalCents: 2_034 },
  ]);
});

test("στρογγυλοποίηση γίνεται ανά γραμμή, όχι μία φορά στο σύνολο", () => {
  const total = calculatePurchaseDocument([
    { quantity: 1, unitPriceCents: 1, discountBps: 0, vatRate: 13 },
    { quantity: 1, unitPriceCents: 1, discountBps: 0, vatRate: 13 },
  ]);
  assert.equal(total.vatCents, 0);
  assert.equal(total.totalCents, 2);
});

test("snapshot: ανεξάρτητο αντίγραφο και ασφαλής ανάγνωση άγνωστου Json", () => {
  const source = { name: "Προμηθευτής ΑΕ", vatNumber: "123456789", address: "Οδός 1" };
  const snapshot = partySnapshot(source);
  source.name = "Νέα επωνυμία";
  assert.equal(snapshot.name, "Προμηθευτής ΑΕ");
  assert.equal(snapshot.vatNumber, "123456789");
  assert.equal(documentParty({ name: "Παλιά επωνυμία", vatNumber: 123 }, snapshot).name, "Παλιά επωνυμία");
  assert.equal(documentParty({ name: "Παλιά επωνυμία", vatNumber: 123 }, snapshot).vatNumber, null);
  assert.equal(documentParty(null, snapshot), snapshot);
});
