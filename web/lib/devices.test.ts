import assert from "node:assert/strict";
import { test } from "node:test";
import { FOR, readingStatus } from "./devices.ts";

const now = new Date("2026-11-17T10:00:00Z");
const fridge = { tempMin: -25, tempMax: -15 };
const temp = (value: number, minutesAgo = 1) => ({ kind: "TEMPERATURE" as const, value, at: new Date(now.getTime() - minutesAgo * 60_000) });

test("κατάσταση θερμοκρασίας", () => {
  assert.deepEqual(readingStatus(fridge, temp(-18.4), now), { tone: "success", text: "−18,4 °C" });
  assert.equal(readingStatus(fridge, temp(-12), now).tone, "danger");
  assert.match(readingStatus(fridge, temp(-12), now).text, /πάνω από το όριο/);
  assert.match(readingStatus(fridge, temp(-30), now).text, /κάτω από το όριο/);
  assert.equal(readingStatus(fridge, temp(-15), now).tone, "success"); // το όριο το ίδιο είναι εντάξει
  assert.equal(readingStatus({ tempMin: null, tempMax: null }, temp(20), now).tone, "success"); // χωρίς όρια δεν κρίνουμε
});

test("παλιά ή καμία μέτρηση", () => {
  assert.equal(readingStatus(fridge, undefined, now).tone, "neutral");
  assert.match(readingStatus(fridge, temp(-18, 45), now).text, /χωρίς σήμα 45′/);
  assert.match(readingStatus(fridge, temp(-18, 300), now).text, /χωρίς σήμα 5 ώρες/);
  // μια καλή τιμή που είναι παλιά ΔΕΝ είναι «εντάξει»
  assert.equal(readingStatus(fridge, temp(-18, 45), now).tone, "warning");
});

test("ζύγιση και πεδία ανά είδος", () => {
  assert.equal(readingStatus(fridge, { kind: "WEIGHT", value: 2.35, at: now }, now).text, "2,4 kg");
  assert.equal(FOR.invoicing, "POS_WEB POS_ANDROID");
  assert.equal(FOR.storage, "FRIDGE VENDING_MACHINE");
  assert.ok(!FOR.network.includes("POS_WEB") && FOR.network.includes("SCALE"));
});
