import assert from "node:assert/strict";
import { test } from "node:test";
import { countedCents, diffTone, duration, initials, parseEuro } from "./drawer.ts";

test("ποσά σε ευρώ από το πληκτρολόγιο", () => {
  assert.equal(parseEuro("12,40"), 1240);
  assert.equal(parseEuro("12.4"), 1240);
  assert.equal(parseEuro(""), 0);
  assert.equal(parseEuro("1,234"), null);
  assert.equal(parseEuro("-3"), null);
});

test("μέτρηση συρταριού: τεμάχια × αξία + ψιλά", () => {
  assert.equal(countedCents({ 5000: "2", 2000: "5", 1000: "3", 500: "3", 200: "9", 100: "12", 50: "8" }, "5,40"), 28440);
  assert.equal(countedCents({}, ""), 0);
  assert.equal(countedCents({ 500: "x" }, ""), null);
});

test("χρώμα διαφοράς και διάρκεια", () => {
  assert.equal(diffTone(0), "ok");
  assert.equal(diffTone(-200), "wait");
  assert.equal(diffTone(501), "bad");
  assert.equal(duration("2026-11-26T09:02:00Z", new Date("2026-11-26T15:08:00Z")), "6 ώ 6′");
  assert.equal(duration("2026-11-26T09:02:00Z", new Date("2026-11-26T09:40:00Z")), "38′");
  assert.equal(initials("Μαρία Κ."), "ΜΚ");
});
