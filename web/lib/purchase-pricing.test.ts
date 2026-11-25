// Tests για τον κανόνα ανάλυσης τιμής αγοράς (lib/pricing.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePrice, priceCheck, reviewReceiptPrice, shouldWritePrice, type PriceLine } from "./purchase-pricing.ts";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const catalog = (priceCents: number, from: string): PriceLine => ({ priceCents, minPackQty: null, validFrom: d(from), validTo: null });

test("μόνο τιμοκατάλογος: η τελευταία τιμή πριν την ημερομηνία", () => {
  const lines = [catalog(100, "2026-01-01"), catalog(120, "2026-06-01")];
  assert.equal(resolvePrice(lines, 1, d("2026-03-01"))?.priceCents, 100);
  assert.equal(resolvePrice(lines, 1, d("2026-11-20"))?.priceCents, 120);
});

test("συμφωνία ποσότητας: κερδίζει μόνο πάνω από το ελάχιστο", () => {
  const lines = [catalog(100, "2026-01-01"), { priceCents: 85, minPackQty: 50, validFrom: d("2026-01-01"), validTo: null }];
  assert.equal(resolvePrice(lines, 10, d("2026-11-20"))?.priceCents, 100); // κάτω από το όριο
  assert.equal(resolvePrice(lines, 50, d("2026-11-20"))?.priceCents, 85); // ακριβώς στο όριο
  assert.equal(resolvePrice(lines, 200, d("2026-11-20"))?.priceCents, 85);
});

test("συμφωνία διαστήματος: εντός ισχύει, εκτός πέφτει στον τιμοκατάλογο", () => {
  const lines = [catalog(100, "2026-01-01"), { priceCents: 90, minPackQty: null, validFrom: d("2026-12-01"), validTo: d("2026-12-31") }];
  assert.equal(resolvePrice(lines, 1, d("2026-12-15"))?.priceCents, 90);
  assert.equal(resolvePrice(lines, 1, d("2027-01-15"))?.priceCents, 100);
});

test("ποσότητα ΚΑΙ διάστημα κερδίζει το καθένα χωριστά", () => {
  const lines = [
    catalog(100, "2026-01-01"),
    { priceCents: 95, minPackQty: 10, validFrom: d("2026-01-01"), validTo: null }, // μόνο ποσότητα
    { priceCents: 92, minPackQty: null, validFrom: d("2026-11-01"), validTo: d("2026-11-30") }, // μόνο διάστημα
    { priceCents: 85, minPackQty: 50, validFrom: d("2026-11-01"), validTo: d("2026-11-30") }, // και τα δύο
  ];
  assert.equal(resolvePrice(lines, 60, d("2026-11-20"))?.priceCents, 85); // η πλήρης συμφωνία
  assert.equal(resolvePrice(lines, 20, d("2026-11-20"))?.priceCents, 92); // ποσότητα vs διάστημα: ισοπαλία ειδικότητας → η νεότερη
  assert.equal(resolvePrice(lines, 5, d("2026-11-20"))?.priceCents, 92); // μόνο διάστημα
  assert.equal(resolvePrice(lines, 60, d("2026-12-05"))?.priceCents, 95); // έληξε το διάστημα
});

test("ισοπαλία ειδικότητας: κερδίζει η νεότερη validFrom", () => {
  const lines = [catalog(100, "2026-01-01"), catalog(110, "2026-05-01")];
  assert.equal(resolvePrice(lines, 1, d("2026-11-20"))?.priceCents, 110);
});

test("ληγμένη συμφωνία δεν σέρνει την τιμή της: fallback στην τελευταία άνευ όρων", () => {
  const lines = [catalog(100, "2026-01-01"), { priceCents: 80, minPackQty: 10, validFrom: d("2026-02-01"), validTo: d("2026-03-01") }];
  assert.equal(resolvePrice(lines, 20, d("2026-06-01"))?.priceCents, 100);
});

test("χωρίς καμία γραμμή ή χωρίς άνευ όρων: undefined (αναγκαστική συμπλήρωση)", () => {
  assert.equal(resolvePrice([], 1, d("2026-11-20")), undefined);
  const onlyDeals: PriceLine[] = [{ priceCents: 80, minPackQty: 10, validFrom: d("2026-02-01"), validTo: d("2026-03-01") }];
  assert.equal(resolvePrice(onlyDeals, 5, d("2026-06-01")), undefined);
});

// ---- Έλεγχος τιμολογίου έναντι συμφωνίας ----

test("χωρίς γνωστή τιμή: ο έλεγχος είναι ουδέτερος και η τιμή γράφεται (πρώτη αγορά)", () => {
  const c = priceCheck(100, [], 10, d("2026-11-20"));
  assert.equal(c.expectedCents, undefined);
  assert.equal(c.agreement, false);
  assert.equal(shouldWritePrice(c), true);
});

