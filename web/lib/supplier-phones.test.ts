import assert from "node:assert/strict";
import test from "node:test";
import { supplierPhones } from "./supplier-phones.ts";

test("εταιρία πρώτα, μετά επαφές, χωρίς διπλά", () => {
    const r = supplierPhones({ name: "Προμηθευτής ΑΕ", phone: "210 1", contactName: null,
      channels: [{ value: "210 2", label: "Αποθήκη" }, { value: "210 1", label: null }],
      contacts: [{ title: "Πωλήσεις", person: { name: "Νίκος", channels: [{ value: "697", label: "Κινητό" }] } }] });
  assert.deepEqual(r, [
      { who: "Κεντρικό", label: null, phone: "210 1" },
      { who: "Αποθήκη", label: null, phone: "210 2" },
      { who: "Νίκος", label: "Πωλήσεις · Κινητό", phone: "697" },
  ]);
});
