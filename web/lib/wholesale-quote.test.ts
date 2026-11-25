import assert from "node:assert/strict";
import { test } from "node:test";
import { canWholesaleQuoteTransition, wholesaleQuoteExpired, wholesaleQuoteOrderInput } from "./wholesale.ts";

test("προσφορά: επιτρέπονται μόνο οι μεταβάσεις draft/sent/accepted/rejected/expired", () => {
  assert.equal(canWholesaleQuoteTransition("DRAFT", "SENT"), true);
  assert.equal(canWholesaleQuoteTransition("DRAFT", "ACCEPTED"), false);
  assert.equal(canWholesaleQuoteTransition("SENT", "ACCEPTED"), true);
  assert.equal(canWholesaleQuoteTransition("SENT", "REJECTED"), true);
  assert.equal(canWholesaleQuoteTransition("SENT", "EXPIRED"), true);
  for (const terminal of ["ACCEPTED", "REJECTED", "EXPIRED"] as const) {
    assert.equal(canWholesaleQuoteTransition(terminal, "SENT"), false);
    assert.equal(canWholesaleQuoteTransition(terminal, "DRAFT"), false);
  }
});

test("προσφορά: η λήξη ισχύει μόνο για απεσταλμένη και όχι για ιστορικά τερματικές καταστάσεις", () => {
  const validUntil = new Date("2026-11-24T12:00:00.000Z");
  assert.equal(wholesaleQuoteExpired("SENT", validUntil, new Date("2026-11-24T12:00:00.000Z")), true);
  assert.equal(wholesaleQuoteExpired("SENT", validUntil, new Date("2026-11-24T11:59:59.000Z")), false);
  assert.equal(wholesaleQuoteExpired("ACCEPTED", validUntil, new Date("2026-11-25T12:00:00.000Z")), false);
  assert.equal(wholesaleQuoteExpired("DRAFT", validUntil, new Date("2026-11-25T12:00:00.000Z")), false);
});

test("μετατροπή: η παραγγελία παίρνει αποκλειστικά τα snapshots ποσότητας/τιμής/ΦΠΑ", () => {
  const neededAt = new Date("2026-12-01T00:00:00.000Z");
  const quote = {
    customerId: "customer", storeId: "store", warehouseId: "warehouse", neededAt, note: "Παγωμένη συμφωνία",
    lines: [
      { genericItemId: "vanilla", quantityBase: 2_000_000, unitPriceCents: 1000, vatRate: 24 },
      { genericItemId: "chocolate", quantityBase: 3_000, unitPriceCents: 875, vatRate: 13 },
    ],
  };
  assert.deepEqual(wholesaleQuoteOrderInput(quote), {
    customerId: "customer", storeId: "store", warehouseId: "warehouse", neededAt,
    note: "Παγωμένη συμφωνία", externalKey: null,
    lines: quote.lines,
  });
  const changedPriceList = { ...quote.lines[0]!, unitPriceCents: 1, vatRate: 0 };
  assert.notEqual(wholesaleQuoteOrderInput(quote).lines[0]!.unitPriceCents, changedPriceList.unitPriceCents);
  assert.equal(wholesaleQuoteOrderInput(quote).lines[1]!.vatRate, 13);
});
