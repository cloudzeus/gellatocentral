"use client";

// Progressive enhancement: οι Server Component forms μένουν fallback· IndexedDB μπαίνει μόνο στις store απογραφές.
import { CloudOff, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { btn } from "@/components/ui";
import {
  clearOfflineCounts,
  deleteOfflineCount,
  enqueueOfflineCount,
  listOfflineCounts,
  OFFLINE_QUEUE_EVENT,
  syncOfflineCountEntry,
  syncOfflineCounts,
} from "@/lib/offline-count-db";
import type { OfflineCountEntry } from "@/lib/offline-count-queue";

type Identity = { orgId: string; userId: string };
type Status = { kind: "queued" | "conflict" | "error"; text: string } | null;

function errorText(code: string | null): string {
  const labels: Record<string, string> = {
    NETWORK_ERROR: "Χωρίς σύνδεση· θα δοκιμάσει ξανά όταν συνδεθείς",
    SYNC_INTERRUPTED: "Ο προηγούμενος συγχρονισμός διακόπηκε· μπορείς να δοκιμάσεις ξανά",
    LOCAL_KEY_REUSED: "Το ίδιο τοπικό κλειδί χρησιμοποιήθηκε με διαφορετικά δεδομένα",
    COUNT_ALREADY_FINALIZED: "Η server απογραφή έχει οριστικοποιηθεί",
    COUNT_REVISION_CONFLICT: "Η απογραφή άλλαξε από άλλη συσκευή",
    STOCK_CHANGED_SINCE_SNAPSHOT: "Το απόθεμα άλλαξε μετά το snapshot",
    FINALIZED_COUNT_EXISTS: "Υπάρχει ήδη οριστικοποιημένη απογραφή για την ημέρα",
    IDEMPOTENCY_KEY_REUSED: "Το κλειδί συγχρονισμού αντιστοιχεί σε διαφορετικό payload",
  };
  return code ? labels[code] ?? code : "Η εγγραφή χρειάζεται έλεγχο";
}

export function OfflineCountCreate({ identity, formId }: { identity: Identity; formId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const submit = async (event: SubmitEvent) => {
      const data = new FormData(form);
      const storeId = String(data.get("storeId") ?? "");
      if (!storeId) return; // Το εργαστήριο ακολουθεί την κανονική native server action.
      event.preventDefault();
      setStatus(null);
      try {
        const entry = await enqueueOfflineCount(identity, String(data.get("clientKey") ?? ""), {
          kind: "create",
          storeId,
          warehouseId: String(data.get("warehouseId") ?? ""),
          countedOn: String(data.get("countedOn") ?? ""),
          note: String(data.get("note") ?? "") || null,
        });
        if (entry.status === "conflict") {
          setStatus({ kind: "conflict", text: errorText(entry.error) });
          return;
        }
        if (!navigator.onLine) {
          setStatus({ kind: "queued", text: "Το προσχέδιο αποθηκεύτηκε στη συσκευή και θα συγχρονιστεί όταν συνδεθείς." });
          return;
        }
        const result = await syncOfflineCountEntry(entry);
        if (result.ok && result.id) router.push(`/counts/${result.id}?created=1`);
        else if (!result.ok) setStatus({ kind: result.entry.status === "conflict" ? "conflict" : "queued", text: errorText(result.entry.error) });
      } catch {
        setStatus({ kind: "error", text: "Η τοπική αποθήκευση δεν είναι διαθέσιμη σε αυτό το browser." });
      }
    };
    form.addEventListener("submit", submit);
    return () => form.removeEventListener("submit", submit);
  }, [formId, identity, router]);
  return status ? <p role="status" className={`md:col-span-2 lg:col-span-5 text-sm ${status.kind === "error" || status.kind === "conflict" ? "text-destructive" : "text-muted-foreground"}`}>{status.text}</p> : null;
}

export function OfflineCountMeasurements({ identity, formId, countId, expectedUpdatedAt }: { identity: Identity; formId: string; countId: string; expectedUpdatedAt: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const submit = async (event: SubmitEvent) => {
      event.preventDefault();
      setStatus(null);
      const data = new FormData(form);
      const measurements = data.getAll("lineIds").map((value) => {
        const lineId = String(value);
        const raw = String(data.get(`actual_${lineId}`) ?? "").trim();
        return {
          lineId,
          actualQty: raw === "" ? null : Number(raw),
          reason: String(data.get(`reason_${lineId}`) ?? "") || null,
        };
      });
      try {
        const entry = await enqueueOfflineCount(identity, crypto.randomUUID(), {
          kind: "measurements",
          countId,
          expectedUpdatedAt,
          measurements,
        });
        if (!navigator.onLine) {
          setStatus({ kind: "queued", text: "Οι μετρήσεις μπήκαν στην τοπική ουρά. Έλεγξε την ουρά πριν από οριστικοποίηση." });
          return;
        }
        const result = await syncOfflineCountEntry(entry);
        if (result.ok) router.refresh();
        else setStatus({ kind: result.entry.status === "conflict" ? "conflict" : "queued", text: errorText(result.entry.error) });
      } catch {
        setStatus({ kind: "error", text: "Η τοπική αποθήκευση δεν είναι διαθέσιμη σε αυτό το browser." });
      }
    };
    form.addEventListener("submit", submit);
    return () => form.removeEventListener("submit", submit);
  }, [countId, expectedUpdatedAt, formId, identity, router]);
  return status ? <p role="status" className={`px-5 py-3 text-sm ${status.kind === "error" || status.kind === "conflict" ? "text-destructive" : "text-muted-foreground"}`}>{status.text}</p> : null;
}

