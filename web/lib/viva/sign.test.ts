import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseSignResponse, terminalFiscal, cardLabel, VivaSignError } from "./sign.ts";

test("απάντηση του demo για 2.1: MARK, UID, QR και PDF", () => {
  const r = parseSignResponse(readFileSync(new URL("./fixtures/sign-2.1-demo.json", import.meta.url), "utf8"));
  assert.equal(r.mark, "400001977048610");
  assert.equal(r.uid, "24248980F621C57D504716BAE77B19CF09725D18");
  assert.match(r.qrUrl ?? "", /^https:\/\/mydataapidev\.aade\.gr\/TimologioQR/);
  assert.match(r.pdfUrl ?? "", /^https:\/\/receipts-sandbox\.fiskaltrust\.eu\//);
});

test("χωρίς MARK: σφάλμα, ώστε το παραστατικό να ξανασταλεί", () => {
  assert.throws(() => parseSignResponse(JSON.stringify({ transmissionIndicator: 2, ftStateData: { GR: { GovernmentApi: { ProtocolResponse: "<ResponseDoc><message>myDATA down</message></ResponseDoc>" } } } })), VivaSignError);
});

test("απάντηση πληρωμής τερματικού: MARK, QR και σύνδεσμος από το fiscalisationDetails", () => {
  const raw = { success: true, fiscalisationDetails: JSON.parse(readFileSync(new URL("./fixtures/sign-2.1-demo.json", import.meta.url), "utf8")) };
  const f = terminalFiscal(raw);
  assert.equal(f.mark, "400001977048610");
  assert.match(f.qrUrl ?? "", /^https:\/\/mydataapidev\.aade\.gr\/TimologioQR/);
  assert.match(f.pdfUrl ?? "", /^https:\/\/receipts-sandbox\.fiskaltrust\.eu\//);
  assert.deepEqual(terminalFiscal({ success: true }), { mark: undefined, uid: undefined, qrUrl: undefined, pdfUrl: undefined });
});

test("κάρτα της πληρωμής: είδος και 4 τελευταία ψηφία, ποτέ ολόκληρος αριθμός", () => {
  assert.equal(cardLabel({ applicationLabel: "Visa DEBIT", primaryAccountNumberMasked: "412928******4462" }), "Visa DEBIT •••• 4462");
  assert.equal(cardLabel({ primaryAccountNumberMasked: "412928******4462" }), "•••• 4462");
  assert.equal(cardLabel({ success: true }), null);
  assert.equal(cardLabel(null), null);
});
