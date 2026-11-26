import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalProblem, type TerminalCheckDeps } from "./terminal-check.ts";

const deps = (over: Partial<TerminalCheckDeps> = {}): TerminalCheckDeps => ({
  findOther: async () => null,
  issuer: async () => ({ name: "Παγωτά ΑΕ", vatNumber: "123456789", vivaMerchantId: "m-1" }),
  vivaConfigured: async () => true,
  merchantTerminals: async () => ["16000010"],
  ...over,
});
const input = { terminalId: "16000010", orgId: "org-1", storeId: "store-1", deviceId: "dev-1" };

test("τερματικό του εμπόρου, ελεύθερο: περνά", async () => {
  assert.equal(await terminalProblem(input, deps()), null);
});

test("κενό τερματικό: περνά χωρίς ερωτήματα", async () => {
  const fail = async () => { throw new Error("δεν έπρεπε να κληθεί"); };
  assert.equal(await terminalProblem({ ...input, terminalId: " " }, deps({ findOther: fail, issuer: fail })), null);
});

test("το ίδιο τερματικό σε άλλο ταμείο της επιχείρησης: λέει ποιο, και εξαιρεί το ίδιο ταμείο", async () => {
  let except: string | undefined;
  const msg = await terminalProblem(input, deps({ findOther: async (_t, e) => { except = e; return { orgId: "org-1", name: "Ταμείο 2", store: "Κέντρο" }; } }));
  assert.equal(except, "dev-1");
  assert.match(msg!, /Ταμείο 2.*Κέντρο/);
});

test("το ίδιο τερματικό σε άλλη επιχείρηση: δεν αποκαλύπτει στοιχεία της", async () => {
  const msg = await terminalProblem(input, deps({ findOther: async () => ({ orgId: "org-2", name: "Ξένο", store: "Ξένο κατάστημα" }) }));
  assert.match(msg!, /άλλη επιχείρηση/);
  assert.doesNotMatch(msg!, /Ξένο/);
});

test("τερματικό που δεν ανήκει στον έμπορο του εκδότη: απορρίπτεται με τον ΑΦΜ", async () => {
  const msg = await terminalProblem(input, deps({ merchantTerminals: async () => ["99999999"] }));
  assert.match(msg!, /δεν βρέθηκε.*123456789/);
});

test("χωρίς έμπορο ή χωρίς κλειδιά ISV (δοκιμαστική λειτουργία): δεν ρωτά τη Viva", async () => {
  const fail = async () => { throw new Error("δεν έπρεπε να κληθεί"); };
  assert.equal(await terminalProblem(input, deps({ issuer: async () => ({ name: "x", vatNumber: "1", vivaMerchantId: null }), merchantTerminals: fail })), null);
  assert.equal(await terminalProblem(input, deps({ vivaConfigured: async () => false, merchantTerminals: fail })), null);
});

test("η Viva δεν απαντά: δεν αποθηκεύεται, με μήνυμα για νέα προσπάθεια", async () => {
  const msg = await terminalProblem(input, deps({ merchantTerminals: async () => { throw new Error("timeout"); } }));
  assert.match(msg!, /Δοκίμασε ξανά/);
});
