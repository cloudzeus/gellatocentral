// Δοκιμές του parser RequestMyIncome με ρεαλιστικό fixture XML της ΑΑΔΕ.
import assert from "node:assert/strict";
import test from "node:test";
import { parseMyIncomeXml } from "./mydata-parse.ts";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0">
  <invoicesDoc>
    <invoiceDoc>
      <invoiceHeader>
        <aa>ΤΔΑ-9921</aa>
        <issueDate>2026-11-15</issueDate>
        <invoiceType>1.1</invoiceType>
        <currency>EUR</currency>
      </invoiceHeader>
      <counterpart>
        <vatNumber>094123456</vatNumber>
        <country>GR</country>
        <name>ΓΑΛΑΚΤΟΚΟΜΙΚΑ ΑΘΗΝΩΝ &amp; ΥΙΟΙ</name>
      </counterpart>
      <invoiceDetails>
        <lineNumber>1</lineNumber>
        <itemDescr>ΓΑΛΑ ΕΒΟΛ 3,5% 1L</itemDescr>
        <quantity>4</quantity>
        <netValue>49.60</netValue>
        <vatCategory>1</vatCategory>
      </invoiceDetails>
      <invoiceDetails>
        <lineNumber>2</lineNumber>
        <itemDescr>ΚΡΕΜΑ ΓΑΛΑΚΤΟΣ 35% 1L</itemDescr>
        <quantity>2</quantity>
        <netValue>17.80</netValue>
        <vatCategory>1</vatCategory>
      </invoiceDetails>
      <invoiceMark>400001234567890</invoiceMark>
    </invoiceDoc>
    <invoiceDoc>
      <invoiceHeader>
        <aa>ΠΡ-77</aa>
        <issueDate>2026-11-16</issueDate>
      </invoiceHeader>
      <counterpart>
        <vatNumber>EL800777888</vatNumber>
        <name>ΖΑΧΑΡΩΔΗ ΑΕ</name>
      </counterpart>
      <invoiceDetails>
        <lineNumber>1</lineNumber>
        <itemDescr>ΖΑΧΑΡΗ ΚΡΥΣΤΑΛΛΙΚΗ 25KG</itemDescr>
        <quantity>1</quantity>
        <netValue>18.50</netValue>
      </invoiceDetails>
      <invoiceMark>40000999888777</invoiceMark>
    </invoiceDoc>
  </invoicesDoc>
</RequestedDoc>`;

test("δύο παραστατικά με ΜΑΡΚ, ΑΦΜ, αριθμό, ημερομηνία και γραμμές", () => {
  const docs = parseMyIncomeXml(FIXTURE);
  assert.equal(docs.length, 2);
  const [a, b] = docs;
  assert.equal(a.mark, "400001234567890");
  assert.equal(a.supplierVat, "094123456");
  assert.equal(a.supplierName, "ΓΑΛΑΚΤΟΚΟΜΙΚΑ ΑΘΗΝΩΝ & ΥΙΟΙ");
  assert.equal(a.number, "ΤΔΑ-9921");
  assert.equal(a.issuedAt?.toISOString().slice(0, 10), "2026-11-15");
  assert.equal(a.lines.length, 2);
  assert.deepEqual(a.lines[0], { description: "ΓΑΛΑ ΕΒΟΛ 3,5% 1L", quantity: 4, unitPriceCents: 1240, discountBps: 0, vatRate: 24 });
  assert.equal(b.supplierVat, "800777888"); // το πρόθεμα EL κόβεται
  assert.equal(b.lines[0].unitPriceCents, 1850);
});

test("τιμή μονάδας από καθαρή αξία ÷ ποσότητα, στρογγυλή σε λεπτό", () => {
  const docs = parseMyIncomeXml(`<RequestedDoc><invoiceDoc>
    <counterpart><vatNumber>094000000</vatNumber><name>Χ</name></counterpart>
    <invoiceDetails><itemDescr>ΤΥΡΙ ΧΥΜΑ</itemDescr><quantity>3</quantity><netValue>10.00</netValue></invoiceDetails>
    <invoiceMark>1</invoiceMark></invoiceDoc></RequestedDoc>`);
  assert.equal(docs[0].lines[0].unitPriceCents, 333); // 3,3333… → 333 λεπτά
});

test("παραστατικό χωρίς ΜΑΡΚ ή χωρίς γραμμές αγνοείται", () => {
  const xml = `<RequestedDoc>
    <invoiceDoc><counterpart><vatNumber>094000000</vatNumber></counterpart>
      <invoiceDetails><itemDescr>ΧΩΡΙΣ ΜΑΡΚ</itemDescr><quantity>1</quantity><netValue>1</netValue></invoiceDetails></invoiceDoc>
    <invoiceDoc><counterpart><vatNumber>094000001</vatNumber></counterpart><invoiceMark>999</invoiceMark></invoiceDoc>
  </RequestedDoc>`;
  assert.equal(parseMyIncomeXml(xml).length, 0);
});

test("κενή απάντηση: κανένα παραστατικό", () => {
  assert.equal(parseMyIncomeXml("<RequestedDoc/>").length, 0);
});
