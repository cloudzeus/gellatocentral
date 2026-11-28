import assert from "node:assert/strict";
import test from "node:test";
import { canReceive, roleHasCash, roleViews, SPECIALTIES, suggestedRole } from "./specialties.ts";

test("οι 16 ειδικότητες που ζητήθηκαν, μοναδικά κλειδιά", () => {
  assert.equal(SPECIALTIES.length, 16);
  assert.equal(new Set(SPECIALTIES.map((s) => s.key)).size, 16);
});

test("ο ρόλος κρίνει μενού, κάσα και παραλαβή", () => {
  assert.deepEqual(roleViews("storekeeper"), ["receiving", "stock"]);
  assert.equal(canReceive("storekeeper"), true);
  assert.equal(canReceive("waiter"), false);
  assert.equal(roleHasCash("cashier"), true);
  assert.equal(roleHasCash("waiter"), false);
  assert.deepEqual(roleViews("dishwasher"), []);
  assert.equal(roleViews(null).length, 7); // χωρίς ρόλο: όλα, όπως πριν
  assert.equal(canReceive(null), true);
});

test("προτεινόμενος ρόλος: της βάρδιας, μετά ο κύριος", () => {
  const s = [{ specialty: "waiter", isPrimary: false }, { specialty: "cashier", isPrimary: true }];
  assert.equal(suggestedRole(s, "waiter"), "waiter");
  assert.equal(suggestedRole(s, "chef"), "cashier");
  assert.equal(suggestedRole(s), "cashier");
  assert.equal(suggestedRole([]), null);
});
