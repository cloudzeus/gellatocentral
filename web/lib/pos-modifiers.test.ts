import assert from "node:assert/strict";
import test from "node:test";
import { type CatalogGroup, lineDescription, ModifierError, resolveLine } from "./pos-modifiers.ts";

const groups: CatalogGroup[] = [
  { id: "g1", name: "Γεύσεις", kind: "REQUIRED", pick: 2, options: [{ id: "pist", name: "Φιστίκι", priceCents: 30 }, { id: "choc", name: "Σοκολάτα", priceCents: 0 }] },
  { id: "g2", name: "Έξτρα", kind: "EXTRA", pick: 1, options: [{ id: "cream", name: "Σαντιγί", priceCents: 60 }] },
  { id: "g3", name: "Χωρίς", kind: "REMOVE", pick: 1, options: [{ id: "nosugar", name: "Χωρίς ζάχαρη", priceCents: 99 }] },
];

test("η ίδια γεύση δύο φορές χρεώνεται δύο φορές", () => {
  const r = resolveLine(400, groups, ["pist", "pist"]);
  assert.equal(r.unitPriceCents, 460);
  assert.deepEqual(r.options.map((o) => o.name), ["Φιστίκι", "Φιστίκι"]);
});

test("έξτρα προστίθεται, το «χωρίς» δεν χρεώνεται ποτέ", () => {
  const r = resolveLine(400, groups, ["nosugar", "cream", "choc", "pist"]);
  assert.equal(r.unitPriceCents, 400 + 30 + 60);
  assert.deepEqual(r.options.map((o) => o.name), ["Φιστίκι", "Σοκολάτα", "Σαντιγί", "Χωρίς ζάχαρη"]); // σειρά καταλόγου
});

test("λείπει υποχρεωτική επιλογή ή περισσεύει", () => {
  assert.throws(() => resolveLine(400, groups, ["pist"]), ModifierError);
  assert.throws(() => resolveLine(400, groups, ["pist", "choc", "choc"]), ModifierError);
});

test("έξτρα δύο φορές ή επιλογή άλλου προϊόντος απορρίπτεται", () => {
  assert.throws(() => resolveLine(400, groups, ["pist", "choc", "cream", "cream"]), ModifierError);
  assert.throws(() => resolveLine(400, groups, ["pist", "choc", "ξένο"]), ModifierError);
});

test("προϊόν χωρίς ομάδες: η τιμή μένει ίδια", () => {
  assert.deepEqual(resolveLine(280, [], []), { unitPriceCents: 280, options: [] });
});

test("περιγραφή γραμμής για την απόδειξη", () => {
  assert.equal(lineDescription({ name: "Χωνάκι", options: [{ name: "Φιστίκι", priceCents: 30 }], note: "χωρίς κουτάλι" }), "Χωνάκι · Φιστίκι, χωρίς κουτάλι");
  assert.equal(lineDescription({ name: "Νερό", options: null }), "Νερό");
});
