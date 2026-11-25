import assert from "node:assert/strict";
import { test } from "node:test";

import { rethrowControlFlow, WorkflowError, workflowMessage } from "./workflow-db.ts";

// Το redirect() του Next πετά σφάλμα με digest «NEXT_REDIRECT;…»: έτσι αλλάζει σελίδα μια επιτυχημένη ενέργεια.
const redirectError = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/staff?saved=1;307;" });

test("workflowMessage: το redirect της επιτυχίας ξαναπετιέται, δεν γίνεται ?error=NEXT_REDIRECT", () => {
  assert.throws(() => workflowMessage(redirectError), (thrown) => thrown === redirectError);
  assert.throws(() => rethrowControlFlow(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" })));
});

test("workflowMessage: τα πραγματικά σφάλματα γίνονται μήνυμα όπως πριν", () => {
  assert.equal(workflowMessage(new WorkflowError("Ο προμηθευτής δεν βρέθηκε")), "Ο προμηθευτής δεν βρέθηκε");
  assert.equal(workflowMessage("κάτι"), "Η ενέργεια απέτυχε");
  assert.equal(workflowMessage(Object.assign(new Error("Λάθος βάσης"), { digest: "1234567" })), "Λάθος βάσης");
  assert.doesNotThrow(() => rethrowControlFlow(null));
});

test("workflowMessage: σφάλμα Prisma δεν φτάνει στον χρήστη", () => {
  const prisma = Object.assign(new Error("Invalid `prisma.sale.create()` invocation: Unique constraint failed on the fields: (`deviceId`)"), { name: "PrismaClientKnownRequestError", code: "P2002" });
  assert.doesNotMatch(workflowMessage(prisma), /prisma|constraint/i);
});
