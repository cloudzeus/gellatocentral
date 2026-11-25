import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeFlash, encodeFlash, flashFromUrl, savedMessage, withoutFlash } from "./flash.ts";

const q = (search: string) => new URLSearchParams(search);

test("flashFromUrl: η πρόταση του redirect δείχνεται ως έχει", () => {
  assert.deepEqual(flashFromUrl("/finance", q("saved=Το έξοδο καταχωρήθηκε")), { kind: "success", title: "Το έξοδο καταχωρήθηκε" });
});

test("savedMessage: το κλειδί γίνεται πρόταση που λέει τι αποθηκεύτηκε, ανά οθόνη", () => {
  assert.equal(savedMessage("/recipes/abc", "1"), "Η συνταγή αποθηκεύτηκε");
  assert.equal(savedMessage("/platform/settings", "legal"), "Τα νομικά κείμενα αποθηκεύτηκαν");
  assert.equal(savedMessage("/platform/settings", "1"), "Οι ρυθμίσεις της πλατφόρμας αποθηκεύτηκαν");
  assert.equal(savedMessage("/platform/catalog/duplicates", "3"), "Συγχωνεύτηκαν 3 κατασκευαστές, μαζί με τα brands και τα προϊόντα τους");
  assert.equal(savedMessage("/platform/catalog/duplicates", "x"), "Η αλλαγή αποθηκεύτηκε");
  assert.equal(savedMessage("/platform/continuity", "1"), "Ο έλεγχος καταγράφηκε");
  assert.equal(savedMessage("/platform/support/t1", "resolved"), "Το αίτημα σημειώθηκε ως λυμένο");
  assert.equal(savedMessage("/platform/catalog/xyz", "1"), "Ο κεντρικός κατάλογος ενημερώθηκε");
  assert.equal(savedMessage("/platform/org_1", "lifecycle"), "Η κατάσταση της επιχείρησης άλλαξε");
  assert.equal(savedMessage("/κάτι-άγνωστο", "1"), "Η αλλαγή αποθηκεύτηκε");
});

test("flashFromUrl: αποτυχία με λόγο και επόμενο βήμα, ποτέ σκέτο «Σφάλμα»", () => {
  assert.deepEqual(flashFromUrl("/orders", q("error=Ο προμηθευτής δεν έχει email")), { kind: "error", title: "Δεν έγινε: Ο προμηθευτής δεν έχει email", detail: "Διόρθωσέ το και δοκίμασε ξανά." });
  const keyed = flashFromUrl("/account", q("error=short"));
  assert.equal(keyed?.kind, "error");
  assert.doesNotMatch(`${keyed?.title} ${keyed?.detail}`, /short|Σφάλμα/);
  // το λάθος υπερισχύει αν υπάρχουν και τα δύο
  assert.equal(flashFromUrl("/x", q("saved=1&error=Κάτι λείπει"))?.kind, "error");
  assert.equal(flashFromUrl("/x", q("tab=a")), null);
});

test("withoutFlash: βγάζει μόνο saved/error, κρατά τα υπόλοιπα και το #", () => {
  assert.equal(withoutFlash("/platform/org_1", "?saved=bank&tab=billing", "#banks"), "/platform/org_1?tab=billing#banks");
  assert.equal(withoutFlash("/orders", "?error=x"), "/orders");
  assert.equal(withoutFlash("/orders", "?q=a&page=2"), "/orders?q=a&page=2");
});

test("cookie: γύρος encode/decode, και ό,τι δεν έχει το σχήμα μας απορρίπτεται", () => {
  const flash = { id: "abc", kind: "success" as const, title: "Η συσκευή αποθηκεύτηκε", href: "/devices", linkText: "Δες την" };
  assert.deepEqual(decodeFlash(encodeFlash(flash)), { ...flash, detail: undefined });
  assert.equal(decodeFlash("όχι json"), null);
  assert.equal(decodeFlash(encodeURIComponent(JSON.stringify({ id: "a", kind: "info", title: "x" }))), null);
  // link εκτός εφαρμογής δεν περνά
  assert.equal(decodeFlash(encodeFlash({ ...flash, href: "https://evil.example" }))?.href, undefined);
  assert.equal(decodeFlash(encodeFlash({ ...flash, href: "//evil.example" }))?.href, undefined);
  assert.equal(decodeFlash(undefined), null);
});

test("άλλα params «έγινε»: toast με το κείμενο της οθόνης, και η επανάληψη λέει ότι δεν γράφτηκε διπλά", () => {
  assert.equal(flashFromUrl("/products", q("deleted=1"))?.title, "Το προϊόν διαγράφηκε οριστικά");
  assert.equal(flashFromUrl("/inventory/transfers", q("posted=abc"))?.title, "Η μεταφορά ολοκληρώθηκε και καταγράφηκε στο ιστορικό");
  assert.equal(flashFromUrl("/inventory/transfers", q("posted=abc&replayed=1"))?.title, "Η μεταφορά είχε ήδη καταχωριστεί. Δεν δημιουργήθηκε διπλή εγγραφή");
  assert.equal(flashFromUrl("/counts/c1", q("finalized=1"))?.kind, "success");
  assert.equal(flashFromUrl("/gdpr", q("ok=Το αίτημα ολοκληρώθηκε"))?.title, "Το αίτημα ολοκληρώθηκε");
  // το ίδιο param σε άλλη οθόνη δεν είναι μήνυμα
  assert.equal(flashFromUrl("/orders", q("deleted=1")), null);
  assert.equal(withoutFlash("/counts/c1", "?created=1&replayed=1&tab=lines"), "/counts/c1?tab=lines");
  assert.equal(withoutFlash("/orders", "?deleted=1"), "/orders?deleted=1");
});
