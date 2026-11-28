// Δοκιμές του parser RequestDocs με fixture στο σχήμα της ΑΑΔΕ (RequestedDoc/invoicesDoc/invoice), της σύγκρισης με σκαναρισμένο και των σφαλμάτων.
import assert from "node:assert/strict";
import test from "node:test";
import { continuation, diffWithMydata, mydataFault, parseMyIncomeXml } from "./mydata-parse.ts";

const FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0">
  <invoicesDoc>
    <invoice>
      <uid>A1B2</uid>
      <mark>400001234567890</mark>
      <issuer><vatNumber>094123456</vatNumber><country>GR</country><branch>0</branch><name>ΓΑΛΑΚΤΟΚΟΜΙΚΑ ΑΘΗΝΩΝ &amp; ΥΙΟΙ</name></issuer>
      <counterpart><vatNumber>018240255</vatNumber><country>GR</country><branch>0</branch></counterpart>
      <invoiceHeader><series>ΤΔΑ</series><aa>9921</aa><issueDate>2026-11-15</issueDate><invoiceType>1.1</invoiceType><currency>EUR</currency></invoiceHeader>
      <invoiceDetails><lineNumber>1</lineNumber><itemDescr>ΓΑΛΑ ΕΒΟΛ 3,5% 1L</itemDescr><quantity>4</quantity><netValue>49.60</netValue><vatCategory>1</vatCategory><vatAmount>11.90</vatAmount></invoiceDetails>
      <invoiceDetails><lineNumber>2</lineNumber><quantity>2</quantity><netValue>17.80</netValue><vatCategory>1</vatCategory><vatAmount>4.27</vatAmount></invoiceDetails>
      <invoiceSummary><totalNetValue>67.40</totalNetValue><totalVatAmount>16.17</totalVatAmount><totalGrossValue>83.57</totalGrossValue></invoiceSummary>
    </invoice>
    <invoice>
      <mark>400001234567891</mark>
      <cancelledByMark>400001234567999</cancelledByMark>
      <issuer><vatNumber>800777888</vatNumber></issuer>
      <invoiceHeader><aa>77</aa><issueDate>2026-11-16</issueDate><invoiceType>1.1</invoiceType></invoiceHeader>
      <invoiceDetails><lineNumber>1</lineNumber><quantity>1</quantity><netValue>18.50</netValue></invoiceDetails>
    </invoice>
  </invoicesDoc>
  <continuationToken><nextPartitionKey>P1</nextPartitionKey><nextRowKey>R1</nextRowKey></continuationToken>
