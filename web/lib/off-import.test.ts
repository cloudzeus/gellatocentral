// Tests για την αντιστοίχιση Open Food Facts → κεντρικός κατάλογος (lib/off-import.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEan, cleanName, isGreece, mapOffRow, parseQuantity, pickBrand, pickPackaging } from "./off-import.ts";

test("μόνο προϊόντα Ελλάδας", () => {
  assert.equal(isGreece({ countries_tags: "en:greece" }), true);
  assert.equal(isGreece({ countries_tags: "en:france,en:greece" }), true);
  assert.equal(isGreece({ countries_tags: "en:germany, en:greece " }), true);
  assert.equal(isGreece({ countries_tags: "en:france" }), false);
  assert.equal(isGreece({}), false);
});

test("EAN: μόνο ψηφία σε έγκυρο μήκος", () => {
  assert.equal(cleanEan("5201234567890"), "5201234567890");
  assert.equal(cleanEan("5 2012 3456 7890"), "5201234567890");
  assert.equal(cleanEan("123"), null);
  assert.equal(cleanEan("52012345678"), null); // 11 ψηφία: άκυρο μήκος
  assert.equal(cleanEan(""), null);
  assert.equal(cleanEan(undefined), null);
});

test("όνομα: product_name, αλλιώς generic_name", () => {
  assert.equal(cleanName({ product_name: "  Γάλα   φρέσκο " }), "Γάλα φρέσκο");
  assert.equal(cleanName({ product_name: "", generic_name: "Γιαούρτι" }), "Γιαούρτι");
  assert.equal(cleanName({ product_name: "α" }), null);
});

test("ποσότητα: σε βασική μονάδα (mg/ml) με μονάδα κατανάλωσης", () => {
  assert.deepEqual(parseQuantity("1 l"), { qty: 1000, unitCode: "ml" });
  assert.deepEqual(parseQuantity("1,5 L"), { qty: 1500, unitCode: "ml" });
  assert.deepEqual(parseQuantity("500 g"), { qty: 500_000, unitCode: "g" });
  assert.deepEqual(parseQuantity("1 kg"), { qty: 1_000_000, unitCode: "g" });
  // πολυσυσκευασία: 6 × 330 ml
  assert.deepEqual(parseQuantity("6 x 330 ml"), { qty: 1980, unitCode: "ml" });
  assert.equal(parseQuantity(""), null);
  assert.equal(parseQuantity("συσκευασία 12 τεμαχίων"), null);
});

test("brand και συσκευασία: το πρώτο της λίστας", () => {
  assert.equal(pickBrand("ΔΕΛΤΑ, ΤΩΝ 150"), "ΔΕΛΤΑ");
  assert.equal(pickBrand(""), null);
  assert.equal(pickPackaging("plastic bottle, cap"), "plastic bottle");
});

test("πλήρης γραμμή: Ελλάδα + EAN + όνομα + ποσότητα, αλλιώς απορρίπτεται", () => {
  const row = {
    code: "5201234567890",
    product_name: "Γάλα φρέσκο 1,5%",
    brands: "ΔΕΛΤΑ",
    packaging: "bottle",
    quantity: "1 l",
    countries_tags: "en:greece",
    image_front_url: "https://images.openfoodfacts.org/x/front.jpg",
  };
  assert.deepEqual(mapOffRow(row), {
    ean: "5201234567890",
    name: "Γάλα φρέσκο 1,5%",
    brand: "ΔΕΛΤΑ",
    packaging: "bottle",
    contentQty: 1000,
    unitCode: "ml",
    imageUrl: "https://images.openfoodfacts.org/x/front.jpg",
  });
  assert.equal(mapOffRow({ ...row, countries_tags: "en:france" }), null);
  assert.equal(mapOffRow({ ...row, code: "abc" }), null);
  // χωρίς αναγνώσιμη ποσότητα → 1 τεμάχιο (το barcode μετράει στη σάρωση)
  const noQty = mapOffRow({ ...row, quantity: "" });
  assert.equal(noQty?.unitCode, "pcs");
  assert.equal(noQty?.contentQty, 1);
});
