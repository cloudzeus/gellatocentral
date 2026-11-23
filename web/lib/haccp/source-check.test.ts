import assert from "node:assert/strict";
import test from "node:test";
import { nextSourceStatus } from "./source-status.ts";
import { sourceFingerprint } from "./source-fingerprint.ts";

const current = { fingerprint: "abc", finalUrl: "https://example.com/a", url: "https://example.com/a" };
test("πρώτος έλεγχος απαιτεί αναθεώρηση", () => assert.equal(nextSourceStatus(null, current), "REVIEW"));
test("ίδιο περιεχόμενο παραμένει OK", () => assert.equal(nextSourceStatus({ ...current, finalUrl: current.finalUrl }, current), "OK"));
test("αλλαγή περιεχομένου ή τελικού URL επισημαίνεται", () => {
  assert.equal(nextSourceStatus({ ...current }, { ...current, fingerprint: "new" }), "CHANGED");
  assert.equal(nextSourceStatus({ ...current }, { ...current, finalUrl: "https://example.com/b" }), "CHANGED");
});

test("HTML: δυναμικά scripts/tokens δεν αλλάζουν το αποτύπωμα, το κείμενο όμως αλλάζει", () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  const a = sourceFingerprint("text/html", encode("<html><script>token=1</script><p>Άρθρο 5</p></html>"));
  const b = sourceFingerprint("text/html", encode("<html><script>token=2</script><p>Άρθρο 5</p></html>"));
  const changed = sourceFingerprint("text/html", encode("<html><script>token=2</script><p>Άρθρο 6</p></html>"));
  assert.equal(a, b);
  assert.notEqual(a, changed);
});
