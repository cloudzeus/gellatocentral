import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// Ο matcher είναι λίστα εξαιρέσεων: κάθε νέα δημόσια διαδρομή πρέπει να μπει εδώ, αλλιώς πάει στο /login.
// Το proxy.ts εισάγει next/server, που δεν φορτώνει στο node --test: διαβάζουμε τον matcher από το αρχείο.
const matcher = /matcher: \["([^"]+)"\]/.exec(readFileSync(new URL("../proxy.ts", import.meta.url), "utf8"))![1];
const guarded = (path: string) => new RegExp(`^${matcher}$`).test(path);

test("proxy: οι δημόσιες διαδρομές δεν ζητούν cookie", () => {
  for (const path of ["/login", "/forgot", "/reset/abc", "/b2b/tok", "/rfq/tok", "/vitrine/tok", "/schedule/tok", "/schedule/tok/ics", "/api/pos/sales", "/api/devices/readings", "/api/cron/haccp", "/api/health", "/api/webhooks/viva"])
    assert.equal(guarded(path), false, path);
});

test("proxy: οι σελίδες της εφαρμογής ζητούν cookie", () => {
  for (const path of ["/", "/parties", "/vitrine", "/schedule", "/api/files", "/api/org-export", "/b2b-admin"])
    assert.equal(guarded(path), true, path);
});
