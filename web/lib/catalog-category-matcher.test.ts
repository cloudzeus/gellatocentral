import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCatalogCategory, matchCatalogCategories, type CategoryMatchCategory } from "./catalog-category-matcher.ts";
import { PASTRY_CATEGORY_TREE, type PastryCategorySeed } from "./pastry-categories.ts";

let sequence = 0;
function flatten(seeds: PastryCategorySeed[], parentId: string | null = null): CategoryMatchCategory[] {
  return seeds.flatMap((seed) => {
    const id = `category-${sequence++}`;
    return [{ id, parentId, name: seed.name, active: true }, ...flatten(seed.children ?? [], id)];
  });
}
const categories = flatten(PASTRY_CATEGORY_TREE);

function categoryFor(name: string, ingredientsText?: string) {
  return matchCatalogCategory({ id: "item-1", name, ingredientsText }, categories);
}
function expectCategory(name: string, expected: string) {
  const match = categoryFor(name);
  assert.ok(match, `Αναμενόταν συσχέτιση για ${name}`);
  assert.equal(categories.find((category) => category.id === match.categoryId)?.name, expected);
  assert.ok(match.categoryPath.includes(expected));
  assert.ok(match.score >= 78);
  assert.ok(match.evidence.length > 0);
}

test("σάκχαρα: η ειδική κατηγορία κερδίζει τη γενική λέξη ζάχαρη", () => {
  expectCategory("Ζάχαρη άχνη 1kg", "Κρυσταλλική & άχνη");
  expectCategory("Icing sugar", "Ζάχαρη πούδρα");
  expectCategory("Coconut sugar 500g", "Ζάχαρη καρύδας");
  expectCategory("Muscovado sugar", "Καστανή & muscovado");
});

test("κακάο και βούτυρα: δεν συγχέονται οι διαφορετικές τεχνικές έννοιες", () => {
  expectCategory("Cocoa powder 22/24", "Σκόνη κακάο");
  expectCategory("Cocoa butter 1kg", "Βούτυρο κακάο");
  expectCategory("100% Peanut Butter", "Πάστες 100%");
  expectCategory("Φιστικοβούτυρο 100%", "Πάστες 100%");
  expectCategory("Unsalted butter 82%", "Βούτυρο γάλακτος");
});

test("γάλα: το φρέσκο και η σκόνη ακολουθούν διαφορετικό μονοπάτι", () => {
  expectCategory("Γάλα φρέσκο 3,5%", "Φρέσκα & UHT γάλατα");
  expectCategory("Whole milk powder", "Πλήρες & αποβουτυρωμένο γάλα");
  expectCategory("Whey powder food grade", "Ορός γάλακτος & πρωτεΐνες");
});

test("παγωτό: βάσεις, sorbet και ειδικός σταθεροποιητής", () => {
  expectCategory("Gelato base 50", "Παγωτό, sorbet & παγωτίνια");
  expectCategory("Sorbet mix", "Παγωτό, sorbet & παγωτίνια");
  expectCategory("Ice cream stabilizer", "Σταθεροποιητικά παγωτού & κρεμών");
});

test("φρούτα και ημιτελή: αναγνωρίζονται χρήσιμες τεχνικές περιγραφές", () => {
  expectCategory("Frozen fruit puree strawberry", "Κατεψυγμένοι πολτοί");
  expectCategory("Freeze dried strawberries", "Λυοφιλιοποιημένα ολόκληρα & κομμάτια");
  expectCategory("Custard powder", "Έτοιμες κρέμες ζαχαροπλαστικής");
  expectCategory("Dark chocolate couverture 70%", "Μαύρη");
});

test("η σύσταση δεν μετατρέπει έτοιμο προϊόν σε πρώτη ύλη", () => {
  assert.equal(categoryFor("Biscuits family pack", "Wheat flour, skimmed milk powder and cocoa powder."), null);
});

test("έτοιμα snacks, ροφήματα και συνοδευτικά δεν ταξινομούνται ως πρώτες ύλες", () => {
  for (const name of ["Oreo double cream", "Tea & Honey Ice Black Tea", "Solid Light Tuna In Olive Oil", "Corn Cakes & Sea Salt", "Ginger beer", "Strawberry yoghurt bar", "Tapioca and prawn crackers classic", "Chocolate Brownie Butter Biscuits", "Gluten-free almond biscuits with olive oil", "Nature Valley Crunchy Oats Bars Oats & Honey"]) {
    assert.equal(categoryFor(name), null, name);
  }
  assert.equal(matchCatalogCategory({ id: "lays", name: "Sour Cream Black Pepper", brandName: "Lay's" }, categories), null);
});

test("άσχετα supermarket, συμπληρώματα και ασαφή ονόματα μένουν εκτός", () => {
  for (const name of ["100% Iso Whey Zero", "100% Whey Protein Chocolate Hazelnut", "Fish fingers", "Pizza margherita", "Wasabi paste", "Creatine monohydrate", "Biscuits family pack"]) {
    assert.equal(categoryFor(name), null, name);
  }
});

test("ανενεργές κατηγορίες και άδεια δέντρα δεν επιστρέφουν πρόταση", () => {
  assert.equal(matchCatalogCategory({ id: "1", name: "Cocoa powder" }, categories.map((category) => ({ ...category, active: false }))), null);
  assert.equal(matchCatalogCategory({ id: "1", name: "Cocoa powder" }, []), null);
  assert.deepEqual(matchCatalogCategories([{ id: "1", name: "Fish fingers" }], categories), []);
});
