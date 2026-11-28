// Δοκιμές του ελέγχου αποδείξεων με την ΑΑΔΕ: αντιστοίχιση ανά MARK, ημέρες του παραθύρου, απόδειξη από το RequestTransmittedDocs.
import assert from "node:assert/strict";
import test from "node:test";
import { athensDay, checkDays, matchReceipts, WINDOW_DAYS, type Receipt } from "./mydata-receipts-match.ts";
import { parseMyIncomeXml } from "./mydata-parse.ts";

const now = new Date("2026-11-28T01:10:00Z");
const r = (mark: string, cents: number, day = "2026-11-27", invType = "11.1"): Receipt => ({ mark, day, invType, cents, label: `A1-${mark}` });

test("ίδια MARK και ποσά (ανοχή 1 λεπτό) = καμία διαφορά", () => {
  assert.deepEqual(matchReceipts([r("1", 1250), r("2", 300)], [r("2", 300), r("1", 1251)]), []);
});

test("λείπει από την ΑΑΔΕ, υπάρχει μόνο στην ΑΑΔΕ, άλλο ποσό", () => {
  const gaps = matchReceipts([r("1", 1250), r("2", 300)], [r("2", 450), r("9", 1000)]);
  assert.deepEqual(gaps.map((g) => [g.kind, g.mark, g.cents, g.aadeCents]), [["OURS_ONLY", "1", 1250, undefined], ["AMOUNT", "2", 300, 450], ["AADE_ONLY", "9", 1000, undefined]]);
});

test("άλλη ημερομηνία στην ΑΑΔΕ γύρω στα μεσάνυχτα δεν είναι διαφορά", () => {
  assert.deepEqual(matchReceipts([r("1", 500, "2026-11-27")], [r("1", 500, "2026-11-28")]), []);
});

test("ημέρες ως χθες σε ώρα Ελλάδας", () => {
  const days = checkDays(now);
  assert.equal(days.length, WINDOW_DAYS);
  assert.equal(days.at(-1), "2026-11-27");
  assert.equal(athensDay(new Date("2026-11-27T22:30:00Z")), "2026-11-28"); // 00:30 στην Αθήνα
});

test("RequestTransmittedDocs: απόδειξη της Viva διαβάζεται με MARK, τύπο, σειρά και σύνολο", () => {
  const xml = `<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0"><invoicesDoc><invoice>
    <mark>400001977235425</mark>
    <issuer><vatNumber>803164419</vatNumber><country>GR</country><branch>0</branch></issuer>
    <invoiceHeader><series>Viva-Fiscal-Sandbox1-22</series><aa>5</aa><issueDate>2026-11-27</issueDate><invoiceType>11.1</invoiceType><currency>EUR</currency></invoiceHeader>
    <invoiceDetails><lineNumber>1</lineNumber><netValue>3.23</netValue><vatCategory>2</vatCategory><vatAmount>0.42</vatAmount></invoiceDetails>
    <invoiceSummary><totalNetValue>3.23</totalNetValue><totalVatAmount>0.42</totalVatAmount><totalGrossValue>3.65</totalGrossValue></invoiceSummary>
  </invoice></invoicesDoc></RequestedDoc>`;
  const [d] = parseMyIncomeXml(xml);
  assert.deepEqual([d.mark, d.type, d.series, d.number, d.grossCents, d.issuedAt?.toISOString().slice(0, 10)], ["400001977235425", "11.1", "Viva-Fiscal-Sandbox1-22", "5", 365, "2026-11-27"]);
});
