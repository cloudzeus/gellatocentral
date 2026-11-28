import assert from "node:assert/strict";
import test from "node:test";
import { type KLine, type KRound, stats, tickets, totals } from "./kitchen-board.ts";

const at = (m: number) => new Date(2026, 10, 28, 21, m);
const ln = (id: string, station: KLine["station"], o: Partial<KLine> = {}): KLine => ({ id, name: id, quantity: 1, options: null, note: null, seat: null, readyAt: null, voidedAt: null, station, ...o });
const round = (id: string, sent: number, lines: KLine[]): KRound => ({ id, number: 1, sentAt: at(sent), sentByName: "Μαρία", table: "7", label: null, waiter: null, lines });

test("ένας γύρος με κρέπα και καφέ γίνεται δύο δελτία, ένα ανά σταθμό· το παγωτό δεν πάει πουθενά", () => {
  const ts = tickets([round("r", 0, [ln("Κρέπα", "KITCHEN"), ln("Φρέντο", "BAR"), ln("Παγωτό", null)])]);
  assert.deepEqual(ts.map((t) => [t.station, t.lines.map((l) => l.name)]), [["KITCHEN", ["Κρέπα"]], ["BAR", ["Φρέντο"]]]);
  assert.equal(ts[0].title, "Τ7");
  assert.deepEqual(tickets([round("r", 0, [ln("Κρέπα", "KITCHEN"), ln("Φρέντο", "BAR")])], "BAR").map((t) => t.station), ["BAR"]);
});

test("το δελτίο φεύγει όταν όλα είναι έτοιμα ή ακυρωμένα· ως τότε δείχνει και τα ακυρωμένα", () => {
  const open = tickets([round("r", 0, [ln("a", "KITCHEN", { readyAt: at(5) }), ln("b", "KITCHEN", { voidedAt: at(3) }), ln("c", "KITCHEN")])]);
  assert.deepEqual(open[0].lines.map((l) => [l.ready, l.voided]), [[true, false], [false, true], [false, false]]);
  assert.equal(tickets([round("r", 0, [ln("a", "KITCHEN", { readyAt: at(5) }), ln("b", "KITCHEN", { voidedAt: at(3) })])]).length, 0);
  // σερβιρίστηκε πριν πατηθεί «έτοιμο»: έφυγε από την κουζίνα
  assert.equal(tickets([round("r", 0, [ln("a", "KITCHEN", { servedAt: at(5) })])]).length, 0);
});

test("παλαιότερο δελτίο πρώτο και σύνολα μόνο από ό,τι μένει", () => {
  const ts = tickets([round("new", 10, [ln("Κρέπα", "KITCHEN", { quantity: 2 })]), round("old", 0, [ln("Κρέπα", "KITCHEN", { quantity: 1 }), ln("Βάφλα", "KITCHEN", { readyAt: at(2) })])]);
  assert.deepEqual(ts.map((t) => t.roundId), ["old", "new"]);
  assert.deepEqual(totals(ts), [{ name: "Κρέπα", quantity: 3 }]);
});

test("επιλογές σε κείμενο: η ίδια γεύση δύο φορές γράφεται 2×", () => {
  const [t] = tickets([round("r", 0, [ln("Κύπελλο", "KITCHEN", { options: [{ name: "Βανίλια", priceCents: 0 }, { name: "Βανίλια", priceCents: 0 }, { name: "Φράουλα", priceCents: 0 }] })])]);
  assert.equal(t.lines[0].options, "2× Βανίλια, Φράουλα");
});

test("χρόνος δελτίου ως το τελευταίο έτοιμο είδος, μέσος όρος και καθυστερήσεις", () => {
  const s = stats([
    { roundId: "a", station: "KITCHEN", sentAt: at(0), readyAt: at(4) },
    { roundId: "a", station: "KITCHEN", sentAt: at(0), readyAt: at(6) },
    { roundId: "b", station: "KITCHEN", sentAt: at(10), readyAt: at(30) },
  ], 15);
  assert.equal(s.count, 2);
  assert.equal(s.avgMin, 13);
  assert.equal(s.late, 1);
  assert.deepEqual(s.byHour, [{ hour: 21, avgMin: 13, count: 2 }]);
});
