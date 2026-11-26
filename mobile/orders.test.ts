import assert from "node:assert/strict";
import test from "node:test";
import { km, nextMove, readyText, reorderLines, steps } from "./orders.ts";

test("βήματα και επόμενη κίνηση: η παραλαβή δεν περνά από διανομέα", () => {
  assert.deepEqual(steps(false), ["NEW", "ACCEPTED", "READY", "DELIVERED"]);
  assert.equal(nextMove({ status: "READY", delivery: true })?.to, "OUT");
  assert.equal(nextMove({ status: "READY", delivery: false })?.to, "DELIVERED");
  assert.equal(nextMove({ status: "NEW", delivery: true }), null);
});

test("ώρα ετοιμασίας: σε λεπτά ή καθυστέρηση", () => {
  const now = new Date("2026-11-26T20:00:00Z");
  assert.deepEqual(readyText("2026-11-26T20:12:00Z", now), { text: "σε 12′", late: false });
  assert.deepEqual(readyText("2026-11-26T19:56:00Z", now), { text: "καθυστερεί 4′", late: true });
  assert.equal(readyText(null, now), null);
});

test("Ξανά: επιλογές με το όνομα, ό,τι λείπει από τον κατάλογο μένει έξω", () => {
  const products = new Map([["p1", { groups: [{ id: "g", name: "Γεύσεις", kind: "REQUIRED" as const, pick: 2, options: [{ id: "o1", name: "Φιστίκι", priceCents: 0 }, { id: "o2", name: "Σοκολάτα", priceCents: 0 }] }] }]]);
  const r = reorderLines([
    { productId: "p1", name: "Κύπελλο", quantity: 2, unitPriceCents: 400, options: [{ name: "Φιστίκι", priceCents: 0 }, { name: "Φιστίκι", priceCents: 0 }], note: null },
    { productId: "p1", name: "Κύπελλο", quantity: 1, unitPriceCents: 400, options: [{ name: "Μπανάνα", priceCents: 0 }], note: null },
    { productId: "gone", name: "Παλιό", quantity: 1, unitPriceCents: 100, options: [], note: null },
  ], products);
  assert.deepEqual(r.ok, [{ productId: "p1", options: ["o1", "o1"], note: "", quantity: 2 }]);
  assert.deepEqual(r.missing, ["Κύπελλο", "Παλιό"]);
});

test("απόσταση σε μέτρα ή χιλιόμετρα", () => {
  assert.equal(km(850), "850 μ.");
  assert.equal(km(1240), "1,2 χλμ");
  assert.equal(km(null), null);
});
