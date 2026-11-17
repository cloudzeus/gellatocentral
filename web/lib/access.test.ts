import assert from "node:assert/strict";
import { test } from "node:test";
import { accountStatus, deviceLabel, permissionDiff } from "./access.ts";

test("κατάσταση λογαριασμού: ο απενεργοποιημένος υπερισχύει", () => {
  assert.equal(accountStatus({ disabledAt: new Date(), passwordHash: "x" }), "disabled");
  assert.equal(accountStatus({ disabledAt: null, passwordHash: null }), "pending");
  assert.equal(accountStatus({ disabledAt: null, passwordHash: "x" }), "active");
});
test("συσκευή από User-Agent", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"), "Chrome σε Windows");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), "Safari σε iPhone");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge σε Windows");
  assert.equal(deviceLabel(null), "Άγνωστη συσκευή");
});
test("διαφορά δικαιωμάτων ρόλου", () => {
  const l = (k: string) => k.toUpperCase();
  assert.equal(permissionDiff(["a", "b"], ["b", "c"], l), "Προστέθηκαν: C · Αφαιρέθηκαν: A");
  assert.equal(permissionDiff(["a"], ["a"], l), "Χωρίς αλλαγή δικαιωμάτων");
});
