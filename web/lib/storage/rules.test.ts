import assert from "node:assert/strict";
import { test } from "node:test";
import { check, pathFor, safeName, sniff } from "./rules.ts";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test("κάθε πελάτης γράφει μόνο στον δικό του φάκελο", () => {
  assert.equal(pathFor("org1", "photo", "abc", "Vitrina kalokairi 2026.JPG"), "orgs/org1/photo/abc-Vitrina-kalokairi-2026.jpg");
  assert.equal(pathFor("org1", "photo", "abc", "Φωτό βιτρίνας.JPG"), "orgs/org1/photo/abc-file.jpg"); // τα ελληνικά φεύγουν, η κατάληξη μένει
  assert.equal(pathFor(null, "backup", "abc", "db.dump"), "platform/backup/abc-db.dump");
  // προσπάθεια εξόδου από τον φάκελο: μένει μόνο το όνομα
  assert.equal(pathFor("org1", "document", "abc", "../../orgs/org2/secret.pdf"), "orgs/org1/document/abc-secret.pdf");
  assert.equal(safeName("..\\..\\.env"), "file.env");
  assert.equal(safeName("///"), "file");
});

test("ο τύπος κρίνεται από το περιεχόμενο, όχι από το όνομα", () => {
  assert.equal(sniff(png), "image/png");
  assert.equal(sniff(exe), null);
  assert.deepEqual(check("photo", 1000, png), { ok: true, contentType: "image/png" });
  assert.equal(check("photo", 1000, exe).ok, false);
  assert.equal(check("logo", 3 * 1024 * 1024, png).ok, false); // πάνω από 2 MB
  assert.equal(check("photo", 0, png).ok, false);
  assert.equal(check("logo", 1000, new TextEncoder().encode("%PDF-1.7 ....")).ok, false); // PDF δεν είναι λογότυπο
  assert.equal(check("document", 1000, new TextEncoder().encode("%PDF-1.7 ....")).ok, true);
});
