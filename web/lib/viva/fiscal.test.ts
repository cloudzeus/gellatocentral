import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaymentProtocol, buildReceipt, hashAmount, toVivaJson } from "./fiscal.ts";

test("ποσό hash όπως στα δείγματα της Viva", () => {
  assert.equal(hashAmount(1240), "12.4");
  assert.equal(hashAmount(1235), "12.35");
  assert.equal(hashAmount(1200), "12.0");
  assert.equal(hashAmount(2300), "23.0");
});

test("απόδειξη 11.1 με μετρητά", () => {
  const { data, totalCents } = buildReceipt({
    merchantVat: "098000979",
    series: "A",
    aa: 397717,
    reference: "receiptreference1",
    moment: new Date("2025-07-17T08:11:06Z"),
    payItem: { description: "Μετρητά", payItemCase: 1 },
    lines: [
      { name: "Χωνάκι 2 μπάλες", quantity: 2, unitPriceCents: 450, vatRate: 13 },
      { name: "Νερό", quantity: 1, unitPriceCents: 1400, vatRate: 24 },
    ],
  });
  assert.equal(totalCents, 2300);
  // ίδιο με το παράδειγμα της τεκμηρίωσης (FAQ 6)
  assert.equal(data.ftReceiptCaseData.GR.HashPayload, "098000979-A-397717-receiptreference1-2025-07-17T08:11:06Z-23.0");
  assert.equal(data.cbPayItems[0].ftPayItemCase, 5139205309155246081n);
  assert.equal(data.cbChargeItems[1].ftChargeItemCase, 5139205309155246099n); // 24% αγαθό, όπως στα δείγματα
  assert.equal(data.cbChargeItems[0].quantity, 200);
  assert.equal(data.cbChargeItems[0].vatAmount, 104); // 900 × 13/113
  // τα Int64 φεύγουν ως αριθμοί χωρίς απώλεια ακρίβειας
  assert.match(toVivaJson(data), /"ftReceiptCase":5139205309155246081,/);
});

test("κάρτα και άγνωστος ΦΠΑ", () => {
  const base = { merchantVat: "1", series: "A", aa: 1, reference: "r", moment: new Date(0) };
  const card = buildReceipt({ ...base, payItem: { description: "Κάρτα", payItemCase: 5 }, lines: [{ name: "x", quantity: 1, unitPriceCents: 100, vatRate: 13 }] });
  assert.equal(card.data.cbPayItems[0].ftPayItemCase, 5139205309155246085n);
  const cash = { description: "Μετρητά", payItemCase: 1 };
  assert.throws(() => buildReceipt({ ...base, payItem: cash, lines: [{ name: "x", quantity: 1, unitPriceCents: 100, vatRate: 19 }] }));
  assert.throws(() => buildReceipt({ ...base, payItem: cash, lines: [] }));
});

// Δείγμα «Split the payments» της Viva (greece-samples): δύο κάρτες πριν, μία απόδειξη με τα transactionIds τους
test("μοίρασμα κατά ποσό: πρωτόκολλο πληρωμής και απόδειξη με όλες τις πληρωμές", () => {
  const p = buildPaymentProtocol({ reference: "first-payment", moment: new Date("2025-08-12T03:22:11Z"), amountCents: 1000, payItem: { description: "Κάρτα", payItemCase: 2 } });
  assert.equal(p.ftReceiptCase, 5139205309155258373n);
  assert.deepEqual(p.cbChargeItems, []);
  assert.equal("ftReceiptCaseData" in p, false); // χωρίς σειρά/ΑΑ
  assert.equal(p.cbPayItems[0].ftPayItemCase, 5139205309155246082n);

  const { data } = buildReceipt({
    merchantVat: "012345678", series: "AB", aa: 1234, reference: "pos_sale_receipt1", moment: new Date("2025-08-12T03:26:11Z"),
    payItem: { description: "Μετρητά", payItemCase: 1 },
    lines: [{ name: "Product x", quantity: 1, unitPriceCents: 2600, vatRate: 24 }],
    prior: [
      { description: "Κάρτα", payItemCase: 2, amountCents: 1000, transactionId: "t1", moment: new Date("2025-08-12T03:22:11Z") },
      { description: "Κάρτα", payItemCase: 2, amountCents: 1300, transactionId: "t2" },
    ],
  });
  assert.deepEqual(data.cbPayItems.map((x) => [x.position, x.amount, "transactionId" in x ? x.transactionId : null, x.moment]),
    [[1, 1000, "t1", "2025-08-12T03:22:11Z"], [2, 1300, "t2", "2025-08-12T03:26:11Z"], [3, 300, null, "2025-08-12T03:26:11Z"]]);
  assert.equal(data.cbReceiptAmount, 2600);
  assert.throws(() => buildReceipt({ merchantVat: "1", series: "A", aa: 1, reference: "r", moment: new Date(), payItem: { description: "x", payItemCase: 1 },
    lines: [{ name: "a", quantity: 1, unitPriceCents: 500, vatRate: 24 }], prior: [{ description: "k", payItemCase: 2, amountCents: 500 }] }), RangeError);
});
