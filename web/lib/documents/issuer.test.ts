import assert from "node:assert/strict";
import { test } from "node:test";
import { IssuerError, issuerOf } from "./issuer.ts";

const org = { vatNumber: "099999999", name: "Gelato", legalName: "Gelato ΙΚΕ", city: "Αθήνα", vivaMerchantId: "m-org", aadeUserId: "u", aadeSubKey: "k" };
const entity = { id: "le1", vatNumber: "088888888", name: "Gelato Θεσσαλονίκης ΙΚΕ", taxOffice: "Δ' Θεσσαλονίκης", address: "Τσιμισκή 10", city: "Θεσσαλονίκη", postalCode: "54624", vivaMerchantId: null, aadeUserId: null, aadeSubKey: null, active: true };

test("issuerOf: κατάστημα χωρίς δικό ΑΦΜ εκδίδει με την επιχείρηση", () => {
  const i = issuerOf(org, null);
  assert.equal(i.vatNumber, "099999999");
  assert.equal(i.name, "Gelato ΙΚΕ");
  assert.equal(i.vivaMerchantId, "m-org");
  assert.equal(i.legalEntityId, null);
});

test("issuerOf: υποκατάστημα με δικό ΑΦΜ δεν δανείζεται κλειδιά ή έμπορο της επιχείρησης", () => {
  const i = issuerOf(org, entity);
  assert.equal(i.vatNumber, "088888888");
  assert.equal(i.city, "Θεσσαλονίκη");
  assert.equal(i.vivaMerchantId, null);
  assert.equal(i.aadeUserId, null);
});

test("issuerOf: ανενεργός εκδότης σταματά την έκδοση", () => {
  assert.throws(() => issuerOf(org, { ...entity, active: false }), IssuerError);
});
