// Καθαρό contract τοπικής ουράς· δεν περιέχει session tokens ή credentials.
export type OfflineCountIdentity = { orgId: string; userId: string; deviceId: string };
export type OfflineCountCreatePayload = {
  kind: "create";
  storeId: string;
  warehouseId: string;
  countedOn: string;
  note: string | null;
};
export type OfflineCountMeasurementsPayload = {
  kind: "measurements";
  countId: string;
  expectedUpdatedAt: string;
  measurements: { lineId: string; actualQty: number | null; reason: string | null; wasteQty?: number }[];
};
export type OfflineCountPayload = OfflineCountCreatePayload | OfflineCountMeasurementsPayload;
export type OfflineCountStatus = "queued" | "syncing" | "conflict";

export type OfflineCountRevisionLine = {
  lineId: string;
  itemName: string;
  batchNumber: string | null;
  unitCode: string;
  expectedQty: number;
  currentQty: number | null;
  currentReason: string | null;
};
export type OfflineCountRevision = {
  countId: string;
  status: "DRAFT" | "FINALIZED";
  updatedAt: string;
  lines: OfflineCountRevisionLine[];
};

export type OfflineCountEntry = {
  key: string;
  orgId: string;
  userId: string;
  deviceId: string;
  clientKey: string;
  localRevision: number;
  canonicalPayload: string;
  payload: OfflineCountPayload;
  status: OfflineCountStatus;
  error: string | null;
  /** Read-only server snapshot· δεν αποτελεί από μόνο του άδεια overwrite. */
  conflict?: OfflineCountRevision | null;
  createdAt: string;
  updatedAt: string;
};

export function canonicalOfflineCountPayload(payload: OfflineCountPayload): string {
  if (payload.kind === "create") {
    return JSON.stringify({
      kind: payload.kind,
      storeId: payload.storeId.trim(),
      warehouseId: payload.warehouseId,
      countedOn: payload.countedOn,
      note: payload.note?.trim() || null,
    });
  }
  return JSON.stringify({
    kind: payload.kind,
    countId: payload.countId,
    expectedUpdatedAt: payload.expectedUpdatedAt,
    measurements: payload.measurements
      .map((line) => ({ lineId: line.lineId, actualQty: line.actualQty, reason: line.reason?.trim() || null, ...(line.wasteQty ? { wasteQty: line.wasteQty } : {}) }))
      .sort((a, b) => a.lineId.localeCompare(b.lineId)),
  });
}

export function offlineCountKey(identity: OfflineCountIdentity, clientKey: string): string {
  return JSON.stringify([identity.orgId, identity.userId, identity.deviceId, clientKey]);
}

