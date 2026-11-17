import assert from "node:assert/strict";
import { test } from "node:test";
import { samples, templates } from "./templates.ts";

const brand = { brandName: "Gelato System", supportEmail: "help@example.com" };

test("όλα τα πρότυπα βγάζουν θέμα, HTML και απλό κείμενο", () => {
  for (const [name, m] of Object.entries(samples(brand))) {
    assert.ok(m.subject.length > 3, name);
    assert.match(m.html, /^<!doctype html>/, name);
    assert.ok(m.text.includes("Gelato System"), name);
    assert.doesNotMatch(m.html, /undefined|\[object/, name);
  }
});

test("ό,τι γράφει ο χρήστης δεν γίνεται HTML", () => {
  const m = templates.invitation(brand, { name: "<img src=x onerror=alert(1)>", orgName: 'A & B "Gelato"', role: "Ταμίας", url: "https://x.test/reset?token=a&b=1" });
  assert.doesNotMatch(m.html, /<img/);
  assert.match(m.html, /&lt;img src=x/);
  assert.match(m.html, /A &amp; B &quot;Gelato&quot;/);
  assert.match(m.html, /href="https:\/\/x\.test\/reset\?token=a&amp;b=1"/);
  assert.ok(m.text.includes("https://x.test/reset?token=a&b=1")); // στο απλό κείμενο ο σύνδεσμος μένει ως έχει
});

test("ποσά και ημερομηνίες στα ελληνικά", () => {
  const m = templates.chargeIssued(brand, { orgName: "Aurora", periodStart: new Date("2026-12-01T10:00:00Z"), periodEnd: new Date("2027-01-01T10:00:00Z"), stores: 2, devices: 3, amountCents: 16300 });
  assert.match(m.subject, /163,00\s€/);
  assert.match(m.text, /1 Δεκεμβρίου 2026/);
});
