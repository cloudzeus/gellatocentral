// Tests για την αντιστοίχιση Open Food Facts → κεντρικός κατάλογος (lib/off-import.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEan, cleanIngredients, cleanName, isGreece, mapAllergenTags, mapOffRow, nutrimentToPm, parseQuantity, pickBrand, pickPackaging } from "./off-import.ts";

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
    ingredientsText: null,
    allergensContains: [],
    allergensTraces: [],
    fatPm: null,
    sucrosePm: null,
    otherProteinPm: null,
    saltPm: null,
    fiberPm: null,
    alcoholPm: null,
  });
  assert.equal(mapOffRow({ ...row, countries_tags: "en:france" }), null);
  assert.equal(mapOffRow({ ...row, code: "abc" }), null);
  // χωρίς αναγνώσιμη ποσότητα → 1 τεμάχιο (το barcode μετράει στη σάρωση)
  const noQty = mapOffRow({ ...row, quantity: "" });
  assert.equal(noQty?.unitCode, "pcs");
  assert.equal(noQty?.contentQty, 1);
});

test("συστατικά: προτιμάται η ελληνική έκδοση, κόψιμο κενών", () => {
  assert.equal(cleanIngredients({ ingredients_text_el: "  Γάλα,   ζάχαρη " }), "Γάλα, ζάχαρη");
  assert.equal(cleanIngredients({ ingredients_text_el: "", ingredients_text: "milk, sugar" }), "milk, sugar");
  assert.equal(cleanIngredients({ ingredients_text: "αβ" }), null); // πολύ κοντό — θόρυβος
  assert.equal(cleanIngredients({}), null);
});

test("αλλεργιογόνα: μετάφραση ετικετών OFF στα 14 της ΕΕ", () => {
  assert.deepEqual(mapAllergenTags("en:milk,en:eggs,en:unknown-thing"), ["milk", "eggs"]);
  assert.deepEqual(mapAllergenTags("en:soybeans,fr:soy"), ["soy"]); // συγχώνευση συνωνύμων
  assert.deepEqual(mapAllergenTags("en:sesame-seeds"), ["sesame"]);
  assert.deepEqual(mapAllergenTags("en:sulphur-dioxide-and-sulphites"), ["sulphites"]);
  assert.deepEqual(mapAllergenTags(""), []);
  assert.deepEqual(mapAllergenTags(undefined), []);
});

test("θρεπτικά: g/100 g → χιλιοστά της μονάδας", () => {
  assert.equal(nutrimentToPm("8.5"), 8500);
  assert.equal(nutrimentToPm("20,2"), 20200);
  assert.equal(nutrimentToPm("0.12"), 120);
  assert.equal(nutrimentToPm(""), null);
  assert.equal(nutrimentToPm("abc"), null);
  assert.equal(nutrimentToPm("150"), null); // εκτός ορίου — θόρυβος του OFF
});

test("πλήρης γραμμή με συστατικά και θρεπτικά", () => {
  const m = mapOffRow({
    code: "5201234567890",
    product_name: "Παγωτό βανίλια",
    countries_tags: "en:greece",
    quantity: "500 ml",
    ingredients_text_el: "Γάλα, ζάχαρη, κρέμα γάλακτος",
    allergens: "en:milk,en:eggs",
    traces_tags: "en:nuts, en:sesame-seeds",
    fat_100g: "8.5",
    sugars_100g: "20.2",
    proteins_100g: "3.1",
    salt_100g: "0.12",
  });
  assert.equal(m?.ingredientsText, "Γάλα, ζάχαρη, κρέμα γάλακτος");
  assert.deepEqual(m?.allergensContains, ["milk", "eggs"]);
  assert.deepEqual(m?.allergensTraces, ["nuts", "sesame"]);
  assert.equal(m?.fatPm, 8500);
  assert.equal(m?.sucrosePm, 20200);
  assert.equal(m?.otherProteinPm, 3100);
  assert.equal(m?.saltPm, 120);
  assert.equal(m?.fiberPm, null);
  assert.equal(m?.alcoholPm, null);
});
