import assert from "node:assert/strict";
import { test } from "node:test";
import { chunk, parseDraft, scrub, vectorLiteral } from "./rules.ts";

test("scrub: τίποτα προσωπικό δεν φεύγει προς τρίτο", () => {
  const out = scrub("Με λένε στο maria.p@aurora.gr, τηλ. 6941234567 ή 210 4000000, ΑΦΜ 094014201, κάρτα 4111 1111 1111 1111, IBAN GR16 0110 1250 0000 0001 2300 695. Το Ταμείο 2 έχει τερματικό 16000012.");
  for (const secret of ["maria.p@aurora.gr", "6941234567", "4000000", "094014201", "4111 1111", "GR16"]) assert.equal(out.includes(secret), false, secret);
  assert.equal(out.includes("Ταμείο 2"), true); // ό,τι χρειάζεται για τη διάγνωση μένει
  assert.equal(out.includes("16000012"), true); // αριθμός τερματικού (8 ψηφία): δεν είναι προσωπικό στοιχείο
});

test("chunk: ανά ενότητα, και τα μεγάλα σε παραγράφους", () => {
  assert.deepEqual(chunk("Εισαγωγή.\n\n## Α\nένα\n\nδύο\n\n## Β\nτρία"), ["Εισαγωγή.", "## Α\nένα\n\nδύο", "## Β\nτρία"]);
  const long = chunk(Array.from({ length: 10 }, (_, i) => `Παράγραφος ${i} ${"λέξη ".repeat(40)}`).join("\n\n"), 500);
  assert.equal(long.length > 3, true);
  assert.equal(long.every((c) => c.length <= 520), true);
  assert.deepEqual(chunk("   \n\n  "), []);
});

test("parseDraft: JSON, JSON σε ```, και άχρηστη απάντηση", () => {
  assert.deepEqual(parseDraft('{"reply":"Κλείσε και άνοιξε το τερματικό.","confidence":"high","sources":[1,7,1],"note":""}', 3), { reply: "Κλείσε και άνοιξε το τερματικό.", note: null, confidence: "high", sources: [1] });
  assert.equal(parseDraft('```json\n{"reply":"ok","confidence":"high","sources":[]}\n```', 3).confidence, "medium"); // «σίγουρο» χωρίς πηγή δεν γίνεται δεκτό
  assert.deepEqual([parseDraft("Δεν ξέρω.", 3).confidence, parseDraft("Δεν ξέρω.", 3).reply], ["low", "Δεν ξέρω."]);
});

test("vectorLiteral: μόνο αριθμοί", () => {
  assert.equal(vectorLiteral([0.5, -1, 2]), "[0.5,-1,2]");
  assert.throws(() => vectorLiteral([1, Number.NaN]));
  assert.throws(() => vectorLiteral(["1); drop table" as unknown as number]));
  assert.throws(() => vectorLiteral([]));
});
