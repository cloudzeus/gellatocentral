// Tests για την αντιστοίχιση γραμμών τιμολογίου αγοράς και την αλυσίδα ποσοτήτων (lib/purchases.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineBaseQty, matchLine, normText, perPackCents, purchaseUnitCostHundredths, textScore, type MappingLite, type SupplierItemLite, type TradeItemLite } from "./purchases.ts";

const SUP = "sup1";
const supplierItems: SupplierItemLite[] = [
  { id: "si1", supplierId: SUP, tradeItemId: "t1", supplierCode: "30411", barcode: null, packQty: 12 },
  { id: "si2", supplierId: "αλλος", tradeItemId: "t2", supplierCode: "30411", barcode: null, packQty: 1 }, // ίδιος κωδικός, άλλος προμηθευτής
  { id: "si3", supplierId: SUP, tradeItemId: "t3", supplierCode: null, barcode: "15201234567890", packQty: 6 },
];
const tradeItems: TradeItemLite[] = [
  { id: "t1", ean: "5201234567894", name: "Γάλα ΔΕΛΤΑ φρέσκο 1,5% 1L" },
  { id: "t2", ean: null, name: "Ζάχαρη άχνη 1kg" },
  { id: "t3", ean: "5209999888877", name: "Κρέμα γάλακτος 35% 500ml" },
];
const mappings: MappingLite[] = [
  { tradeItemId: "t1", genericItemId: "g1" },
  { tradeItemId: "t3", genericItemId: "g3" },
];
const ctx = { supplierId: SUP, supplierItems, tradeItems, mappings };

test("κωδικός προμηθευτή: ακριβής αντιστοίχιση ΜΟΝΟ στον ίδιο προμηθευτή", () => {
  const m = matchLine({ supplierCode: "30411", description: "οτιδήποτε" }, ctx);
  assert.equal(m.supplierItemId, "si1");
  assert.equal(m.tradeItemId, "t1");
  assert.equal(m.genericItemId, "g1");
  assert.equal(m.matchNote, "code");
});

test("EAN: βρίσκει το εμπορικό είδος και τον SupplierItem του προμηθευτή", () => {
  const m = matchLine({ ean: "5201234567894", description: "ΓΑΛΑ" }, ctx);
  assert.equal(m.tradeItemId, "t1");
  assert.equal(m.supplierItemId, "si1");
  assert.equal(m.genericItemId, "g1");
  assert.equal(m.matchNote, "ean");
});

test("GTIN-14 κιβωτίου με indicator 0 καταλήγει στο EAN της μονάδας", () => {
  const m = matchLine({ ean: "05201234567894", description: "ΓΑΛΑ ΚΙΒ" }, ctx);
  assert.equal(m.tradeItemId, "t1");
  assert.equal(m.matchNote, "ean");
});

test("GS1-128 με AI(01)(10)(17): το GTIN αρκεί για την αντιστοίχιση", () => {
  const m = matchLine({ ean: "010520123456789410LOT123\x1D17261231", description: "ΓΑΛΑ" }, ctx);
  assert.equal(m.tradeItemId, "t1");
  assert.equal(m.matchNote, "ean");
});

test("barcode προμηθευτή (δικό του κιβώτιο) όταν το EAN δεν βρίσκεται", () => {
  const m = matchLine({ ean: "15201234567890", description: "ΚΡΕΜΑ ΚΙΒ" }, ctx);
  assert.equal(m.supplierItemId, "si3");
  assert.equal(m.tradeItemId, "t3");
});

test("EAN χωρίς SupplierItem του προμηθευτή: tradeItem βρέθηκε, supplierItem όχι", () => {
  const m = matchLine({ ean: "5209999888877", description: "ΚΡΕΜΑ" }, { ...ctx, supplierItems: [] });
  assert.equal(m.tradeItemId, "t3");
  assert.equal(m.supplierItemId, undefined);
  assert.equal(m.genericItemId, "g3");
});

test("fuzzy περιγραφή: μόνο πρόταση, ποτέ αυτόματη αντιστοίχιση", () => {
  const m = matchLine({ description: "ΓΑΛΑ ΔΕΛΤΑ ΦΡΕΣΚΟ 1Λ" }, ctx);
  assert.deepEqual(m.suggestion, { tradeItemId: "t1", score: 0.75 }); // 3 από 4 λέξεις («1L» vs «1Λ» δεν ταυτίζονται)
  assert.equal(m.tradeItemId, undefined);
});

test("ασαφής περιγραφή: καμία πρόταση όταν δύο είδη ισοβαθμούν", () => {
  const m = matchLine({ description: "ΓΑΛΑ 1Λ" }, { ...ctx, tradeItems: [tradeItems[0], { id: "t4", ean: null, name: "Γάλα εβαπορέ 1L" }] });
  assert.equal(m.suggestion, undefined);
});

test("κωδικός προμηθευτή υπερισχύει του EAN όταν δίνονται και τα δύο", () => {
  const m = matchLine({ supplierCode: "30411", ean: "5209999888877", description: "ΚΡΕΜΑ" }, ctx);
  assert.equal(m.tradeItemId, "t1"); // ο κωδικός δείχνει στο γάλα, όχι στο EAN της κρέμας
  assert.equal(m.matchNote, "code");
});

test("normText/textScore: τονισμός και σημεία στίξης δεν παίζουν ρόλο", () => {
  assert.deepEqual(normText("Γάλα ΔΕΛΤΑ, 1,5%!"), ["γαλα", "δελτα"]); // τα μονοψήφια («1», «5») πετιούνται
  assert.equal(textScore("ΓΑΛΑ ΔΕΛΤΑ ΦΡΕΣΚΟ", "Γάλα ΔΕΛΤΑ φρέσκο 1,5%"), 1);
  assert.equal(textScore("κάτι άσχετο", "Γάλα ΔΕΛΤΑ"), 0);
});

test("lineBaseQty: η αλυσίδα τεμάχια × packQty × contentQty", () => {
  assert.equal(lineBaseQty(2, 12, 1_000), 24_000); // 2 κιβώτια × 12 φιάλες × 1000 ml = 24 L σε ml
  assert.throws(() => lineBaseQty(0, 12, 1_000), /άκυρη ποσότητα/);
});

test("perPackCents: τιμή μονάδας παραστατικού → τιμή ανά συσκευασία", () => {
  assert.equal(perPackCents(1_104, 12), 92); // 11,04 € το κιβώτιο των 12 → 0,92 € η φιάλη
  assert.equal(perPackCents(1_100, 12), 92); // 11,00 € → 91,67 λεπτά στρογγυλοποιούνται σε 92
});

test("κόστος αγοράς: το 1,20 €/kg δεν μηδενίζεται όταν η βάση είναι mg", () => {
  assert.equal(purchaseUnitCostHundredths(120, 1_000_000), 12);
  assert.equal(purchaseUnitCostHundredths(350, 100), 350_000); // 3,50 € ανά 100 τεμάχια
});
