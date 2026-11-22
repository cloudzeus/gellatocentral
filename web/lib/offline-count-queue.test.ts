import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSyncOfflineCount,
  canonicalOfflineCountPayload,
  mergeOfflineCountEntry,
  newOfflineCountEntry,
  offlineCountKey,
  offlineStatusForError,
  recoverOfflineCountEntry,
  shouldClearOfflineQueue,
  type OfflineCountMeasurementsPayload,
} from "./offline-count-queue.ts";

const identity = { orgId: "org-a", userId: "user-a", deviceId: "device-a" };
const payload: OfflineCountMeasurementsPayload = {
  kind: "measurements",
  countId: "count-a",
  expectedUpdatedAt: "2026-11-22T10:00:00.000Z",
  measurements: [
    { lineId: "line-b", actualQty: 2, reason: null },
    { lineId: "line-a", actualQty: 4, reason: "  διαφορά  " },
  ],
};

test("offline queue: tenant/user/device key και canonical σειρά γραμμών", () => {
  assert.notEqual(offlineCountKey(identity, "key"), offlineCountKey({ ...identity, deviceId: "device-b" }, "key"));
  assert.notEqual(offlineCountKey(identity, "key"), offlineCountKey({ ...identity, orgId: "org-b" }, "key"));
  const reversed = { ...payload, measurements: [...payload.measurements].reverse() };
  assert.equal(canonicalOfflineCountPayload(payload), canonicalOfflineCountPayload(reversed));
  assert.match(canonicalOfflineCountPayload(payload), /"reason":"διαφορά"/);
});

test("offline queue: same-key replay, payload mismatch conflict και local revision", () => {
  const now = new Date("2026-11-22T10:00:00.000Z");
  const first = newOfflineCountEntry(identity, "client-a", payload, now);
  const replay = newOfflineCountEntry(identity, "client-a", { ...payload, measurements: [...payload.measurements].reverse() }, now);
  assert.equal(mergeOfflineCountEntry(first, replay), first);
  const changed = newOfflineCountEntry(identity, "client-a", { ...payload, expectedUpdatedAt: "2026-11-22T11:00:00.000Z" }, now);
  const conflict = mergeOfflineCountEntry(first, changed);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.error, "LOCAL_KEY_REUSED");
  assert.equal(conflict.localRevision, 2);
  assert.equal(conflict.canonicalPayload, first.canonicalPayload);
  assert.equal(canSyncOfflineCount(conflict), false);
});

test("offline queue: domain conflicts δεν ξαναδοκιμάζονται τυφλά, network error μένει queued", () => {
  for (const code of ["COUNT_ALREADY_FINALIZED", "COUNT_REVISION_CONFLICT", "STOCK_CHANGED_SINCE_SNAPSHOT", "FINALIZED_COUNT_EXISTS", "IDEMPOTENCY_KEY_REUSED"]) {
    assert.equal(offlineStatusForError(code), "conflict");
  }
  assert.equal(offlineStatusForError("NETWORK_ERROR"), "queued");
  assert.equal(offlineStatusForError("HTTP_ERROR", 503), "queued");
  assert.equal(offlineStatusForError("INVALID_COUNT_REQUEST", 400), "conflict");
});

test("offline queue: logout/session change policy καθαρίζει μόνο αλλαγή tenant ή user", () => {
  assert.equal(shouldClearOfflineQueue(null, identity), false);
  assert.equal(shouldClearOfflineQueue(identity, identity), false);
  assert.equal(shouldClearOfflineQueue(identity, { ...identity, userId: "user-b" }), true);
  assert.equal(shouldClearOfflineQueue(identity, { ...identity, orgId: "org-b" }), true);
});


test("offline queue: interrupted syncing ανακτάται σε queued χωρίς να αλλάξει payload ή key", () => {
  const original = newOfflineCountEntry(identity, "client-a", payload, new Date("2026-11-22T10:00:00.000Z"));
  const syncing = { ...original, status: "syncing" as const };
  const recovered = recoverOfflineCountEntry(syncing, new Date("2026-11-22T11:00:00.000Z"));
  assert.equal(recovered.status, "queued");
  assert.equal(recovered.error, "SYNC_INTERRUPTED");
  assert.equal(recovered.key, original.key);
  assert.equal(recovered.canonicalPayload, original.canonicalPayload);
  assert.equal(canSyncOfflineCount(recovered), true);
  assert.equal(recoverOfflineCountEntry(recovered), recovered);
});
