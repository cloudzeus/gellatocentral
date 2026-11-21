"use client";
// Το κομμάτι του <Files> που ζει στον browser: σύρσιμο ή επιλογή αρχείων, πρόοδος ανά αρχείο, διαγραφή με επιβεβαίωση.
import { CircleAlert, CircleCheck, CircleDashed, Download, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Progress } from "./shadcn/progress";
import { btn, cn } from "./ui";

export type FileItem = { id: string; name: string; size: string; when: string; url: string; image: boolean };
type Job = { key: string; name: string; progress: number; status: "queued" | "uploading" | "done" | "error"; error?: string };
type Props = { orgId: string | null; category: string; refType?: string; refId?: string; files: FileItem[]; accept: string; hint: string; multiple: boolean; canEdit: boolean };

export function FileManager({ orgId, category, refType, refId, files, accept, hint, multiple, canEdit }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patch = (key: string, change: Partial<Job>) => setJobs((all) => all.map((j) => (j.key === key ? { ...j, ...change } : j)));
  const running = jobs.some((j) => j.status === "queued" || j.status === "uploading");
  const completed = jobs.filter((j) => j.status === "done").length;

  // XMLHttpRequest και όχι fetch: μόνο αυτό δίνει πρόοδο ανεβάσματος. Το 100% περιμένει και την απάντηση του server.
  const upload = (key: string, file: File) => new Promise<void>((done) => {
    patch(key, { status: "uploading" });
    const form = new FormData();
    form.set("file", file); form.set("category", category);
    if (orgId) form.set("orgId", orgId);
    if (refType) form.set("refType", refType);
    if (refId) form.set("refId", refId);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.upload.onprogress = (e) => e.lengthComputable && patch(key, { progress: Math.round((e.loaded / e.total) * 100) });
    xhr.onload = () => {
      if (xhr.status === 200) patch(key, { progress: 100, status: "done" });
      else patch(key, { status: "error", error: (() => { try { return JSON.parse(xhr.responseText).error; } catch { return null; } })() ?? "Το ανέβασμα απέτυχε" });
      done();
    };
    xhr.onerror = () => { patch(key, { status: "error", error: "Δεν υπάρχει σύνδεση. Δοκίμασε ξανά" }); done(); };
    xhr.send(form);
  });
  const add = async (list: FileList | null) => {
    if (!list?.length || sending.current) return;
    sending.current = true;
    setError(null);
    const selected = [...list].slice(0, multiple ? list.length : 1);
    const batch = selected.map((file, index): Job => ({ key: `${Date.now()}-${index}-${file.size}`, name: file.name, progress: 0, status: "queued" }));
    setJobs((all) => [...all, ...batch]);
    for (let i = 0; i < selected.length; i++) await upload(batch[i].key, selected[i]);
    sending.current = false;
    router.refresh();
  };
  const remove = async (id: string) => {
    setBusy(id); setError(null);
    const res = await fetch(`/api/files/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setError((await res?.text().catch(() => "")) || "Η διαγραφή απέτυχε. Δοκίμασε ξανά");
    setBusy(null); setConfirm(null);
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div
          onDragOver={(e) => { e.preventDefault(); if (!sending.current) setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          aria-disabled={running}
          className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors duration-150", over ? "border-gold bg-gold/10" : "border-border", running && "opacity-70")}
        >
          <Upload className="size-5 shrink-0 text-muted-foreground" />
          <p className="min-w-40 flex-1 text-sm"><span className="font-medium">Σύρε {multiple ? "αρχεία" : "ένα αρχείο"} εδώ</span> <span className="text-muted-foreground">ή διάλεξε από τη συσκευή · {hint}</span></p>
          <input ref={input} type="file" accept={accept} multiple={multiple} disabled={running} className="sr-only" tabIndex={-1} onChange={(e) => { add(e.currentTarget.files); e.currentTarget.value = ""; }} />
          <button type="button" disabled={running} onClick={() => input.current?.click()} className={btn("outline")}>Επιλογή {multiple ? "αρχείων" : "αρχείου"}</button>
        </div>
      ) : null}

      {jobs.length ? (
        <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" aria-label="Εξέλιξη μεταφορτώσεων">
          <div className="flex items-center justify-between gap-3">
            <p role="status" aria-live="polite" className="text-sm font-medium tabular-nums">{completed} από {jobs.length} ολοκληρώθηκαν</p>
            {!running ? <button type="button" onClick={() => setJobs([])} className={btn("ghost", "sm")}>Καθαρισμός λίστας</button> : null}
          </div>
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.key} className={cn("rounded-lg border bg-background px-3 py-2 text-sm", j.status === "error" ? "border-destructive/40 bg-destructive/5" : "border-border")}>
                <div className="flex min-h-6 items-center gap-2">
                  {j.status === "uploading" ? <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" /> : null}
                  {j.status === "queued" ? <CircleDashed className="size-4 shrink-0 text-muted-foreground" /> : null}
                  {j.status === "done" ? <CircleCheck className="size-4 shrink-0 text-success" /> : null}
                  {j.status === "error" ? <CircleAlert className="size-4 shrink-0 text-destructive" /> : null}
                  <span className="min-w-0 flex-1 truncate font-medium">{j.name}</span>
                  <span className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", j.status === "done" && "font-medium text-success-ink", j.status === "error" && "text-destructive")}>
                    {j.status === "queued" ? "Σε αναμονή" : j.status === "uploading" ? `Μεταφόρτωση · ${j.progress}%` : j.status === "done" ? "Ολοκληρώθηκε" : "Σφάλμα"}
                  </span>
                  {j.status === "error" ? <button type="button" onClick={() => setJobs((all) => all.filter((x) => x.key !== j.key))} className={btn("ghost", "sm")}>Κλείσιμο</button> : null}
                </div>
                {j.status === "error" ? <p role="alert" className="mt-1 text-destructive">{j.error}</p> : <Progress className="mt-2 h-1.5 bg-secondary" value={j.progress} aria-label={`Μεταφόρτωση ${j.name}`} />}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p> : null}

      {files.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {files.map((f) => (
            <li key={f.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- έρχεται από το CDN του Bunny, όχι από τον optimizer του Next */}
              {f.image ? <img src={f.url} alt="" loading="lazy" className="size-10 shrink-0 rounded-md border border-border bg-secondary object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary"><FileText className="size-5 text-muted-foreground" /></span>}
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.name}</span><span className="block text-xs text-muted-foreground tabular-nums">{f.size} · {f.when}</span></span>
              {confirm === f.id ? (
                <>
                  <span className="text-sm text-muted-foreground max-sm:sr-only">Σβήνεται οριστικά</span>
                  <button type="button" disabled={busy === f.id} onClick={() => remove(f.id)} className={btn("destructive", "sm")}>{busy === f.id ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null} Διαγραφή</button>
                  <button type="button" onClick={() => setConfirm(null)} className={btn("ghost", "sm")}>Άκυρο</button>
                </>
              ) : (
                <>
                  <a href={f.url} target="_blank" rel="noreferrer" aria-label={`Άνοιγμα: ${f.name}`} title="Άνοιγμα" className={btn("ghost", "sm")}><Download /></a>
                  {canEdit ? <button type="button" onClick={() => setConfirm(f.id)} aria-label={`Διαγραφή: ${f.name}`} title="Διαγραφή" className={btn("ghost", "sm")}><Trash2 /></button> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
