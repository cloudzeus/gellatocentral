import assert from "node:assert/strict";
import { test } from "node:test";
import { lineDescription as serverLine } from "../web/lib/pos-modifiers.ts";
import { buildReceipt } from "../web/lib/viva/fiscal.ts";
import { enqueue, lineDescription, nextAa, offlineSale, type Outbox, uuid } from "./offline.ts";

const ctx = { merchantVat: "803164419", series: "A2", nextAa: 15 };
const cash = { id: "pm_cash", name: "Μετρητά", payItemCase: 0x01 };
const lines = [{ productId: "p1", name: "Χωνάκι", quantity: 2, unitPriceCents: 350, vatRate: 13, options: [{ name: "Φιστίκι", priceCents: 50 }], note: "χωρίς σιρόπι" }];
const empty: Outbox = { lastAa: 0, sales: [] };

test("κείμενο γραμμής ίδιο με του server (μπαίνει στην υπογραφή)", () => {
  assert.equal(lineDescription(lines[0]), serverLine(lines[0]));
  assert.equal(lineDescription({ name: "Νερό" }), "Νερό");
});

test("ΑΑ: συνεχίζει μετά τον μεγαλύτερο, του server ή της ουράς", () => {
  assert.equal(nextAa(ctx, empty), 15);
  assert.equal(nextAa(ctx, { lastAa: 20, sales: [] }), 21);
  const { sale } = offlineSale(ctx, empty, cash, lines);
  assert.equal(nextAa(ctx, enqueue(empty, sale)), 16);
});

test("η απόδειξη χωρίς σύνδεση είναι ίδια με αυτήν που ξαναχτίζει ο server στον συγχρονισμό", () => {
  const { sale, fiscalisationData } = offlineSale(ctx, empty, cash, lines, new Date("2026-11-27T10:00:00.789Z"));
  const text = Buffer.from(fiscalisationData, "base64url").toString("utf8");
  const sent = JSON.parse(text);
  const server = buildReceipt({ merchantVat: ctx.merchantVat, series: ctx.series, aa: sale.aa, reference: sale.reference, moment: new Date(sale.issuedAt), payItem: { description: cash.name, payItemCase: 1 }, lines: lines.map((l) => ({ name: serverLine(l), quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: l.vatRate })) });
  assert.equal(sent.ftReceiptCaseData.GR.HashPayload, server.data.ftReceiptCaseData.GR.HashPayload);
  assert.equal(sent.cbReceiptMoment, "2026-11-27T10:00:00Z");
  assert.equal(sale.amountCents, 700);
  assert.equal(server.totalCents, sale.amountCents);
  assert.match(text, /"ftReceiptCase":5139205309155246081\b/); // Int64 ακέραιο, όχι στρογγυλεμένο
  assert.match(fiscalisationData, /^[A-Za-z0-9_-]+$/);
});

test("uuid v4 και saleId που δέχεται ο server", () => {
  const u = uuid();
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(offlineSale(ctx, empty, cash, lines).sale.saleId.length <= 40);
});
