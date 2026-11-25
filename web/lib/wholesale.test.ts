import assert from "node:assert/strict";
import { test } from "node:test";
import { hashAccessToken, outstandingCents, paymentUnappliedCents, selectPriceList, validExternalKey } from "./wholesale.ts";

const at = new Date("2026-11-23T12:00:00.000Z");
const item = { genericItemId: "milk", unitPriceCents: 100, vatRate: 24 };
const list = (id: string, from: string, parties: string[] = [], price = 100) => ({ id, validFrom: new Date(from), validTo: null, active: true, parties: parties.map((partyId) => ({ partyId })), items: [{ ...item, unitPriceCents: price }] });

test("τιμοκατάλογος: ειδική τιμή πελάτη, μετά γενική και πιο πρόσφατη ισχύς", () => {
  const generalOld = list("general-old", "2026-01-01T00:00:00.000Z", [], 110);
  const generalNew = list("general-new", "2026-11-01T00:00:00.000Z", [], 120);
  const otherCustomer = list("other", "2026-11-10T00:00:00.000Z", ["other"], 50);
  const specific = list("specific", "2026-10-01T00:00:00.000Z", ["customer"], 90);
  assert.equal(selectPriceList([generalOld, generalNew, otherCustomer, specific], "customer", "milk", at)?.unitPriceCents, 90);
  assert.equal(selectPriceList([generalOld, generalNew, otherCustomer], "customer", "milk", at)?.unitPriceCents, 120);
  assert.equal(selectPriceList([otherCustomer], "customer", "milk", at), null);
});

test("τιμοκατάλογος: ακυρότητα και χρονικό διάστημα δεν αγνοούνται", () => {
  const future = list("future", "2027-01-01T00:00:00.000Z");
  const expired = { ...list("expired", "2026-01-01T00:00:00.000Z"), validTo: new Date("2026-11-22T23:59:59.000Z") };
  const inactive = { ...list("inactive", "2026-01-01T00:00:00.000Z"), active: false };
  assert.equal(selectPriceList([future, expired, inactive], "customer", "milk", at), null);
});

test("ανεξόφλητο μόνο για ενεργό τιμολόγιο 1.1", () => {
  const invoice = { totalCents: 1000, status: "ISSUED", docType: "1.1" };
  assert.equal(outstandingCents(invoice, [{ amountCents: 250 }, { amountCents: 250 }]), 500);
  assert.equal(outstandingCents(invoice, [{ amountCents: 1200 }]), 0);
  assert.equal(outstandingCents({ ...invoice, status: "CANCELLED" }, []), 0);
  assert.equal(outstandingCents({ ...invoice, docType: "9.3" }, []), 0);
});

test("εισπράξεις: μη διατιθέμενο υπόλοιπο και αρνητικά/υπερβολικά allocations", () => {
  assert.equal(paymentUnappliedCents(1000, [{ amountCents: 600 }]), 400);
  assert.equal(paymentUnappliedCents(1000, []), 1000);
  assert.throws(() => paymentUnappliedCents(500, [{ amountCents: 600 }]), /υπερβαίνουν/);
  assert.throws(() => paymentUnappliedCents(500, [{ amountCents: 0 }]), /Άκυρα/);
});

test("B2B: μόνο hash αποθηκεύεται και αυστηρό external key", () => {
  assert.equal(hashAccessToken("secret"), hashAccessToken("secret"));
  assert.notEqual(hashAccessToken("secret"), "secret");
  assert.match(hashAccessToken("secret"), /^[a-f0-9]{64}$/);
  assert.equal(validExternalKey("b2b-order_123"), true);
  assert.equal(validExternalKey("short"), false);
  assert.equal(validExternalKey("κλειδί-123"), false);
});
