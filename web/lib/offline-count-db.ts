// IndexedDB προσαρμογέας: tenant/user/device partition, retry μόνο για queued και καθαρισμός σε logout.
import {
  canSyncOfflineCount,
  mergeOfflineCountEntry,
  newOfflineCountEntry,
  offlineStatusForError,
  recoverOfflineCountEntry,
  type OfflineCountEntry,
  type OfflineCountIdentity,
  type OfflineCountPayload,
} from "./offline-count-queue.ts";

const DB_NAME = "gelato-stock-counts";
const ENTRIES = "entries";
const DEVICES = "devices";
export const OFFLINE_QUEUE_EVENT = "gelato:stock-count-queue";

type SessionIdentity = Pick<OfflineCountIdentity, "orgId" | "userId">;
export type OfflineSyncResult = { ok: true; id?: string } | { ok: false; entry: OfflineCountEntry };

function request<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains(ENTRIES)) {
        const store = database.createObjectStore(ENTRIES, { keyPath: "key" });
        store.createIndex("identity", ["orgId", "userId", "deviceId"], { unique: false });
      }
      if (!database.objectStoreNames.contains(DEVICES)) database.createObjectStore(DEVICES, { keyPath: "id" });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("IndexedDB open failed"));
  });
}

export function notifyOfflineQueue() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
}

export async function offlineDeviceId(): Promise<string> {
  const database = await openDatabase();
  try {
    const tx = database.transaction(DEVICES, "readwrite");
    const store = tx.objectStore(DEVICES);
    const existing = await request(store.get("current") as IDBRequest<{ id: string; value: string } | undefined>);
    if (existing) {
      await completed(tx);
      return existing.value;
    }
    const value = crypto.randomUUID();
    store.put({ id: "current", value });
    await completed(tx);
    return value;
  } finally {
    database.close();
  }
}

export async function enqueueOfflineCount(identity: SessionIdentity, clientKey: string, payload: OfflineCountPayload): Promise<OfflineCountEntry> {
  const deviceId = await offlineDeviceId();
  const fullIdentity = { ...identity, deviceId };
  const incoming = newOfflineCountEntry(fullIdentity, clientKey, payload);
  const database = await openDatabase();
  try {
    const tx = database.transaction(ENTRIES, "readwrite");
    const store = tx.objectStore(ENTRIES);
    const existing = await request(store.get(incoming.key) as IDBRequest<OfflineCountEntry | undefined>);
    const merged = mergeOfflineCountEntry(existing, incoming);
    if (merged !== existing) store.put(merged);
    await completed(tx);
    notifyOfflineQueue();
    return merged;
  } finally {
    database.close();
  }
}

export async function listOfflineCounts(identity: SessionIdentity): Promise<OfflineCountEntry[]> {
  const deviceId = await offlineDeviceId();
  const database = await openDatabase();
  try {
    const tx = database.transaction(ENTRIES, "readonly");
    const rows = await request(tx.objectStore(ENTRIES).index("identity").getAll(IDBKeyRange.only([identity.orgId, identity.userId, deviceId])) as IDBRequest<OfflineCountEntry[]>);
    await completed(tx);
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } finally {
    database.close();
  }
}

/** Το status «syncing» δεν επιβιώνει ως μπλοκάρισμα μετά από reload ή crash του browser. */
async function recoverInterruptedOfflineCounts(identity: SessionIdentity): Promise<void> {
  const deviceId = await offlineDeviceId();
  const database = await openDatabase();
  try {
    const tx = database.transaction(ENTRIES, "readwrite");
    const store = tx.objectStore(ENTRIES);
    const rows = await request(store.index("identity").getAll(IDBKeyRange.only([identity.orgId, identity.userId, deviceId])) as IDBRequest<OfflineCountEntry[]>);
    let recovered = false;
    for (const row of rows) {
      const next = recoverOfflineCountEntry(row);
      if (next !== row) {
        store.put(next);
        recovered = true;
      }
    }
    await completed(tx);
    if (recovered) notifyOfflineQueue();
  } finally {
    database.close();
  }
}

async function putOfflineCount(entry: OfflineCountEntry): Promise<OfflineCountEntry> {
  const database = await openDatabase();
  try {
    const tx = database.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).put(entry);
    await completed(tx);
    notifyOfflineQueue();
    return entry;
  } finally {
    database.close();
  }
}

export async function deleteOfflineCount(key: string): Promise<void> {
  const database = await openDatabase();
  try {
    const tx = database.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).delete(key);
    await completed(tx);
    notifyOfflineQueue();
  } finally {
    database.close();
  }
}

/** Σε logout καθαρίζει όλες τις device partitions του συγκεκριμένου tenant/user σε αυτό το browser profile. */
export async function clearOfflineCounts(identity: SessionIdentity): Promise<void> {
  const database = await openDatabase();
  try {
    const tx = database.transaction(ENTRIES, "readwrite");
    const store = tx.objectStore(ENTRIES);
    const rows = await request(store.getAll() as IDBRequest<OfflineCountEntry[]>);
    for (const row of rows) if (row.orgId === identity.orgId && row.userId === identity.userId) store.delete(row.key);
    await completed(tx);
    notifyOfflineQueue();
  } finally {
    database.close();
  }
}

export async function syncOfflineCountEntry(entry: OfflineCountEntry): Promise<OfflineSyncResult> {
  if (!canSyncOfflineCount(entry)) return { ok: false, entry };
  const syncing = await putOfflineCount({ ...entry, status: "syncing", error: null, updatedAt: new Date().toISOString() });
  const url = entry.payload.kind === "create" ? "/api/counts" : `/api/counts/${entry.payload.countId}/measurements`;
  const body = entry.payload.kind === "create" ? {
    clientKey: entry.clientKey,
    storeId: entry.payload.storeId,
    warehouseId: entry.payload.warehouseId,
    countedOn: entry.payload.countedOn,
    note: entry.payload.note,
  } : {
    clientKey: entry.clientKey,
    expectedUpdatedAt: entry.payload.expectedUpdatedAt,
    measurements: entry.payload.measurements,
  };
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({})) as { id?: string; code?: string; message?: string };
    if (!response.ok) {
      const failed = await putOfflineCount({
        ...syncing,
        status: offlineStatusForError(result.code ?? "HTTP_ERROR", response.status),
        error: result.message ?? result.code ?? `HTTP ${response.status}`,
        updatedAt: new Date().toISOString(),
      });
      return { ok: false, entry: failed };
    }
    await deleteOfflineCount(entry.key);
    return { ok: true, id: result.id };
  } catch {
    const failed = await putOfflineCount({ ...syncing, status: "queued", error: "NETWORK_ERROR", updatedAt: new Date().toISOString() });
    return { ok: false, entry: failed };
  }
}

export async function syncOfflineCounts(identity: SessionIdentity): Promise<void> {
  await recoverInterruptedOfflineCounts(identity);
  const entries = await listOfflineCounts(identity);
  for (const entry of entries) if (canSyncOfflineCount(entry)) await syncOfflineCountEntry(entry);
}
