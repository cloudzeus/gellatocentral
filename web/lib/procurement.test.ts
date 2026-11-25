import { test } from "node:test";
import assert from "node:assert/strict";
import { lineTotals, mrpSuggestion, nextAllowedDay, roundedOrderQuantity, sumDocumentTotals, uniqueSupplierItemFallback } from "./procurement.ts";

test("συσκευασία προμηθευτή: fallback μόνο σε μοναδικό συμβατό είδος", () => {
  const candidate = { id: "supplier-item-1", packQty: 2 };
  assert.equal(uniqueSupplierItemFallback([]), null);
  assert.equal(uniqueSupplierItemFallback([candidate]), candidate);
  assert.equal(uniqueSupplierItemFallback([candidate, { id: "supplier-item-2", packQty: 4 }]), null);
});

test("παραγγελία: ελάχιστο και ακέραιο πολλαπλάσιο συσκευασίας", () => {
  assert.equal(roundedOrderQuantity({ requiredBaseQty: 1001, minimumBaseQty: 500, orderMultipleBase: 500 }), 1500);
  assert.equal(roundedOrderQuantity({ requiredBaseQty: 0, minimumBaseQty: 500, orderMultipleBase: 500 }), 0);
  assert.equal(roundedOrderQuantity({ requiredBaseQty: 100, minimumBaseQty: 1000, orderMultipleBase: 300 }), 1200);
  assert.throws(() => roundedOrderQuantity({ requiredBaseQty: 1, orderMultipleBase: 0 }));
});

test("MRP: κάλυψη lead+cover, ασφάλεια και δεσμευμένο απόθεμα", () => {
  assert.deepEqual(mrpSuggestion({ onHandBaseQty: 1000, reservedBaseQty: 200, averageDailyUsageBaseQty: 100, leadDays: 2, coverDays: 3, safetyBaseQty: 50, orderMultipleBase: 100 }), { targetBaseQty: 550, shortageBaseQty: 0, suggestedBaseQty: 0 });
  assert.deepEqual(mrpSuggestion({ onHandBaseQty: 100, averageDailyUsageBaseQty: 100, leadDays: 2, coverDays: 3, minimumBaseQty: 500, orderMultipleBase: 250 }), { targetBaseQty: 500, shortageBaseQty: 400, suggestedBaseQty: 500 });
});

test("παραστατικό: στρογγυλοποίηση ανά γραμμή και σωστά σύνολα", () => {
  assert.deepEqual(lineTotals(3, 333, 24), { netCents: 999, vatCents: 240, totalCents: 1239 });
  assert.deepEqual(lineTotals(500_000, 500, 24, 0, 1_000_000), { netCents: 250, vatCents: 60, totalCents: 310 });
  assert.deepEqual(sumDocumentTotals([{ quantityBase: 1, unitPriceCents: 1, vatRate: 24 }, { quantityBase: 1, unitPriceCents: 1, vatRate: 24 }]), { netCents: 2, vatCents: 0, totalCents: 2 });
});

test("ημέρες παραγγελίας: ISO ημερολόγιο χωρίς τοπική ώρα", () => {
  assert.equal(nextAllowedDay(new Date("2026-11-23T23:00:00Z"), [1, 4], 1).toISOString().slice(0, 10), "2026-11-26");
  assert.equal(nextAllowedDay(new Date("2026-11-23T00:00:00Z"), [], 2).toISOString().slice(0, 10), "2026-11-25");
});
