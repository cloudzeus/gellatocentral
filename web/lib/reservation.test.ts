import assert from "node:assert/strict";
import test from "node:test";
import { type Booking, hourlyLoad, maskPhone, normalizePhone, overlaps, phase, tableClash } from "./reservation.ts";

const at = (hhmm: string) => new Date(`2026-11-26T${hhmm}:00.000Z`);
const r = (id: string, tableId: string | null, hhmm: string, status: Booking["status"] = "BOOKED", guests = 4, durationMin = 90): Booking =>
  ({ id, tableId, startsAt: at(hhmm), durationMin, guests, status });

test("επικάλυψη: η μία τελειώνει όταν αρχίζει η άλλη, δεν συγκρούονται", () => {
  assert.equal(overlaps(at("20:00"), 90, at("21:30"), 90), false);
  assert.equal(overlaps(at("20:00"), 90, at("21:29"), 90), true);
  assert.equal(overlaps(at("21:00"), 30, at("20:00"), 90), true);
});

test("σύγκρουση τραπεζιού: μόνο ενεργές κρατήσεις του ίδιου τραπεζιού, εκτός από αυτή που αλλάζει", () => {
  const all = [r("a", "t1", "20:00"), r("b", "t1", "18:00", "NO_SHOW"), r("c", "t2", "20:30"), r("d", null, "20:00")];
  assert.equal(tableClash(all, "t1", at("21:00"), 90)?.id, "a");
  assert.equal(tableClash(all, "t1", at("21:00"), 90, "a"), null);
  assert.equal(tableClash(all, "t1", at("18:30"), 60), null); // η «δεν ήρθαν» δεν πιάνει το τραπέζι
  assert.equal(tableClash(all, "t3", at("20:00"), 90), null);
});

test("κατάσταση στη λίστα", () => {
  const now = at("20:15");
  assert.equal(phase(r("a", "t", "20:30"), now), "soon");
  assert.equal(phase(r("a", "t", "21:16"), now), "later");
  assert.equal(phase(r("a", "t", "20:10"), now), "soon"); // 5′ καθυστέρηση: ακόμη δεν «αργεί»
  assert.equal(phase(r("a", "t", "20:04"), now), "late");
  assert.equal(phase(r("a", "t", "20:00", "SEATED"), now, true), "seated");
  assert.equal(phase(r("a", "t", "18:00", "SEATED"), now, false), "done");
  assert.equal(phase(r("a", "t", "18:00", "NO_SHOW"), now), "no_show");
});

test("πληρότητα ανά ώρα: μετρά άτομα σε ενεργές κρατήσεις", () => {
  const day = at("00:00");
  const load = hourlyLoad([r("a", "t1", "20:00", "BOOKED", 4), r("b", "t2", "20:30", "SEATED", 2), r("c", "t3", "20:00", "CANCELLED", 6)], day, 12);
  assert.equal(load[19], 0);
  assert.equal(load[20], 50); // 6 από 12
  assert.equal(load[21], 50);
  assert.equal(load[22], 0);
});

test("τηλέφωνο: κρυμμένο στη λίστα, κανονικοποιημένο στην αποθήκευση", () => {
  assert.equal(maskPhone("697 123 4731"), "69•• ••• 731");
  assert.equal(maskPhone(null), null);
  assert.equal(normalizePhone("+30 697 123 4731"), "6971234731");
  assert.equal(normalizePhone("0030 210 1234567"), "2101234567");
  assert.equal(normalizePhone("6971234731"), "6971234731");
});
