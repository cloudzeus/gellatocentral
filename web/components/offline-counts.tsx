"use client";

// Progressive enhancement: οι Server Component forms μένουν fallback· IndexedDB μπαίνει μόνο στις store απογραφές.
import { AlertTriangle, CloudOff, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { btn } from "@/components/ui";
import {
  clearOfflineCounts,
  deleteOfflineCount,
  enqueueOfflineCount,
  listOfflineCounts,
  OFFLINE_QUEUE_EVENT,
  refreshOfflineCountConflict,
  resolveOfflineCountConflict,
  syncOfflineCountEntry,
  syncOfflineCounts,
} from "@/lib/offline-count-db";
import {
  canResolveOfflineCount,
  offlineCountConflictRows,
  type OfflineCountEntry,
} from "@/lib/offline-count-queue";

type Identity = { orgId: string; userId: string };
type Status = { kind: "queued" | "conflict" | "error"; text: string } | null;
const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });

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
    INVALID_COUNT_REQUEST: "Το τοπικό αίτημα δεν είναι πλέον έγκυρο· έλεγξε τα πεδία",
    INVALID_COUNT_LINE: "Η τοπική μέτρηση ή αιτιολογία δεν είναι έγκυρη",
    UNAUTHORIZED: "Η συνεδρία έληξε· συνδέσου ξανά πριν από τον συγχρονισμό",
    FORBIDDEN: "Δεν έχεις πλέον δικαίωμα επεξεργασίας αυτής της απογραφής",
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
    let active = true;
    let dirty = false;
    const form = document.getElementById(formId);
    const edited = () => { dirty = true; };
    form?.addEventListener("input", edited);
    // Μόνο queued draft επανέρχεται στη φόρμα· conflicted τιμές εμφανίζονται δίπλα-δίπλα στον πίνακα επίλυσης.
    void listOfflineCounts(identity).then((entries) => {
      if (!active || dirty) return; // Αργό IndexedDB read δεν σβήνει νέα πληκτρολόγηση του χρήστη.
      const drafts = entries.filter((entry) => entry.payload.kind === "measurements"
        && entry.payload.countId === countId
        && (entry.status === "queued" || entry.status === "syncing"))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const draft = drafts[0];
      if (!draft || draft.payload.kind !== "measurements") return;
      for (const line of draft.payload.measurements) {
        const actual = document.querySelector<HTMLInputElement>(`input[name="actual_${line.lineId}"]`);
        const reason = document.querySelector<HTMLTextAreaElement>(`textarea[name="reason_${line.lineId}"]`);
        if (actual) actual.value = line.actualQty === null ? "" : String(line.actualQty);
        if (reason) reason.value = line.reason ?? "";
      }
      setStatus({ kind: "queued", text: "Επαναφέρθηκαν οι μη συγχρονισμένες τοπικές μετρήσεις. Έλεγξέ τις πριν από νέα αποθήκευση." });
    }).catch(() => undefined);
    return () => {
      active = false;
      form?.removeEventListener("input", edited);
    };
  }, [countId, formId, identity]);

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

function quantity(value: number | null, unitCode: string): string {
  if (value === null) return "—";
  return `${value}${unitCode ? ` ${unitCode}` : ""}`;
}