</RequestedDoc>`;

test("ο εκδότης είναι ο προμηθευτής· σειρά, αριθμός, σύνολα, γραμμή χωρίς περιγραφή κρατιέται, το ακυρωμένο φεύγει", () => {
  const docs = parseMyIncomeXml(FIXTURE);
  assert.equal(docs.length, 1);
  const [a] = docs;
  assert.equal(a.mark, "400001234567890");
  assert.equal(a.supplierVat, "094123456");
  assert.equal(a.supplierName, "ΓΑΛΑΚΤΟΚΟΜΙΚΑ ΑΘΗΝΩΝ & ΥΙΟΙ");
  assert.equal(a.series, "ΤΔΑ");
  assert.equal(a.number, "9921");
  assert.equal(a.issuedAt?.toISOString().slice(0, 10), "2026-11-15");
  assert.deepEqual([a.netCents, a.vatCents, a.grossCents], [6740, 1617, 8357]);
  assert.deepEqual(a.lines[0], { description: "ΓΑΛΑ ΕΒΟΛ 3,5% 1L", quantity: 4, unitPriceCents: 1240, discountBps: 0, vatRate: 24 });
  assert.equal(a.lines[1].description, "Γραμμή 2");
});

test("τιμή μονάδας από καθαρή αξία ÷ ποσότητα· το πρόθεμα EL κόβεται", () => {
  const [d] = parseMyIncomeXml(`<RequestedDoc><invoicesDoc><invoice><mark>1</mark><issuer><vatNumber>EL094000000</vatNumber></issuer>
    <invoiceDetails><itemDescr>ΤΥΡΙ ΧΥΜΑ</itemDescr><quantity>3</quantity><netValue>10.00</netValue></invoiceDetails></invoice></invoicesDoc></RequestedDoc>`);
  assert.equal(d.supplierVat, "094000000");
  assert.equal(d.lines[0].unitPriceCents, 333);
});

test("κενή απάντηση ή χωρίς ΜΑΡΚ: κανένα παραστατικό", () => {
  assert.equal(parseMyIncomeXml("<RequestedDoc/>").length, 0);
  assert.equal(parseMyIncomeXml(`<RequestedDoc><invoice><issuer><vatNumber>094000000</vatNumber></issuer><invoiceDetails><quantity>1</quantity><netValue>1</netValue></invoiceDetails></invoice></RequestedDoc>`).length, 0);
});

test("5.1 του προμηθευτή: διαβάζεται ο τύπος και το MARK που πιστώνει", () => {
  const [doc] = parseMyIncomeXml(`<RequestedDoc><invoicesDoc><invoice><mark>400001977213004</mark><issuer><vatNumber>801218180</vatNumber><name>OVEROLL</name></issuer>
    <invoiceHeader><aa>118</aa><issueDate>2026-11-28</issueDate><invoiceType>5.1</invoiceType><correlatedInvoices>400001977212000</correlatedInvoices></invoiceHeader>
    <invoiceDetails><itemDescr>Γάλα</itemDescr><quantity>6</quantity><netValue>7.20</netValue><vatCategory>2</vatCategory></invoiceDetails></invoice></invoicesDoc></RequestedDoc>`);
  assert.equal(doc.type, "5.1");
  assert.equal(doc.relatedMark, "400001977212000");
  assert.equal(doc.lines[0].unitPriceCents, 120);
});

test("σελιδοποίηση και σφάλμα της ΑΑΔΕ μέσα σε HTTP 200", () => {
  assert.deepEqual(continuation(FIXTURE), { nextPartitionKey: "P1", nextRowKey: "R1" });
  assert.equal(continuation("<RequestedDoc/>"), null);
  assert.equal(mydataFault(FIXTURE), null);
  assert.equal(
    mydataFault(`<ResponseDoc><response><statusCode>ValidationError</statusCode><errors><error><message>User VAT number 1 is not authorized</message><code>105</code></error></errors></response></ResponseDoc>`),
    "User VAT number 1 is not authorized (κωδ. 105)",
  );
});

test("σύγκριση σκαναρισμένου με myDATA: ίδια στοιχεία, αριθμός με ή χωρίς σειρά, διαφορές ανά πεδίο", () => {
  const [doc] = parseMyIncomeXml(FIXTURE);
  assert.deepEqual(diffWithMydata({ vatNumber: "EL094123456", number: "ΤΔΑ-9921", issuedAt: "2026-11-15", mark: "400001234567890" }, doc), []);
  assert.deepEqual(diffWithMydata({ vatNumber: "094123456", number: "09921", issuedAt: null }, doc), []);
  const diff = diffWithMydata({ vatNumber: "094123457", number: "9912", issuedAt: "2026-11-14" }, doc);
  assert.deepEqual(diff.map((d) => [d.field, d.scanned, d.mydata]), [["vat", "094123457", "094123456"], ["number", "9912", "ΤΔΑ-9921"], ["date", "2026-11-14", "2026-11-15"]]);
});

test("ποσά: ανοχή 1 λεπτού, διαφορά πάνω από αυτό σημειώνεται", () => {
  const [doc] = parseMyIncomeXml(FIXTURE);
  const h = { vatNumber: null, number: null, issuedAt: null };
  assert.deepEqual(diffWithMydata({ ...h, totals: { netCents: 6741, vatCents: 1617, grossCents: 8358 } }, doc), []);
  assert.deepEqual(diffWithMydata({ ...h, totals: { netCents: 6901, vatCents: 1656, grossCents: 8557 } }, doc).map((d) => [d.field, d.scanned, d.mydata]),
    [["net", "69,01 €", "67,40 €"], ["vat_amount", "16,56 €", "16,17 €"], ["gross", "85,57 €", "83,57 €"]]);
});
