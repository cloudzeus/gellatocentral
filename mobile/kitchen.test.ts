import assert from "node:assert/strict";
import test from "node:test";
import { ageLevel, totalsOf, waiting } from "./kitchen.ts";
import type { KTicket } from "./kitchen-api.ts";

const tk = (lines: [string, number, boolean?, boolean?][]): KTicket => ({
  key: "k", roundId: "r", station: "KITCHEN", number: 1, title: "Τ1", waiter: null, sentAt: "",
  lines: lines.map(([name, quantity, ready = false, voided = false], i) => ({ id: String(i), name, quantity, options: "", note: null, seat: null, ready, voided })),
});

test("χρώμα αναμονής: ως 8′ πράσινο, 8–15′ κίτρινο, από 15′ κόκκινο", () => {
  assert.deepEqual([0, 7, 8, 14, 15, 40].map((m) => ageLevel(m, 8, 15)), ["ok", "ok", "wait", "wait", "bad", "bad"]);
});

test("σύνολα χωρίς τα έτοιμα και τα ακυρωμένα", () => {
  const ts = [tk([["Κρέπα", 2], ["Βάφλα", 1, true]]), tk([["Κρέπα", 1], ["Τοστ", 1, false, true], ["Βάφλα", 1]])];
  assert.deepEqual(totalsOf(ts), [{ name: "Κρέπα", quantity: 3 }, { name: "Βάφλα", quantity: 1 }]);
  assert.deepEqual(waiting(ts), { tickets: 2, items: 4 });
});