export function OfflineCountQueue({ identity }: { identity: Identity }) {
  const [entries, setEntries] = useState<OfflineCountEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setEntries(await listOfflineCounts(identity));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setReady(true);
    }
  }, [identity]);
  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    await syncOfflineCounts(identity);
    await refresh();
  }, [identity, refresh]);

  useEffect(() => {
    // Η αρχική ανάκτηση μπαίνει στο επόμενο task, ώστε το effect να μένει καθαρό subscription.
    const initial = window.setTimeout(() => void (navigator.onLine ? sync() : refresh()), 0);
    const online = () => void sync();
    window.addEventListener("online", online);
    window.addEventListener(OFFLINE_QUEUE_EVENT, refresh);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("online", online);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, refresh);
    };
  }, [refresh, sync]);

  if (!ready || (!entries.length && !error)) return null;
  return (
    <section aria-label="Τοπική ουρά απογραφών" className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><CloudOff className="size-4" /> Ουρά αυτής της συσκευής</h2><p className="mt-1 text-xs text-muted-foreground">Μόνο προσχέδια και μετρήσεις· η οριστικοποίηση δεν μπαίνει ποτέ στην ουρά.</p></div>
        <button type="button" className={btn("outline", "sm")} onClick={() => void sync()}><RefreshCw /> Συγχρονισμός</button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">Η τοπική ουρά δεν είναι διαθέσιμη σε αυτό το browser.</p> : null}
      <ul className="mt-3 space-y-2">
        {entries.map((entry) => (
          <li key={entry.key} className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary/35 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1"><span className="font-medium">{entry.payload.kind === "create" ? "Νέο προσχέδιο καταστήματος" : "Μετρήσεις προσχεδίου"}</span><span className="block text-xs text-muted-foreground">Τοπική έκδοση {entry.localRevision} · {entry.status === "conflict" ? "Χρειάζεται επίλυση" : entry.status === "syncing" ? "Συγχρονίζεται" : "Σε αναμονή"}</span>{entry.error ? <span className={`block text-xs ${entry.status === "conflict" ? "text-destructive" : "text-muted-foreground"}`}>{errorText(entry.error)}</span> : null}</div>
            {entry.status === "queued" ? <button type="button" className={btn("outline", "sm")} onClick={() => void syncOfflineCountEntry(entry).then(refresh)}>Δοκιμή</button> : null}
            <button type="button" aria-label="Διαγραφή τοπικής εγγραφής" title="Διαγραφή τοπικής εγγραφής" className={btn("ghost", "sm")} onClick={() => { if (window.confirm("Να διαγραφεί αυτή η τοπική εγγραφή; Η server απογραφή δεν αλλάζει.")) void deleteOfflineCount(entry.key).then(refresh); }}><Trash2 /></button>
          </li>
        ))}
      </ul>
      {entries.some((entry) => entry.status === "conflict") ? <p className="mt-3 text-xs text-muted-foreground">Για conflict, άνοιγε την server απογραφή, ανανέωσε και μετάφερε χειροκίνητα ό,τι ισχύει. Η τοπική εγγραφή διαγράφεται μόνο με τη δική σου επιλογή.</p> : null}
    </section>
  );
}

export function OnlineOnlyFinalize({ formId, className, children }: { formId: string; className: string; children: React.ReactNode }) {
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <div className="grid justify-items-end gap-2">
      <button
        type="submit"
        form={formId}
        className={className}
        aria-disabled={!online}
        onClick={(event) => {
          if (!online) {
            event.preventDefault();
            setMessage("Η οριστικοποίηση απαιτεί online σύνδεση και ενημερωμένες μετρήσεις.");
            return;
          }
          if (!window.confirm("Οριστικοποίηση της απογραφής με τις τρέχουσες online μετρήσεις;")) event.preventDefault();
        }}
      >{children}</button>
      {message ? <p role="alert" className="max-w-sm text-right text-xs text-destructive">{message}</p> : null}
    </div>
  );
}

/** Σε αλλαγή tenant/user ή στο explicit logout form καθαρίζει μόνο τα τοπικά business drafts του παλιού identity. */
export function OfflineCountSessionGuard({ identity }: { identity: Identity }) {
  const previous = useRef<Identity | null>(null);
  useEffect(() => {
    if (previous.current && (previous.current.orgId !== identity.orgId || previous.current.userId !== identity.userId)) {
      void clearOfflineCounts(previous.current);
    }
    previous.current = identity;
    const logout = (event: Event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.dataset.offlineLogout === "true") void clearOfflineCounts(identity);
    };
    document.addEventListener("submit", logout, true);
    return () => document.removeEventListener("submit", logout, true);
  }, [identity]);
  return null;
}
