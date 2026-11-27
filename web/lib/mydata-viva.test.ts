// Tests του σώματος receipts:sign για τη χονδρική (lib/mydata-viva.ts), χωρίς δίκτυο.
import assert from "node:assert/strict";
import { test } from "node:test";
import { vivaSignBody } from "./mydata-viva.ts";
import type { MyDataSubmission } from "./mydata-outgoing.ts";

const items = new Map([["milk", { name: "Γάλα", nature: "GOODS" as const, dimension: "mass" }]]);
const doc = (docType: string, extra: Partial<MyDataSubmission> = {}): MyDataSubmission => ({
  idempotencyKey: "6f1c2a52-6d9b-4c3e-9a51-0b8d1e2f3a4b", docType, series: "T", aa: 1, issuedAt: new Date("2026-11-27T10:00:00Z"),
  customer: { vatNumber: "800856732", name: "Πελάτης", countryCode: "GR", address: "Οδός 1", city: "Αθήνα", postalCode: "11741" },
  lines: [{ genericItemId: "milk", lotId: null, quantityBase: 5_000_000, unitPriceCents: 120, vatRate: 13 }],
  netCents: 0, vatCents: 0, totalCents: 0, ...extra,
});
type Body = { sessionId: string; cbReceiptReference: string; cbPayItems?: { ftPayItemCase: number }[]; cbChargeItems: { quantity: number; ftChargeItemCaseData: { GR: { mydataoverride: { invoiceDetails: { quantity: number } } } } }[] };
const body = (d: MyDataSubmission) => JSON.parse(vivaSignBody(d, "803164419", items)) as Body;

test("sessionId = idempotencyKey: χωρίς αυτό η Viva απαντά 409 σε επί πιστώσει, και η επανάληψη δίνει το ίδιο MARK", () => {
  const b = body(doc("1.1"));
  assert.equal(b.sessionId, "6f1c2a52-6d9b-4c3e-9a51-0b8d1e2f3a4b");
  assert.equal(b.cbReceiptReference, b.sessionId);
  assert.equal(b.cbPayItems?.length, 1);
});

test("ίδιο παραστατικό → ίδιο σώμα (η επανάληψη δεν αλλάζει τίποτα)", () => {
  assert.equal(vivaSignBody(doc("1.1"), "803164419", items), vivaSignBody(doc("1.1"), "803164419", items));
});

test("5.1: η ποσότητα στο mydataoverride μένει θετική (η ΑΑΔΕ απορρίπτει αρνητική)", () => {
  const line = body(doc("5.1", { relatedMark: "400001977198177" })).cbChargeItems[0];
  assert.ok(line.quantity < 0);
  assert.equal(line.ftChargeItemCaseData.GR.mydataoverride.invoiceDetails.quantity, 5);
});
