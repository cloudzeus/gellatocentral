import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { canMove, distanceM, perMonth, usualItems } from "./order.ts";
import { parseEvent, verifySignature } from "./telephony/yeastar.ts";

test("μεταβάσεις: η παραλαβή δεν βγαίνει σε διανομέα, οι κλειστές δεν αλλάζουν", () => {
  assert.equal(canMove("NEW", "ACCEPTED", true), true);
  assert.equal(canMove("NEW", "READY", true), false);
  assert.equal(canMove("READY", "OUT", false), false);
  assert.equal(canMove("READY", "DELIVERED", false), true);
  assert.equal(canMove("DELIVERED", "CANCELLED", true), false);
});

test("τι παίρνει συνήθως: μετράει επισκέψεις, όχι τεμάχια", () => {
  const v = [
    [{ productId: "a", name: "Φιστίκι", quantity: 3 }, { productId: "a", name: "Φιστίκι", quantity: 1 }],
    [{ productId: "b", name: "Εσπρέσο", quantity: 1 }, { productId: "a", name: "Φιστίκι", quantity: 1 }],
    [{ productId: "b", name: "Εσπρέσο", quantity: 2 }],
    [{ productId: null, name: "Wolt special", quantity: 9 }],
  ];
  const top = usualItems(v);
  assert.deepEqual(top.map((x) => [x.name, x.visits]), [["Φιστίκι", 2], ["Εσπρέσο", 2], ["Wolt special", 1]]);
  assert.equal(top[0].quantity, 5);
  assert.equal(top[2].productId, null);
});

test("ανά μήνα: έξι μήνες, ο τρέχων τελευταίος, έξω από το διάστημα δεν μετράει", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  const rows = perMonth([new Date("2026-11-02T10:00:00Z"), new Date("2026-11-20T10:00:00Z"), new Date("2026-06-10T10:00:00Z"), new Date("2025-01-01T10:00:00Z")], now);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.at(-1), { month: "2026-11", count: 2 });
  assert.deepEqual(rows[0], { month: "2026-06", count: 1 });
});

test("απόσταση: Σύνταγμα → Μοναστηράκι περίπου 900 μ.", () => {
  const d = distanceM({ lat: 37.9755, lng: 23.7348 }, { lat: 37.9760, lng: 23.7256 });
  assert.ok(d > 700 && d < 1000, String(d));
});

test("Yeastar: υπογραφή από το ακατέργαστο σώμα, λάθος ή κενή απορρίπτεται", () => {
  const raw = '{"type":30011}';
  const sig = createHmac("sha256", "s".repeat(32)).update(raw).digest("base64");
  assert.equal(verifySignature(raw, "s".repeat(32), sig), true);
  assert.equal(verifySignature(raw + " ", "s".repeat(32), sig), false);
  assert.equal(verifySignature(raw, "s".repeat(32), null), false);
  assert.equal(verifySignature(raw, "s".repeat(32), "abc"), false);
});

test("Yeastar 30011: χτυπά εσωτερικό, απάντηση, τέλος· εσωτερική κλήση αγνοείται", () => {
  const ev = (status: string, ext = "201") => ({
    type: 30011, sn: "x",
    msg: JSON.stringify({ call_id: "1700-5", members: [{ inbound: { from: "6944123456", to: "2101234567", member_status: status === "RING" ? "ALERT" : status } }, { extension: { number: ext, member_status: status } }] }),
  });
  assert.deepEqual(parseEvent(ev("RING")), { kind: "ring", callId: "1700-5", from: "6944123456", extension: "201" });
  assert.deepEqual(parseEvent(ev("ANSWERED")), { kind: "answered", callId: "1700-5", extension: "201" });
  assert.deepEqual(parseEvent(ev("BYE")), { kind: "ended", callId: "1700-5" });
  assert.equal(parseEvent({ type: 30011, msg: { call_id: "9", members: [{ extension: { number: "201", member_status: "RING" } }] } }), null);
  assert.deepEqual(parseEvent({ type: 30012, msg: { call_id: 9 } }), { kind: "ended", callId: "9" });
  assert.equal(parseEvent({ type: 30016, msg: {} }), null);
  assert.equal(parseEvent("nope"), null);
});
