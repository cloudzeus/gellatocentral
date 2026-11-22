import assert from "node:assert/strict";
import { test } from "node:test";
import { filterOptions, normalizeOption, optionDepth, submittedOption, treeOptions, type SelectOption } from "./select-options.ts";

test("select options: το κενό sentinel υποβάλλεται ως κενή τιμή", () => {
  assert.equal(submittedOption("__empty__"), "");
  assert.equal(submittedOption("brand_1"), "brand_1");
  assert.equal(submittedOption(undefined), undefined);
});

test("select options: η ελληνική αναζήτηση αγνοεί τόνους και πεζά-κεφαλαία", () => {
  const options: SelectOption[] = [["gr", "Ελλάδα"], ["cy", "Κύπρος"], ["it", "Ιταλία"]];
  assert.equal(normalizeOption("  ΈλλΑΔΑ "), "ελλαδα");
  assert.deepEqual(filterOptions(options, "ελλαδα"), [options[0]]);
  assert.deepEqual(filterOptions(options, "ΚΥΠΡ"), [options[1]]);
  assert.deepEqual(filterOptions(options, "  "), options);
});

test("select options: το δέντρο βάζει γονείς πριν από παιδιά και κρατά εσοχές", () => {
  const options: SelectOption[] = [
    ["child", "Παιδί", "root"],
    ["root", "Γονέας"],
    ["grandchild", "Εγγονό", "child"],
    ["orphan", "Ορφανό", "missing"],
  ];
  assert.deepEqual(treeOptions(options).map(([id]) => id), ["root", "child", "grandchild", "orphan"]);
  assert.equal(optionDepth(options, options[2]), 2);
  assert.equal(optionDepth(options, options[3]), 0);
});

test("select options: κυκλικές σχέσεις δεν κρύβουν τιμές και δεν κάνουν άπειρη αναδρομή", () => {
  const options: SelectOption[] = [["a", "Α", "b"], ["b", "Β", "a"]];
  assert.deepEqual(treeOptions(options).map(([id]) => id), ["a", "b"]);
  assert.equal(optionDepth(options, options[0]), 1);
});
