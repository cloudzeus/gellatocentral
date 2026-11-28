// Δοκιμές του ελέγχου αποδείξεων με την ΑΑΔΕ: σύγκριση ημέρας με περιθώριο βραδιών, ημέρες του παραθύρου, σύνολα της ΑΑΔΕ.
import assert from "node:assert/strict";
import test from "node:test";
import { athensDay, checkDays, dayStatus, GRACE_NIGHTS, WINDOW_DAYS } from "./mydata-receipts-match.ts";
import { parseBookInfo } from "./mydata-parse.ts";

const now = new Date("2026-11-28T01:10:00Z");
const D = 86_400_000;

test("ίδιο πλήθος και σύνολο (ανοχή 1 λεπτό) = συμφωνεί και μηδενίζει την αρχή διαφοράς", () => {
  assert.deepEqual(dayStatus({ count: 3, cents: 1250 }, { count: 3, cents: 1251 }, new Date(0), now), { status: "MATCH", firstDiffAt: null });
});

test("διαφορά: περιμένει ως το τρίτο βράδυ και μετά γίνεται κόκκινη", () => {
  const first = dayStatus({ count: 3, cents: 1250 }, { count: 2, cents: 1000 }, null, now);
  assert.equal(first.status, "WAITING");
  assert.equal(first.firstDiffAt?.getTime(), now.getTime());
  assert.equal(dayStatus({ count: 3, cents: 1250 }, null, first.firstDiffAt, new Date(now.getTime() + D)).status, "WAITING");
  assert.equal(dayStatus({ count: 3, cents: 1250 }, null, first.firstDiffAt, new Date(now.getTime() + (GRACE_NIGHTS - 1) * D)).status, "DIFF");
});

test("καμία γραμμή στην ΑΑΔΕ και καμία δική μας = συμφωνεί", () => {
  assert.equal(dayStatus({ count: 0, cents: 0 }, null, null, now).status, "MATCH");
});

test("ημέρες ως χθες σε ώρα Ελλάδας", () => {
  const days = checkDays(now);
  assert.equal(days.length, WINDOW_DAYS);
  assert.equal(days.at(-1), "2026-11-27");
  assert.equal(athensDay(new Date("2026-11-27T22:30:00Z")), "2026-11-28"); // 00:30 στην Αθήνα
});

test("RequestMyIncome: αθροίζει γραμμές της ίδιας ημέρας και τύπου", () => {
  const xml = `<RequestedBookInfo xmlns="http://www.aade.gr/myDATA/invoice/v1.0">
    <bookInfo><issueDate>2026-11-19</issueDate><invType>11.1</invType><grossValue>1899.90</grossValue><count>180</count></bookInfo>
    <bookInfo><issueDate>2026-11-19</issueDate><invType>11.1</invType><selfpricing>true</selfpricing><grossValue>10.00</grossValue><count>3</count></bookInfo>
    <bookInfo><issueDate>2026-11-19</issueDate><invType>11.4</invType><grossValue>-4.50</grossValue><count>1</count></bookInfo>
  </RequestedBookInfo>`;
  assert.deepEqual(parseBookInfo(xml), [
    { day: "2026-11-19", invType: "11.1", count: 183, grossCents: 190990 },
    { day: "2026-11-19", invType: "11.4", count: 1, grossCents: 450 },
  ]);
});
