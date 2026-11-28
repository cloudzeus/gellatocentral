import assert from "node:assert/strict";
import { test } from "node:test";

import { elapsedLabel, finalStatus, plainReason, shouldFlush, STALE_MS, STALE_REASON, taskView, type TaskRow } from "./task-progress.ts";

const now = new Date("2026-11-25T12:02:30Z"); // 14:02 Αθήνας
const row = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: "t1", userId: "u1", kind: "catalog.enrich", title: "Εμπλουτισμός κατασκευαστών", status: "RUNNING", total: 12, done: 7, failed: 1,
  current: "Α-1009", error: null, resultHref: null, failures: null, seenAt: null,
  startedAt: new Date(now.getTime() - 12_000), heartbeatAt: new Date(now.getTime() - 1_000), finishedAt: null, ...over,
});

test("finalStatus: όλα, μερικά, κανένα· αν έσκασε απέτυχε ολόκληρη", () => {
  assert.equal(finalStatus({ done: 12, failed: 0, threw: false }), "DONE");
  assert.equal(finalStatus({ done: 10, failed: 2, threw: false }), "PARTIAL");
  assert.equal(finalStatus({ done: 0, failed: 3, threw: false }), "FAILED");
  assert.equal(finalStatus({ done: 8, failed: 0, threw: true }), "FAILED");
  assert.equal(finalStatus({ done: 0, failed: 0, threw: false }), "DONE");
});

test("taskView: εργασία που μετρά βήματα δείχνει «8 από 12» και «Τώρα: …», ποτέ ποσοστό", () => {
  const v = taskView(row(), "u1", now, false);
  assert.equal(v.status, "RUNNING");
  assert.equal(v.progress, "8 από 12");
  assert.equal(v.current, "Τώρα: Α-1009");
  assert.equal(v.elapsed, null);
  assert.doesNotMatch(JSON.stringify(v), /%/);
});

test("taskView: εργασία χωρίς βήματα δείχνει μόνο πόση ώρα τρέχει", () => {
  const v = taskView(row({ total: null, done: 0, failed: 0, current: null }), "u1", now, false);
  assert.equal(v.counted, false);
  assert.equal(v.progress, null);
  assert.equal(v.elapsed, "Τρέχει εδώ και 12 δευτ.");
});

test("taskView: έγινε, έγινε εν μέρει, απέτυχε", () => {
  const finishedAt = new Date("2026-11-25T12:02:00Z");
  const done = taskView(row({ status: "DONE", done: 12, failed: 0, finishedAt, resultHref: "/migration?run=1" }), "u1", now, false);
  assert.deepEqual([done.finished, done.resultHref, done.error, done.unseen], ["14:02", "/migration?run=1", null, false]);
  const failures = [{ id: "m1", label: "ΤΩΝ 150", reason: "Δεν απάντησε η υπηρεσία" }, { id: "m2", label: "ΑΓΓΕΛΑΚΗΣ", reason: "Δεν απάντησε η υπηρεσία" }];
  const partial = taskView(row({ status: "PARTIAL", done: 10, failed: 2, finishedAt, failures }), "u1", now, true);
  assert.deepEqual([partial.summary, partial.failuresHref, partial.canRetry, partial.unseen], ["10 από 12 έγιναν", "/tasks/t1", true, true]);
  const failed = taskView(row({ status: "FAILED", done: 0, failed: 0, finishedAt, error: "Το αρχείο δεν είναι έγκυρο" }), "u1", now, true);
  assert.deepEqual([failed.error, failed.canRetry, failed.resultHref], ["Το αρχείο δεν είναι έγκυρο", false, null]);
});

test("taskView: «Ξανά» μόνο όπου το είδος το δηλώνει ασφαλές και μόνο για ό,τι απέτυχε", () => {
  const failures = [{ id: "m1", label: "ΤΩΝ 150", reason: "Δεν απάντησε" }];
  assert.equal(taskView(row({ status: "PARTIAL", failures }), "u1", now, false).canRetry, false);
  assert.equal(taskView(row({ status: "PARTIAL", failures: [{ label: "χωρίς id", reason: "x" }] }), "u1", now, true).canRetry, false);
  assert.equal(taskView(row({ status: "DONE", failures }), "u1", now, true).canRetry, false);
});

test("taskView: η αποτυχία είναι «αδιάβαστη» μόνο για όποιον την ξεκίνησε, ώσπου να τη δει", () => {
  assert.equal(taskView(row({ status: "FAILED" }), "u1", now, false).unseen, true);
  assert.equal(taskView(row({ status: "FAILED" }), "άλλος", now, false).unseen, false);
  assert.equal(taskView(row({ status: "FAILED", seenAt: now }), "u1", now, false).unseen, false);
});

test("taskView: εργασία χωρίς σημάδι ζωής θεωρείται διακομμένη, χωρίς «Ξανά»", () => {
  const v = taskView(row({ heartbeatAt: new Date(now.getTime() - STALE_MS - 1), failures: [{ id: "a", label: "a", reason: "b" }] }), "u1", now, true);
  assert.deepEqual([v.status, v.error, v.canRetry, v.progress], ["FAILED", STALE_REASON, false, null]);
});

test("plainReason: ελληνικό μήνυμα περνά, τεχνικό ποτέ", () => {
  assert.equal(plainReason(new Error("Ο προμηθευτής δεν έχει email")), "Ο προμηθευτής δεν έχει email");
  for (const technical of [new Error("ECONNREFUSED 127.0.0.1:5432"), new Error("Cannot read properties of undefined"), "PrismaClientKnownRequestError: Λάθος", null, 42])
    assert.match(plainReason(technical), /^Κάτι δεν πήγε καλά/);
});

test("elapsedLabel και shouldFlush", () => {
  assert.equal(elapsedLabel(0), "Τρέχει εδώ και 0 δευτ.");
  assert.equal(elapsedLabel(75), "Τρέχει εδώ και 1 λεπτό");
  assert.equal(elapsedLabel(185), "Τρέχει εδώ και 3 λεπτά");
  assert.equal(shouldFlush(1000, 1399), false);
  assert.equal(shouldFlush(1000, 1400), true);
});

test("εργασία με βήματα και χωρίς αποτυχίες δείχνει «Δες τα βήματα»", () => {
  const steps = [{ label: "Κατάστημα Πειραιά · ΑΦΜ 803164419", detail: "3 παραστατικά εξόδων" }];
  const v = taskView(row({ status: "DONE", steps }), "u1", new Date(), false);
  assert.equal(v.stepsHref, `/tasks/${v.id}`);
  assert.equal(taskView(row({ status: "PARTIAL", steps, failures: [{ label: "x", reason: "y" }] }), "u1", new Date(), false).stepsHref, null);
});
