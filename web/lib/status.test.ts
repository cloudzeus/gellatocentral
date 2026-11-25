import assert from "node:assert/strict";
import { test } from "node:test";

import { daysUntil, dueStatus, paymentStatus, STATUS_KINDS, statusOf, statusOptions } from "./status.ts";

const now = new Date("2026-11-25T10:00:00Z");
const inDays = (n: number) => new Date(now.getTime() + n * 864e5);

test("statusOf: ο τόνος ορίζει το εικονίδιο, παντού το ίδιο", () => {
  assert.deepEqual(statusOf("fiscal", "FAILED"), { tone: "danger", text: "Απέτυχε — θέλει ενέργεια", icon: "TriangleAlert" });
  assert.deepEqual(statusOf("wholesaleOrder", "CONFIRMED").icon, "Clock");
  assert.deepEqual(statusOf("wholesaleOrder", "DELIVERED"), { tone: "success", text: "Παραδόθηκε", icon: "Check" });
  assert.deepEqual(statusOf("purchaseOrder", "DRAFT"), { tone: "neutral", text: "Πρόχειρη", icon: null });
});

test("statusOf: πρόχειρο και ακυρωμένο είναι πάντα ουδέτερα, χωρίς εικονίδιο", () => {
  for (const kind of STATUS_KINDS) for (const value of ["DRAFT", "CANCELLED"]) {
    const s = statusOf(kind, value);
    if (s.text !== "Άγνωστη κατάσταση") assert.equal(s.tone, "neutral", `${kind}.${value}`);
  }
});

test("statusOf: καμία αγγλική τιμή enum στην οθόνη, ούτε για άγνωστη τιμή", () => {
  for (const kind of STATUS_KINDS) for (const [value, text] of statusOptions(kind)) {
    assert.doesNotMatch(text, /[A-Z]{2,}_|^[A-Z_]+$/, `${kind}.${value}`);
    assert.match(text, /[Α-Ωα-ωά-ώ]/, `${kind}.${value}`);
  }
  assert.deepEqual(statusOf("sale", "SOMETHING_NEW"), { tone: "neutral", text: "Άγνωστη κατάσταση", icon: null });
  assert.equal(statusOf("sale", null).text, "Άγνωστη κατάσταση");
});

test("daysUntil: μετρά ημερολογιακές ημέρες στην ώρα Αθήνας, όχι 24ωρα", () => {
  // 23:30 Αθήνας σήμερα → 00:30 Αθήνας αύριο: μία ώρα μετά, αλλά «αύριο»
  assert.equal(daysUntil(new Date("2026-11-25T22:30:00Z"), new Date("2026-11-25T21:30:00Z")), 1);
  assert.equal(daysUntil(inDays(0), now), 0);
  assert.equal(daysUntil(inDays(-12), now), -12);
});

test("paymentStatus: λέει το «πόσο» και τι θέλει ενέργεια", () => {
  assert.deepEqual(paymentStatus({ outstandingCents: 5000, dueAt: inDays(-12) }, now), { tone: "danger", text: "Άργησε 12 ημ.", icon: "TriangleAlert" });
  assert.deepEqual(paymentStatus({ outstandingCents: 5000, dueAt: inDays(3) }, now), { tone: "warning", text: "Λήγει σε 3 ημ.", icon: "Clock" });
  assert.deepEqual(paymentStatus({ outstandingCents: 5000, dueAt: inDays(7) }, now).tone, "warning");
  assert.deepEqual(paymentStatus({ outstandingCents: 5000, dueAt: inDays(8) }, now), { tone: "neutral", text: "Λήγει σε 8 ημ.", icon: null });
  assert.deepEqual(paymentStatus({ outstandingCents: 5000, dueAt: inDays(0) }, now), { tone: "warning", text: "Λήγει σήμερα", icon: "Clock" });
  assert.deepEqual(paymentStatus({ outstandingCents: 0, dueAt: inDays(-12) }, now), { tone: "success", text: "Πληρώθηκε", icon: "Check" });
  assert.deepEqual(paymentStatus({ outstandingCents: 5000 }, now), { tone: "warning", text: "Απλήρωτο", icon: "Clock" });
  assert.deepEqual(paymentStatus({ outstandingCents: 5000, dueAt: inDays(-12), cancelled: true }, now), { tone: "neutral", text: "Ακυρώθηκε", icon: null });
});

test("dueStatus: τίποτα όταν δεν εκκρεμεί πια ή δεν έχει προθεσμία", () => {
  assert.equal(dueStatus(inDays(-3), now, true), null);
  assert.equal(dueStatus(null, now), null);
  assert.equal(dueStatus(inDays(-3), now)?.text, "Άργησε 3 ημ.");
  assert.equal(dueStatus(inDays(2), now)?.tone, "warning");
});
