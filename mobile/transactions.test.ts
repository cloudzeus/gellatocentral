import assert from "node:assert/strict";
import { test } from "node:test";
import { hourly, matches, summary, type Tx } from "./transactions.ts";

const tx = (o: Partial<Tx>): Tx => ({ kind: "sale", id: "x", at: new Date(2026, 10, 26, 13, 10).toISOString(), label: "A3 · 1", cents: 0, state: "paid", method: "Κάρτα", cash: false, card: null, table: null, note: null, mark: null, lines: [], pays: [], refundable: true, creditId: null, ...o });

test("σύνολα: κάρτα και μετρητά από τις πληρωμές, χωρίς χρεώσεις που περιμένουν στο POS", () => {
  const rows = [
    tx({ cents: 630, pays: [{ cash: false, cents: 630 }] }),
    tx({ cents: 3000, pays: [{ cash: true, cents: 1000 }, { cash: false, cents: 2000 }] }),
    tx({ cents: 400, state: "pos", pays: [] }),
    tx({ kind: "credit", cents: -550, state: "refunded" }),
    tx({ kind: "share", cents: 500, pays: [{ cash: true, cents: 500 }] }),
  ];
  const s = summary(rows);
  assert.equal(s.cardCents, 2630);
  assert.equal(s.cashCents, 1500);
  assert.equal(s.incomeCents, 4130);
  assert.equal(s.receipts, 2);
  assert.equal(s.avgCents, 1815);
  assert.deepEqual([s.refundCents, s.refundCount], [-550, 1]);
  assert.deepEqual(summary([]).avgCents, 0);
});

test("ανά ώρα: 09–21 τουλάχιστον, η πιο γεμάτη ώρα και η τρέχουσα", () => {
  const rows = [tx({ pays: [{ cash: false, cents: 630 }] }), tx({ at: new Date(2026, 10, 26, 8, 5).toISOString(), pays: [{ cash: true, cents: 100 }] })];
  const h = hourly(rows, new Date(2026, 10, 26, 13, 30));
  assert.equal(h.bars[0].hour, 8);
  assert.equal(h.bars.at(-1)!.hour, 21);
  assert.equal(h.peak!.hour, 13);
  assert.ok(h.bars.find((b) => b.hour === 13)!.now);
  assert.equal(hourly([], new Date()).peak, null);
});

test("φίλτρα: τα πιστωτικά μόνο στις επιστροφές", () => {
  const credit = tx({ kind: "credit", cents: -550, state: "refunded" });
  assert.equal(matches(credit, "card"), false);
  assert.equal(matches(credit, "refunds"), true);
  assert.equal(matches(tx({ cash: true }), "cash"), true);
  assert.equal(matches(tx({ state: "refunded" }), "refunds"), true);
});