test("ίδια τιμή με τον τιμοκατάλογο: χωρίς διαφορά, τίποτα δεν γράφεται", () => {
  const c = priceCheck(120, [catalog(100, "2026-01-01"), catalog(120, "2026-06-01")], 1, d("2026-11-20"));
  assert.deepEqual(c, { expectedCents: 120, agreement: false, diffCents: 0 });
  assert.equal(shouldWritePrice(c), false);
});

test("αλλαγή τιμής τιμοκαταλόγου: εντοπίζεται και γράφεται νέα τιμή", () => {
  const c = priceCheck(135, [catalog(120, "2026-06-01")], 1, d("2026-11-20"));
  assert.deepEqual(c, { expectedCents: 120, agreement: false, diffCents: 15 });
  assert.equal(shouldWritePrice(c), true);
});

test("τιμή εκτός συμφωνίας: εντοπίζεται αλλά η συμφωνία ΔΕΝ ξαναγράφεται", () => {
  const lines: PriceLine[] = [catalog(100, "2026-01-01"), { priceCents: 85, minPackQty: 50, validFrom: d("2026-01-01"), validTo: null }];
  const c = priceCheck(90, lines, 60, d("2026-11-20")); // χρέωσε 90 αντί 85 της συμφωνίας
  assert.deepEqual(c, { expectedCents: 85, agreement: true, diffCents: 5 });
  assert.equal(shouldWritePrice(c), false);
});

test("τιμή σύμφωνη με τη συμφωνία: κανένας συναγερμός, καμία εγγραφή", () => {
  const lines: PriceLine[] = [catalog(100, "2026-01-01"), { priceCents: 85, minPackQty: 50, validFrom: d("2026-01-01"), validTo: null }];
  const c = priceCheck(85, lines, 60, d("2026-11-20"));
  assert.equal(c.diffCents, 0);
  assert.equal(c.agreement, true);
  assert.equal(shouldWritePrice(c), false);
});

test("κάτω από το ελάχιστο της συμφωνίας: συγκρίνεται με τον τιμοκατάλογο", () => {
  const lines: PriceLine[] = [catalog(100, "2026-01-01"), { priceCents: 85, minPackQty: 50, validFrom: d("2026-01-01"), validTo: null }];
  const c = priceCheck(100, lines, 10, d("2026-11-20")); // 10 < 50: δεν ισχύει η συμφωνία
  assert.deepEqual(c, { expectedCents: 100, agreement: false, diffCents: 0 });
});

// ---- Τιμολογιακός έλεγχος παραλαβής ----

const KG = 1_000_000;

test("παραλαβή: η κανονικοποιημένη τιμή συμφωνεί με την ειδική συμφωνία", () => {
  const result = reviewReceiptPrice({ unitPriceCents: 1000 }, KG, { priceCents: 1000, contentQty: KG });
  assert.deepEqual(result, { basis: "AGREEMENT", kind: null, expectedPriceCents: 1000, actualPriceCents: 1000 });
});

test("παραλαβή: κάθε απόκλιση από την ειδική συμφωνία καταγράφεται, χωρίς όριο 5%", () => {
  const result = reviewReceiptPrice({ unitPriceCents: 1001 }, KG, { priceCents: 1000, contentQty: KG });
  assert.equal(result.basis, "AGREEMENT");
  assert.equal(result.kind, "AGREEMENT_MISMATCH");
  assert.equal(result.expectedPriceCents, 1000);
  assert.equal(result.actualPriceCents, 1001);
});

test("παραλαβή: ακριβώς 5% αύξηση από προηγούμενη αγορά δεν είναι discrepancy", () => {
  const result = reviewReceiptPrice(
    { unitPriceCents: 1050 }, KG, undefined,
    { unitPriceCents: 2000, packQty: 2, contentQty: KG },
  );
  assert.deepEqual(result, { basis: "PREVIOUS_PURCHASE", kind: null, expectedPriceCents: 1000, actualPriceCents: 1050 });
});

test("παραλαβή: αύξηση αυστηρά άνω του 5% είναι discrepancy μετά κανονικοποίηση συσκευασίας", () => {
  const result = reviewReceiptPrice(
    { unitPriceCents: 1051 }, KG, undefined,
    { unitPriceCents: 2000, packQty: 2, contentQty: KG },
  );
  assert.deepEqual(result, { basis: "PREVIOUS_PURCHASE", kind: "PRICE_INCREASE", expectedPriceCents: 1000, actualPriceCents: 1051 });
});

test("παραλαβή: μείωση τιμής δεν είναι discrepancy", () => {
  const result = reviewReceiptPrice(
    { unitPriceCents: 900 }, KG, undefined,
    { unitPriceCents: 1000, packQty: 1, contentQty: KG },
  );
  assert.equal(result.kind, null);
  assert.equal(result.basis, "PREVIOUS_PURCHASE");
});

test("παραλαβή: χωρίς συμφωνία ή προηγούμενη αγορά δεν εφευρίσκεται σύγκριση", () => {
  assert.deepEqual(
    reviewReceiptPrice({ unitPriceCents: 1000 }, KG),
    { basis: "NO_BASELINE", kind: null, expectedPriceCents: null, actualPriceCents: null },
  );
});
