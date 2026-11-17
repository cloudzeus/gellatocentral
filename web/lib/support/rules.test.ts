import assert from "node:assert/strict";
import { test } from "node:test";
import { afterMessage, priorityFor, responseClock } from "./rules.ts";

const at = (m: number) => new Date(Date.UTC(2026, 10, 17, 10, m));

test("προτεραιότητα από κατηγορία και επείγον", () => {
  assert.equal(priorityFor("pos", "blocked"), "CRITICAL");
  assert.equal(priorityFor("devices", "hard"), "HIGH");
  assert.equal(priorityFor("usage", "calm"), "NORMAL");
  assert.equal(priorityFor("idea", "blocked"), "LOW"); // μια πρόταση δεν σταματά τη δουλειά
});

test("κατάσταση μετά από μήνυμα", () => {
  assert.equal(afterMessage("NEW", "support", false), "WAITING_CUSTOMER");
  assert.equal(afterMessage("NEW", "support", true), "NEW"); // εσωτερική σημείωση: ο πελάτης δεν έχει πάρει απάντηση
  assert.equal(afterMessage("WAITING_CUSTOMER", "customer", false), "OPEN");
  assert.equal(afterMessage("RESOLVED", "customer", false), "OPEN"); // ξανανοίγει
  assert.equal(afterMessage("CLOSED", "support", false), "CLOSED");
});

test("χρόνος πρώτης απάντησης", () => {
  const t = { priority: "CRITICAL" as const, status: "NEW" as const, createdAt: at(0), firstResponseAt: null };
  assert.deepEqual([responseClock(t, at(5)).minutesLeft, responseClock(t, at(5)).tone], [10, "warning"]);
  assert.equal(responseClock(t, at(40)).tone, "danger"); // 15′ στόχος, πέρασαν 40′
  assert.equal(responseClock({ ...t, firstResponseAt: at(9) }, at(40)).tone, "success");
  assert.equal(responseClock({ ...t, firstResponseAt: at(30) }, at(40)).tone, "warning"); // απαντήθηκε, αλλά εκτός στόχου
  assert.equal(responseClock({ ...t, priority: "NORMAL" }, at(30)).tone, "neutral");
  assert.equal(responseClock({ ...t, status: "RESOLVED" }, at(90)).minutesLeft, null); // λύθηκε χωρίς απάντηση: δεν μετρά πια
});
