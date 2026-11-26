import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePairQr } from "./pair-qr.ts";

test("QR σύνδεσης: διεύθυνση και κωδικός, ό,τι άλλο απορρίπτεται", () => {
  assert.deepEqual(parsePairQr("https://shop.example.gr/api/pos/pair?code=4d6shkvb"), { baseUrl: "https://shop.example.gr", code: "4D6SHKVB" });
  assert.equal(parsePairQr("https://shop.example.gr/vitrine/abc"), null);
  assert.equal(parsePairQr("https://shop.example.gr/api/pos/pair?code=123"), null);
  assert.equal(parsePairQr("not a url"), null);
});
