import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, cleanChannel, contactTone, dueText, formDate, mergeTimeline, monthBuckets, showPhone, taskState, type TimelineItem } from "./crm.ts";

const now = new Date("2026-11-18T10:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);

test("κανάλια: τηλέφωνο και email καθαρίζονται ή απορρίπτονται", () => {
  assert.equal(cleanChannel("phone", "210 123-4567"), "2101234567");
  assert.equal(cleanChannel("phone", "0030 694 1234567"), "+306941234567");
  assert.equal(cleanChannel("phone", "12"), null);
  assert.equal(cleanChannel("email", " Info@Example.GR "), "info@example.gr");
  assert.equal(cleanChannel("email", "info@"), null);
  assert.equal(showPhone("2101234567"), "210 123 4567");
});

test("πότε μιλήσαμε τελευταία φορά", () => {
  assert.equal(ago(now, now), "σήμερα");
  assert.equal(ago(day(-1), now), "χθες");
  assert.equal(ago(day(-12), now), "πριν 12 ημέρες");
  assert.equal(contactTone(null, now), "warning");
  assert.equal(contactTone(day(-3), now), "success");
  assert.equal(contactTone(day(-90), now), "warning");
});

test("εργασίες: εκπρόθεσμη, σημερινή, επόμενη, ολοκληρωμένη", () => {
  assert.equal(taskState({ dueAt: day(-2), doneAt: null }, now), "overdue");
  assert.equal(taskState({ dueAt: now, doneAt: null }, now), "today");
  assert.equal(taskState({ dueAt: day(3), doneAt: null }, now), "upcoming");
  assert.equal(taskState({ dueAt: day(-2), doneAt: now }, now), "done");
  assert.equal(taskState({ dueAt: null, doneAt: null }, now), "open");
  assert.equal(dueText(day(-3), now), "άργησε 3 ημέρες");
  assert.equal(dueText(day(1), now), "αύριο");
  assert.equal(formDate("2026-11-20")?.toISOString(), "2026-11-20T12:00:00.000Z");
  assert.equal(formDate("20/11/2026"), null);
});

test("χρονολόγιο: καρφιτσωμένα πρώτα, μετά τα νεότερα, με φίλτρο", () => {
  const i = (id: string, at: Date, kind: string, extra: Partial<TimelineItem> = {}): TimelineItem => ({ id, at, kind, title: id, ...extra });
  const lists = [[i("note", day(-5), "note", { pinned: true }), i("call", day(-1), "call")], [i("charge", day(-2), "charge", { auto: true }), i("task", day(-3), "task")]];
  assert.deepEqual(mergeTimeline(lists).map((x) => x.id), ["note", "call", "charge", "task"]);
  assert.deepEqual(mergeTimeline(lists, "contact").map((x) => x.id), ["call"]);
  assert.deepEqual(mergeTimeline(lists, "auto").map((x) => x.id), ["charge"]);
});

test("επικοινωνίες ανά μήνα: έξι μήνες, ο τρέχων τελευταίος", () => {
  const b = monthBuckets([now, day(-1), day(-40), day(-400)], now);
  assert.equal(b.length, 6);
  assert.equal(b[5].key, "2026-11");
  assert.equal(b[5].count, 2);
  assert.equal(b[4].count, 1);
  assert.equal(b.reduce((s, x) => s + x.count, 0), 3);
});