function ConflictDetails({ entry, busy, onRefresh, onResolve, onAccept }: {
  entry: OfflineCountEntry;
  busy: boolean;
  onRefresh: (entry: OfflineCountEntry) => void;
  onResolve: (entry: OfflineCountEntry) => void;
  onAccept: (entry: OfflineCountEntry) => void;
}) {
  if (entry.payload.kind !== "measurements") return null;
  const rows = offlineCountConflictRows(entry);
  const revision = entry.conflict;
  return (
    <div className="mt-3 w-full rounded-lg border border-destructive/30 bg-background p-3">
      <div className="flex items-start gap-2 text-sm font-semibold text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Απαιτείται νέα επιβεβαίωση· δεν έγινε overwrite στον server.</span></div>
      {revision ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">Έκδοση τοπικής υποβολής: {dateTime.format(new Date(entry.payload.expectedUpdatedAt))} · Τρέχουσα server έκδοση: {dateTime.format(new Date(revision.updatedAt))}{revision.status === "FINALIZED" ? " · Οριστικοποιημένη" : ""}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[54rem] border-collapse text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="px-2 py-2">Είδος / παρτίδα</th><th className="px-2 py-2 text-right">Αναμενόμενο snapshot</th><th className="px-2 py-2 text-right">Τρέχον στον server</th><th className="px-2 py-2 text-right">Τοπικό πραγματικό</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.lineId} className="border-t border-border/70 align-top">
                    <td className="px-2 py-2 font-medium">{row.itemName}<span className="block font-normal text-muted-foreground">{row.batchNumber ?? "Χωρίς παρτίδα"}{!row.serverPresent ? " · δεν υπάρχει πλέον στον server" : !row.localPresent ? " · δεν υπήρχε στην τοπική υποβολή" : ""}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{quantity(row.expectedQty, row.unitCode)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{quantity(row.currentQty, row.unitCode)}{row.currentReason ? <span className="block max-w-48 whitespace-normal text-left text-muted-foreground">Αιτιολογία server: {row.currentReason}</span> : null}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{row.localPresent ? quantity(row.actualQty, row.unitCode) : "—"}{row.localReason ? <span className="block max-w-48 whitespace-normal text-left font-normal text-muted-foreground">Τοπική αιτιολογία: {row.localReason}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="mt-2 text-xs text-muted-foreground">Φόρτωσε την τρέχουσα server έκδοση για να δεις αναμενόμενο, τρέχον και τοπικό πραγματικό πριν αποφασίσεις.</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Link href={`/counts/${entry.payload.countId}`} className={btn("ghost", "sm")}>Άνοιγμα server απογραφής</Link>
        <button type="button" disabled={busy} className={btn("outline", "sm")} onClick={() => onRefresh(entry)}><RefreshCw /> {revision ? "Ανανέωση server τιμών" : "Προβολή τιμών"}</button>
        <button type="button" disabled={busy} className={btn("outline", "sm")} onClick={() => onAccept(entry)}>Αποδοχή server & διαγραφή τοπικού</button>
        {canResolveOfflineCount(entry) ? <button type="button" disabled={busy} className={btn("default", "sm")} onClick={() => onResolve(entry)}>Νέα επιβεβαίωση τοπικών τιμών</button> : null}
      </div>
    </div>
  );
}

export function OfflineCountQueue({ identity }: { identity: Identity }) {
  const router = useRouter();
  const [entries, setEntries] = useState<OfflineCountEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
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

  const showConflict = async (entry: OfflineCountEntry) => {
    if (!navigator.onLine) { setActionError("Η ανάγνωση των server τιμών απαιτεί σύνδεση."); return; }
    setBusy(entry.key); setActionError("");
    try { await refreshOfflineCountConflict(entry); await refresh(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Οι server τιμές δεν φορτώθηκαν."); }
    finally { setBusy(null); }
  };
  const resolve = async (entry: OfflineCountEntry) => {
    if (!window.confirm("Έλεγξες τις στήλες Αναμενόμενο / Τρέχον server / Τοπικό πραγματικό; Να επαναποσταλούν οι τοπικές τιμές με νέα επιβεβαίωση;")) return;
    setBusy(entry.key); setActionError("");
    try {
      const queued = await resolveOfflineCountConflict(entry);
      if (navigator.onLine && queued.status === "queued") {
        const result = await syncOfflineCountEntry(queued);
        if (result.ok) router.refresh();
      }
      await refresh();
    } catch { setActionError("Η νέα επιβεβαίωση δεν αποθηκεύτηκε. Το αρχικό conflict παραμένει στην ουρά."); }
    finally { setBusy(null); }
  };
  const accept = async (entry: OfflineCountEntry) => {
    if (!window.confirm("Να διαγραφούν οριστικά οι τοπικές τιμές αυτής της εγγραφής; Οι server τιμές δεν αλλάζουν.")) return;
    setBusy(entry.key); setActionError("");
    try { await deleteOfflineCount(entry.key); await refresh(); router.refresh(); }
    catch { setActionError("Η τοπική εγγραφή δεν διαγράφηκε."); }
    finally { setBusy(null); }
  };

  if (!ready || (!entries.length && !error)) return null;
  return (
    <section aria-label="Τοπική ουρά απογραφών" className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><CloudOff className="size-4" /> Ουρά αυτής της συσκευής</h2><p className="mt-1 text-xs text-muted-foreground">Μόνο προσχέδια και μετρήσεις· η οριστικοποίηση δεν μπαίνει ποτέ στην ουρά.</p></div>
        <button type="button" className={btn("outline", "sm")} onClick={() => void sync()}><RefreshCw /> Συγχρονισμός</button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">Η τοπική ουρά δεν είναι διαθέσιμη σε αυτό το browser.</p> : null}
      {actionError ? <p role="alert" className="mt-3 text-sm text-destructive">{actionError}</p> : null}
      <ul className="mt-3 space-y-2">
        {entries.map((entry) => (
          <li key={entry.key} className="rounded-lg bg-secondary/35 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1"><span className="font-medium">{entry.payload.kind === "create" ? "Νέο προσχέδιο καταστήματος" : "Μετρήσεις προσχεδίου"}</span><span className="block text-xs text-muted-foreground">Τοπική έκδοση {entry.localRevision} · {entry.status === "conflict" ? "Χρειάζεται επίλυση" : entry.status === "syncing" ? "Συγχρονίζεται" : "Σε αναμονή"}</span>{entry.error ? <span className={`block text-xs ${entry.status === "conflict" ? "text-destructive" : "text-muted-foreground"}`}>{errorText(entry.error)}</span> : null}</div>
              {entry.status === "queued" ? <button type="button" className={btn("outline", "sm")} onClick={() => void syncOfflineCountEntry(entry).then(refresh)}>Δοκιμή</button> : null}
              {entry.status !== "conflict" ? <button type="button" aria-label="Διαγραφή τοπικής εγγραφής" title="Διαγραφή τοπικής εγγραφής" className={btn("ghost", "sm")} onClick={() => { if (window.confirm("Να διαγραφεί αυτή η τοπική εγγραφή; Η server απογραφή δεν αλλάζει.")) void deleteOfflineCount(entry.key).then(refresh); }}><Trash2 /></button> : null}
            </div>
            {entry.status === "conflict" ? <ConflictDetails entry={entry} busy={busy === entry.key} onRefresh={(value) => void showConflict(value)} onResolve={(value) => void resolve(value)} onAccept={(value) => void accept(value)} /> : null}
          </li>
        ))}
      </ul>
      {entries.some((entry) => entry.status === "conflict") ? <p className="mt-3 text-xs text-muted-foreground">Κάθε επαναποστολή μετά από conflict χρησιμοποιεί νέο κλειδί και την εμφανιζόμενη server revision. Αν μεσολαβήσει άλλη αλλαγή, θα ζητηθεί ξανά επιβεβαίωση.</p> : null}
    </section>
  );
}

export function OnlineOnlyFinalize({ formId, className, children, identity, countId }: { formId: string; className: string; children: React.ReactNode; identity?: Identity; countId?: string }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(false);
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
  useEffect(() => {
    if (!identity || !countId) return;
    const check = async () => {
      try {
        const entries = await listOfflineCounts(identity);
        setPending(entries.some((entry) => entry.payload.kind === "measurements" && entry.payload.countId === countId));
      } catch { setPending(false); }
    };
    const listener = () => void check();
    void check();
    window.addEventListener(OFFLINE_QUEUE_EVENT, listener);
    return () => window.removeEventListener(OFFLINE_QUEUE_EVENT, listener);
  }, [countId, identity]);
  return (
    <div className="grid justify-items-end gap-2">
      <button
        type="submit"
        form={formId}
        className={className}
        aria-disabled={!online || pending}
        onClick={(event) => {
          if (!online || pending) {
            event.preventDefault();
            setMessage(pending ? "Συγχρόνισε ή επίλυσε πρώτα όλες τις τοπικές μετρήσεις αυτής της απογραφής." : "Η οριστικοποίηση απαιτεί online σύνδεση και ενημερωμένες μετρήσεις.");
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
