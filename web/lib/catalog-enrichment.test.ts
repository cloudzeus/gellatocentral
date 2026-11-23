import assert from "node:assert/strict";
import { test } from "node:test";
import { extractLogoCandidates, normalizeIngredientName, pageMentionsIdentity, parseCatalogEnrichment, safeHttpsUrl, sameSite, validatedAliases, validatedIngredients, validatedMergeSuggestions } from "./catalog-enrichment.ts";

const products = [
  { id: "item1", name: "Κουβερτούρα υγείας 55%", ingredientsText: "Σάκχαρη, μάζα κακάο, βούτυρο κακάο, γαλακτωματοποιητής: λεκιθίνη σόγιας" },
  { id: "item2", name: "Βανίλια Μαδαγασκάρης", ingredientsText: "Νερό, εκχύλισμα βανίλιας" },
  { id: "other", name: "Ξένο προϊόν", ingredientsText: "Αμύγδαλα" },
];

test("η απάντηση AI διαβάζεται από JSON και αγνοούνται άγνωστες κατηγορίες με ασφαλή αποτυχία", () => {
  const answer = parseCatalogEnrichment('```json\n{"canonicalName":"IRCA","website":"https://www.irca.eu/","aliases":[],"ingredients":[{"name":"Λεκιθίνη σόγιας","category":"emulsifier","isCore":false,"pastryRelevant":true,"evidence":"λεκιθίνη σόγιας","sourceItemIds":["item1"]}],"duplicates":[]}\n```');
  assert.equal(answer.website, "https://www.irca.eu/");
  assert.equal(answer.ingredients[0].category, "emulsifier");
  assert.throws(() => parseCatalogEnrichment("κανένα JSON"));
  assert.deepEqual(parseCatalogEnrichment('{"ingredients":[{"name":"x","category":"invented"}]}').ingredients, []);
});

test("το markdown website του web plugin καθαρίζεται σε URL μετά την παραγωγή citation", () => {
  const answer = parseCatalogEnrichment('{"website":"[nestle.com](https://www.nestle.com/)","ingredients":[],"duplicates":[]}');
  assert.equal(answer.website, "https://www.nestle.com/");
  const withCitation = parseCatalogEnrichment('{"website":"https://www.nestle.com/ ([nestle.com](https://www.nestle.com/))","ingredients":[],"duplicates":[]}');
  assert.equal(withCitation.website, "https://www.nestle.com/");
});

test("HTTPS URLs χωρίς credentials ή εσωτερική θύρα, και συμβατά official domains", () => {
  assert.equal(safeHttpsUrl("http://example.com"), null);
  assert.equal(safeHttpsUrl("https://user:pass@example.com"), null);
  assert.equal(safeHttpsUrl("https://example.com:8443"), null);
  assert.equal(safeHttpsUrl("https://example.com/a#b")?.toString(), "https://example.com/a");
  assert.equal(sameSite("https://www.irca.eu", "https://shop.irca.eu/product"), true);
  assert.equal(sameSite("https://irca.eu", "https://irca.eu.example.com"), false);
});

test("πρώτες ύλες: δεκτή μόνο αυτούσια απόδειξη από δοσμένο προϊόν", () => {
  const [ingredient] = validatedIngredients([
    { name: "Λεκιθίνη  σόγιας", category: "emulsifier", isCore: false, pastryRelevant: true, evidence: "λεκιθίνη σόγιας", sourceItemIds: ["item1", "other", "fake"] },
    { name: "Αμύγδαλα", category: "nuts", isCore: true, pastryRelevant: true, evidence: "Αμύγδαλα", sourceItemIds: ["other"] },
    { name: "Σοκολάτα", category: "chocolate", isCore: true, pastryRelevant: true, evidence: "επινοημένο απόσπασμα", sourceItemIds: ["item1"] },
  ], products.slice(0, 2));
  assert.equal(ingredient.name, "Λεκιθίνη σόγιας");
  assert.deepEqual(ingredient.productIds, ["item1"]);
  assert.equal(normalizeIngredientName("Ζάχαρη  άχνη"), "ΖΑΧΑΡΗ ΑΧΝΗ");
});

test("ίδιο υλικό από δύο προϊόντα ενοποιείται χωρίς να χαθούν οι αποδείξεις", () => {
  const result = validatedIngredients([
    { name: "Βανίλια", category: "flavor", isCore: false, pastryRelevant: true, evidence: "βανίλιας", sourceItemIds: ["item2"] },
    { name: "βανιλια", category: "flavor", isCore: true, pastryRelevant: false, evidence: "Βανίλια", sourceItemIds: ["item2"] },
  ], products);
  assert.equal(result.length, 1);
  assert.equal(result[0].isCore, true);
  assert.equal(result[0].pastryRelevant, true);
});

test("merge suggestions: μόνο γνωστοί υποψήφιοι, υψηλή βεβαιότητα και κοινή ταυτότητα/domain", () => {
  const raw = [
    { manufacturerId: "good", confidence: 92, reason: "ίδιο όνομα" },
    { manufacturerId: "low", confidence: 84, reason: "χαμηλή" },
    { manufacturerId: "unknown", confidence: 99, reason: "επινοημένο id" },
    { manufacturerId: "unrelated", confidence: 99, reason: "άσχετο" },
    { manufacturerId: "domain", confidence: 90, reason: "ίδιο official domain" },
  ];
  const result = validatedMergeSuggestions(raw, { id: "current", name: "ΦΑΓΕ", website: "https://fage.gr" }, [
    { id: "good", name: "FAGE" },
    { id: "low", name: "ΦΑΓΕ ΑΕ" },
    { id: "unrelated", name: "DELTA" },
    { id: "domain", name: "FAGE INTERNATIONAL", website: "https://www.fage.gr/about" },
  ]);
  assert.deepEqual(result.map((r) => r.targetId), ["good", "domain"]);
});

test("aliases κανονικοποιούνται και δεν επαναλαμβάνουν το τρέχον όνομα", () => {
  assert.deepEqual(validatedAliases({ canonicalName: "FAGE INTERNATIONAL", aliases: ["ΦΑΓΕ", "Fage International", "  "] }, "ΦΑΓΕ"), ["FAGE INTERNATIONAL"]);
});

test("λογότυπο εξάγεται από JSON-LD και σχετικό img, όχι από τυχαίο URL", () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"Organization","logo":{"url":"/assets/logo.png"}}</script><link rel="icon" href="/favicon.png"></head><body><img class="brand-logo" src="https://cdn.example.com/brand.webp"><img src="/random.jpg"></body></html>`;
  assert.deepEqual(extractLogoCandidates(html, "https://www.example.com/about"), [
    "https://www.example.com/assets/logo.png",
    "https://cdn.example.com/brand.webp",
    "https://www.example.com/favicon.png",
  ]);
});

test("η σελίδα πρέπει να στηρίζει την ταυτότητα κατασκευαστή ή brand", () => {
  assert.equal(pageMentionsIdentity("<title>IRCA — chocolate and pastry ingredients</title>", ["IRCA", "MARTINI"]), true);
  assert.equal(pageMentionsIdentity("<title>Generic directory result</title>", ["IRCA"]), false);
  assert.equal(pageMentionsIdentity("<p>Προϊόντα ζαχαροπλαστικής MARTINI PROFESSIONAL</p>", ["IRCA", "MARTINI PROFESSIONAL"]), true);
});