export function newOfflineCountEntry(
  identity: OfflineCountIdentity,
  clientKey: string,
  payload: OfflineCountPayload,
  now = new Date(),
): OfflineCountEntry {
  return {
    key: offlineCountKey(identity, clientKey),
    ...identity,
    clientKey,
    localRevision: 1,
    canonicalPayload: canonicalOfflineCountPayload(payload),
    payload,
    status: "queued",
    error: null,
    conflict: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Ίδιο key/payload είναι replay· διαφορετικό payload γίνεται ορατό conflict, ποτέ overwrite. */
export function mergeOfflineCountEntry(existing: OfflineCountEntry | undefined, incoming: OfflineCountEntry): OfflineCountEntry {
  if (!existing) return incoming;
  if (existing.canonicalPayload === incoming.canonicalPayload) return existing;
  return {
    ...existing,
    localRevision: existing.localRevision + 1,
    status: "conflict",
    error: "LOCAL_KEY_REUSED",
    updatedAt: incoming.updatedAt,
  };
}

const CONFLICTS = new Set([
  "COUNT_ALREADY_FINALIZED",
  "COUNT_REVISION_CONFLICT",
  "STOCK_CHANGED_SINCE_SNAPSHOT",
  "FINALIZED_COUNT_EXISTS",
  "IDEMPOTENCY_KEY_REUSED",
  "LOCAL_KEY_REUSED",
]);

export function offlineStatusForError(code: string, httpStatus = 0): OfflineCountStatus {
  return CONFLICTS.has(code) || (httpStatus >= 400 && httpStatus < 500) ? "conflict" : "queued";
}

/** Μετά από reload/crash το «syncing» είναι ορατό, αλλά ξαναγίνεται queued πριν από νέο global sync. */
export function recoverOfflineCountEntry(entry: OfflineCountEntry, now = new Date()): OfflineCountEntry {
  if (entry.status !== "syncing") return entry;
  return { ...entry, status: "queued", error: "SYNC_INTERRUPTED", updatedAt: now.toISOString() };
}

export function canSyncOfflineCount(entry: Pick<OfflineCountEntry, "status">): boolean {
  return entry.status === "queued";
}

export type OfflineCountConflictRow = {
  lineId: string;
  itemName: string;
  batchNumber: string | null;
  unitCode: string;
  expectedQty: number | null;
  currentQty: number | null;
  currentReason: string | null;
  actualQty: number | null;
  localReason: string | null;
  localPresent: boolean;
  serverPresent: boolean;
};

/** Ενώνει server και local γραμμές χωρίς να αλλάξει καμία από τις δύο εκδόσεις. */
export function offlineCountConflictRows(entry: OfflineCountEntry): OfflineCountConflictRow[] {
  if (entry.payload.kind !== "measurements" || !entry.conflict) return [];
  const localById = new Map(entry.payload.measurements.map((line) => [line.lineId, line]));
  const serverById = new Map(entry.conflict.lines.map((line) => [line.lineId, line]));
  const lineIds = [...new Set([...serverById.keys(), ...localById.keys()])].sort();
  return lineIds.map((lineId) => {
    const server = serverById.get(lineId);
    const local = localById.get(lineId);
    return {
      lineId,
      itemName: server?.itemName ?? "Γραμμή εκτός τρέχουσας απογραφής",
      batchNumber: server?.batchNumber ?? null,
      unitCode: server?.unitCode ?? "",
      expectedQty: server?.expectedQty ?? null,
      currentQty: server?.currentQty ?? null,
      currentReason: server?.currentReason ?? null,
      actualQty: local?.actualQty ?? null,
      localReason: local?.reason?.trim() || null,
      localPresent: !!local,
      serverPresent: !!server,
    };
  });
}

/** Rebase επιτρέπεται μόνο σε draft και μόνο αν όλες οι τοπικές γραμμές υπάρχουν ακόμη στον server. */
export function canResolveOfflineCount(entry: OfflineCountEntry): boolean {
  return entry.payload.kind === "measurements"
    && entry.status === "conflict"
    && entry.conflict?.status === "DRAFT"
    && entry.conflict.countId === entry.payload.countId
    && entry.payload.measurements.every((line) => entry.conflict?.lines.some((server) => server.lineId === line.lineId));
}

/** Νέα πρόθεση = νέο key και ρητό revision· οι τοπικές μετρήσεις δεν αλλάζουν σιωπηλά. */
export function confirmOfflineCountResolution(entry: OfflineCountEntry, clientKey: string, now = new Date()): OfflineCountEntry {
  if (!canResolveOfflineCount(entry) || entry.payload.kind !== "measurements" || !entry.conflict) {
    throw new Error("OFFLINE_COUNT_CONFLICT_NOT_RESOLVABLE");
  }
  return newOfflineCountEntry(
    { orgId: entry.orgId, userId: entry.userId, deviceId: entry.deviceId },
    clientKey,
    { ...entry.payload, expectedUpdatedAt: entry.conflict.updatedAt },
    now,
  );
}

export function shouldClearOfflineQueue(
  previous: Pick<OfflineCountIdentity, "orgId" | "userId"> | null,
  next: Pick<OfflineCountIdentity, "orgId" | "userId">,
): boolean {
  return !!previous && (previous.orgId !== next.orgId || previous.userId !== next.userId);
}
