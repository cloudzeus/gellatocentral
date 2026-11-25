import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canResolveOfflineCount,
  canSyncOfflineCount,
  canonicalOfflineCountPayload,
  confirmOfflineCountResolution,
  mergeOfflineCountEntry,
  newOfflineCountEntry,
  offlineCountConflictRows,
  offlineCountKey,
  offlineStatusForError,
  recoverOfflineCountEntry,
  shouldClearOfflineQueue,
  type OfflineCountEntry,
  type OfflineCountMeasurementsPayload,
  type OfflineCountRevision,
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

const revision: OfflineCountRevision = {
  countId: "count-a",
  status: "DRAFT",
  updatedAt: "2026-11-22T11:00:00.000Z",
  lines: [
    { lineId: "line-a", itemName: "Γάλα", batchNumber: "A-1", unitCode: "ml", expectedQty: 10, currentQty: 3, currentReason: "server διόρθωση" },
    { lineId: "line-b", itemName: "Ζάχαρη", batchNumber: null, unitCode: "mg", expectedQty: 20, currentQty: null, currentReason: null },
    { lineId: "line-c", itemName: "Κακάο", batchNumber: "C-1", unitCode: "mg", expectedQty: 5, currentQty: 5, currentReason: null },
  ],
};

function conflictEntry(extra: Partial<OfflineCountEntry> = {}): OfflineCountEntry {
  return {
    ...newOfflineCountEntry(identity, "client-a", payload, new Date("2026-11-22T10:30:00.000Z")),
    status: "conflict",
    error: "COUNT_REVISION_CONFLICT",
    conflict: revision,
    ...extra,
  };
}

test("STK-08: conflict rows δείχνουν expected/current/actual και τις δύο αιτιολογίες", () => {
  const rows = offlineCountConflictRows(conflictEntry());
  assert.deepEqual(rows.map((row) => row.lineId), ["line-a", "line-b", "line-c"]);
  assert.deepEqual(rows[0], {
    lineId: "line-a",
    itemName: "Γάλα",
    batchNumber: "A-1",
    unitCode: "ml",
    expectedQty: 10,
    currentQty: 3,
    currentReason: "server διόρθωση",
    actualQty: 4,
    localReason: "διαφορά",
    localPresent: true,
    serverPresent: true,
  });
  assert.equal(rows[1]?.currentQty, null);
  assert.equal(rows[1]?.actualQty, 2);
  assert.equal(rows[2]?.localPresent, false);
  assert.equal(rows[2]?.serverPresent, true);
  assert.equal(offlineCountConflictRows(newOfflineCountEntry(identity, "client-a", payload)).length, 0);
});

test("STK-08: νέα επιβεβαίωση κρατά τοπικό actual, αλλάζει revision/key και δεν αγγίζει το conflict", () => {
  const original = conflictEntry();
  const resolved = confirmOfflineCountResolution(original, "client-b", new Date("2026-11-22T12:00:00.000Z"));
  assert.equal(resolved.status, "queued");
  assert.equal(resolved.clientKey, "client-b");
  assert.notEqual(resolved.key, original.key);
  assert.equal(resolved.conflict, null);
  assert.equal(resolved.payload.kind, "measurements");
  assert.equal(resolved.payload.kind === "measurements" ? resolved.payload.expectedUpdatedAt : null, revision.updatedAt);
  assert.deepEqual(resolved.payload.kind === "measurements" ? resolved.payload.measurements : null, payload.measurements);
  assert.equal(original.status, "conflict");
  assert.equal(original.conflict, revision);
  assert.equal(canSyncOfflineCount(resolved), true);
});

test("STK-08: finalized ή ελλιπές server snapshot δεν επιτρέπει σιωπηλό rebase", () => {
  const finalized = conflictEntry({ conflict: { ...revision, status: "FINALIZED" } });
  assert.equal(canResolveOfflineCount(finalized), false);
  assert.throws(() => confirmOfflineCountResolution(finalized, "client-b"), /OFFLINE_COUNT_CONFLICT_NOT_RESOLVABLE/);
  const missingLine = conflictEntry({ conflict: { ...revision, lines: revision.lines.filter((line) => line.lineId !== "line-b") } });
  assert.equal(canResolveOfflineCount(missingLine), false);
  assert.throws(() => confirmOfflineCountResolution(missingLine, "client-b"), /OFFLINE_COUNT_CONFLICT_NOT_RESOLVABLE/);
  assert.equal(canResolveOfflineCount(conflictEntry({ conflict: null })), false);
});
