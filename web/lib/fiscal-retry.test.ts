// Ποια σφάλματα ξαναδοκιμάζονται αυτόματα (lib/fiscal-retry.ts)· το module δεν φορτώνει τη βάση στο import της συνάρτησης.
import assert from "node:assert/strict";
import { test } from "node:test";
import { needsCorrection, readableError } from "./fiscal-retry-rules.ts";

test("απόρριψη ΑΑΔΕ/4xx θέλει διόρθωση· δίκτυο, 5xx χωρίς ValidationError και 429 ξαναδοκιμάζονται", () => {
  assert.equal(needsCorrection('Viva Fiscal: HTTP 502 {"AADEError":"ValidationError"}'), true);
  assert.equal(needsCorrection("Viva Fiscal: HTTP 409 PaymentMethodsRequestFailed"), true);
  assert.equal(needsCorrection("Viva Fiscal: HTTP 429 Too Many Requests"), false);
  assert.equal(needsCorrection("Viva Fiscal: HTTP 503"), false);
  assert.equal(needsCorrection("fetch failed"), false);
  assert.equal(needsCorrection(null), false);
});

test("το μήνυμα της ΑΑΔΕ βγαίνει από το JSON της Viva", () => {
  const raw = String.raw`Viva Fiscal: HTTP 502 {"status":502,"message":"FiskaltrustSignReceiptErrorState: {\"AADEError\":\"ValidationError\",\"Errors\":[{\"message\":\"LoadingAddress-> street are mandatory\",\"code\":\"274\"}]}"}`;
  assert.equal(readableError(raw), "Απόρριψη ΑΑΔΕ: LoadingAddress-> street are mandatory");
  assert.equal(readableError("fetch failed"), "fetch failed");
});

test("σφάλμα αιτήματος Viva: μόνο το πεδίο και ο λόγος", () => {
  const e = 'Viva refund: HTTP 400 {"detail":[{"type":"missing","loc":["body","parentSessionId"],"msg":"Field required","input":{"sessionId":"x"}}]}';
  assert.equal(readableError(e), "Η Viva απέρριψε το αίτημα (parentSessionId: Field required)");
  assert.ok(readableError("x".repeat(500))!.length <= 301);
});
