import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanRemoteId, remoteLink, showRemoteId } from "./remote.ts";

test("αριθμός RustDesk: δέχεται ψηφία με κενά, απορρίπτει ό,τι θα έσπαγε τον σύνδεσμο", () => {
  assert.equal(cleanRemoteId("123 456 789"), "123456789");
  assert.equal(cleanRemoteId("tameio-1"), "tameio-1");
  assert.equal(cleanRemoteId("12345"), null);
  assert.equal(cleanRemoteId('123456789"><script>'), null);
  assert.equal(cleanRemoteId("123456789?password=x"), null);
  assert.equal(showRemoteId("1234567890"), "123 456 789 0");
});

test("σύνδεσμος: ακολουθεί τη μορφή των ρυθμίσεων, αλλιώς την προεπιλογή", () => {
  assert.equal(remoteLink("rustdesk://{id}", "123456789"), "rustdesk://123456789");
  assert.equal(remoteLink("rustdesk://connection/new/{id}", "123456789"), "rustdesk://connection/new/123456789");
  assert.equal(remoteLink("", "123456789"), "rustdesk://123456789");
  assert.equal(remoteLink("javascript:alert(1)", "123456789"), "rustdesk://123456789");
  assert.equal(remoteLink("javascript://x%0aalert({id})", "123456789"), "rustdesk://123456789");
});
