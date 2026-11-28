import assert from "node:assert/strict";
import { test } from "node:test";
import { addScan, matchScan, packs, putaway, submission, type DeliveryNote, type ReceivingOrder } from "./receiving.ts";

const order: ReceivingOrder = {
  id: "o1", number: "ΠΑΡ-1", createdAt: "2026-11-20", supplier: { id: "s1", name: "Γαλακτοκομικά", vatNumber: null },
  lines: [
    { id: "milk", genericItemId: "g1", name: "Γάλα", dimension: "volume", missing: 6000, ordered: 6000, packBase: 6000, codes: [{ code: "5201234567894", base: 1000 }, { code: "15201234567891", base: 6000 }], expectedAt: null },
    { id: "cream", genericItemId: "g2", name: "Κρέμα", dimension: "volume", missing: 12000, ordered: 12000, packBase: 6000, codes: [{ code: "5209999999998", base: 6000 }], expectedAt: null },
  ],
};

test("κιβώτιο GS1 με παρτίδα και λήξη πάει στη σωστή γραμμή", () => {
  const hit = matchScan("011520123456789110K118\u001D17261215", order.lines);
  assert.deepEqual(hit, { lineId: "milk", base: 6000, batch: "K118", expiry: "2026-12-15" });
});

test("άγνωστο barcode δεν ταιριάζει", () => assert.equal(matchScan("4006381333931", order.lines), undefined));

test("η καταχώριση κόβει στο υπόλοιπο και κρατά απόφαση για όσα λείπουν", () => {
  let c = addScan({}, matchScan("5201234567894", order.lines)!);
  c = addScan(c, { lineId: "milk", base: 6000 });
  c = addScan(c, matchScan("5209999999998", order.lines)!);
  const note: DeliveryNote = { number: "ΔΑ-881", date: "2026-11-24T00:00:00.000Z", mark: null, vatNumber: null, supplier: null, lines: [{ description: "Κρέμα", quantity: 2, genericItemId: "g2", base: 12000 }] };
  const s = submission(order, c, { cream: "close" }, note);
  assert.deepEqual(s.lines.map((l) => [l.orderLineId, l.quantityBase]), [["milk", 6000], ["cream", 6000]]);
  assert.deepEqual(s.shortfall, [{ orderLineId: "cream", action: "close" }]);
  assert.equal(s.deliveryNote?.date, "2026-11-24");
  assert.equal(s.remark, "Λιγότερα από το δελτίο: Κρέμα");
  assert.equal(packs(6000, 6000), 1);
});

test("τακτοποίηση: ανά θέση αλφαβητικά, χωρίς θέση στο τέλος", () => {
  const g = putaway([{ name: "Γάλα", spot: { id: "b", name: "Ψυγείο 2" } }, { name: "Ζάχαρη", spot: null }, { name: "Κρέμα", spot: { id: "a", name: "Ψυγείο 1" } }, { name: "Βούτυρο", spot: { id: "b", name: "Ψυγείο 2" } }]);
  assert.deepEqual(g.map((x) => [x.spot?.name ?? null, x.items.map((i) => i.name)]), [["Ψυγείο 1", ["Κρέμα"]], ["Ψυγείο 2", ["Γάλα", "Βούτυρο"]], [null, ["Ζάχαρη"]]]);
});
