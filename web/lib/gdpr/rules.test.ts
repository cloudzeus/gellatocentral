import assert from "node:assert/strict";
import { test } from "node:test";
import { currentConsents, daysLeft, dueDate, hasConsent, subjectHash } from "./rules.ts";

const at = (d: string) => new Date(`2026-${d}T10:00:00Z`);

test("συναίνεση: μετρά η πιο πρόσφατη γραμμή και η σωστή έκδοση", () => {
  const rows = [
    { purpose: "marketing", version: "1", granted: true, at: at("01-10") },
    { purpose: "marketing", version: "1", granted: false, at: at("03-02") }, // ανάκληση
    { purpose: "legal", version: "2026-01", granted: true, at: at("01-10") },
  ];
  assert.equal(hasConsent(rows, "marketing", "1"), false);
  assert.equal(hasConsent(rows, "legal", "2026-01"), true);
  assert.equal(hasConsent(rows, "legal", "2026-11"), false); // νέα έκδοση όρων = θέλει νέα αποδοχή
  assert.equal(hasConsent([], "legal", "2026-01"), false);
  // η σειρά των γραμμών δεν παίζει ρόλο
  assert.equal(currentConsents([...rows].reverse()).get("marketing")?.granted, false);
});

test("προθεσμία 30 ημερών και εκπρόθεσμα", () => {
  const due = dueDate(at("01-01"));
  assert.equal(due.toISOString().slice(0, 10), "2026-01-31");
  assert.equal(daysLeft(due, at("01-21")), 10);
  assert.equal(daysLeft(due, at("02-05")) < 0, true);
});

test("το αποτύπωμα δεν εξαρτάται από κεφαλαία και κενά, και δεν είναι το ίδιο το email", () => {
  assert.equal(subjectHash(" Maria@Example.com "), subjectHash("maria@example.com"));
  assert.notEqual(subjectHash("maria@example.com"), subjectHash("mario@example.com"));
  assert.equal(subjectHash("maria@example.com").includes("maria"), false);
});
