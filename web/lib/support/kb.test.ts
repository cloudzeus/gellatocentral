import assert from "node:assert/strict";
import { test } from "node:test";
import { fold, helpful, parseBody, search } from "./kb.ts";

const docs = [
  { title: "Ο θερμικός εκτυπωτής δεν τυπώνει", body: "Έλεγξε το ρολό χαρτιού και τη σύνδεση του εκτυπωτή με το ταμείο." },
  { title: "Το τερματικό δεν απαντά", body: "Όταν μια πληρωμή με κάρτα μένει σε αναμονή, το ταμείο δεν βρίσκει το τερματικό Viva." },
  { title: "Πρόσκληση υπαλλήλου", body: "Από τους Χρήστες και ρόλους στέλνεις πρόσκληση με email." },
];

test("αναζήτηση: χωρίς τόνους, με καταλήξεις, ο τίτλος μετρά περισσότερο", () => {
  assert.equal(fold("Απόδειξης"), "αποδειξησ");
  assert.equal(search("δεν τυπωνει ο εκτυπωτης", docs)[0].title, "Ο θερμικός εκτυπωτής δεν τυπώνει");
  assert.equal(search("ΕΚΤΥΠΩΤΉ", docs)[0].title, "Ο θερμικός εκτυπωτής δεν τυπώνει"); // άλλη κατάληξη, κεφαλαία
  assert.equal(search("πληρωμή με κάρτα", docs)[0].title, "Το τερματικό δεν απαντά");
  assert.equal(search("τιμοκατάλογος χονδρικής", docs).length, 0);
  assert.equal(search("το και να", docs).length, 0); // μόνο κοινές λέξεις
  assert.equal(search("", docs).length, 0);
});

test("κείμενο άρθρου: υπότιτλοι, λίστες, βήματα", () => {
  assert.deepEqual(parseBody("Εισαγωγή.\n\n## Βήματα\n1. Πρώτο\n2. Δεύτερο\n- ένα\n- δύο\nΤέλος"), [
    { kind: "p", text: "Εισαγωγή." }, { kind: "h", text: "Βήματα" }, { kind: "ol", items: ["Πρώτο", "Δεύτερο"] }, { kind: "ul", items: ["ένα", "δύο"] }, { kind: "p", text: "Τέλος" },
  ]);
  assert.deepEqual(parseBody("<script>alert(1)</script>"), [{ kind: "p", text: "<script>alert(1)</script>" }]); // μένει κείμενο, δεν γίνεται HTML
});

test("χρησιμότητα: θέλει τουλάχιστον τρεις ψήφους", () => {
  assert.equal(helpful(1, 0), null);
  assert.equal(helpful(6, 1), 86);
});
