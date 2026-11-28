"use client";
// Παράθυρο «Εργασίες»: ό,τι κρατά πάνω από δύο δευτερόλεπτα φαίνεται εδώ, και μετά από αλλαγή οθόνης ή ανανέωση,
// γιατί η κατάσταση ζει στον server (/api/tasks). Ρωτά κάθε ~2 δευτ. ΜΟΝΟ όσο κάτι τρέχει. Δεν μπλοκάρει την οθόνη.
import { ChevronDown, ListChecks, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { lastToastAt, TASKS_EVENT, toast } from "@/lib/feedback-events";
import { look } from "@/lib/status";
import type { TaskView } from "@/lib/task-progress";
import type { TaskList } from "@/lib/tasks";
import { retryTask, seenTasks } from "@/app/(app)/tasks/actions";
import { StatusBadge } from "../status-badge";
import { Submit } from "../submit";
import { btn, Card, cn } from "../ui";

const POLL_MS = 2000;
const runningText = (n: number) => (n === 1 ? "1 τρέχει" : `${n} τρέχουν`);

function TaskRow({ task }: { task: TaskView }) {
  const ratio = task.total ? Math.min(1, task.done / task.total) : 0;
  return (
    <li className="space-y-1.5 border-t border-border/70 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-semibold">{task.title}</p>
        {task.progress ? <span className="shrink-0 text-sm font-medium tabular-nums">{task.progress}</span> : null}
      </div>
      {task.status === "RUNNING" ? (
        <>
          {task.counted ? (
            <div role="progressbar" aria-label={task.title} aria-valuemin={0} aria-valuemax={task.total ?? 0} aria-valuenow={task.done} aria-valuetext={task.progress ?? undefined} className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full w-full origin-left rounded-full bg-primary transition-transform motion-reduce:transition-none" style={{ transform: `scaleX(${ratio})` }} />
            </div>
          ) : (
            <div role="progressbar" aria-label={task.title} aria-valuetext={task.elapsed ?? undefined} className="relative h-1.5 overflow-hidden rounded-full bg-secondary"><span className="process-indicator absolute inset-y-0 w-1/3 rounded-full bg-primary" /></div>
          )}
          <p className="text-xs text-muted-foreground">{task.counted ? task.current ?? "Ξεκινά…" : task.elapsed}</p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {task.status === "DONE" ? <StatusBadge look={look("success", `Έγινε ${task.finished}`)} /> : null}
            {task.status === "PARTIAL" ? <StatusBadge look={look("warning", task.summary ?? "Έγινε εν μέρει")} /> : null}
            {task.status === "FAILED" ? <StatusBadge look={look("danger", "Απέτυχε")} /> : null}
            {task.resultHref ? <Link href={task.resultHref} className="text-xs font-semibold underline underline-offset-2">Δες το αποτέλεσμα</Link> : null}
            {task.failuresHref ? <Link href={task.failuresHref} className="text-xs font-semibold underline underline-offset-2">Δες ποιες απέτυχαν</Link> : null}
            {task.stepsHref ? <Link href={task.stepsHref} className="text-xs font-semibold underline underline-offset-2">Δες τα βήματα</Link> : null}
          </div>
          {task.error ? <p className="text-xs text-muted-foreground">{task.error}</p> : null}
          {task.canRetry && task.mine ? <form action={retryTask.bind(null, task.id)}><Submit className={btn("outline", "sm", "pointer-coarse:min-h-11")} pendingText="Ξανά…">Ξανά</Submit></form> : null}
        </>
      )}
    </li>
  );
}

export function TasksPanel() {
  const pathname = usePathname();
  const [list, setList] = useState<TaskList | null>(null);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const known = useRef<Map<string, TaskView["status"]> | null>(null);

  const load = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    const response = await fetch("/api/tasks", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const next: TaskList = await response.json();
    const before = known.current;
    for (const task of next.tasks) {
      const was = before?.get(task.id);
      // ξεκίνησε από εμένα και δεν την ήξερα: το παράθυρο ανοίγει μόνο του (όχι στο πρώτο φόρτωμα της σελίδας)
      if (before && !was && task.mine && task.status === "RUNNING") setOpen(true);
      if (was === "RUNNING" && task.status !== "RUNNING") {
        const outcome = task.status === "DONE" ? "έγινε" : task.status === "PARTIAL" ? task.summary ?? "έγινε εν μέρει" : "απέτυχε";
        setAnnouncement(`${task.title}: ${outcome}`);
        if (task.mine) {
          // η ίδια η ενέργεια συνήθως λέει το αποτέλεσμά της (redirect με ?saved/?error): δεν το λέμε δεύτερη φορά
          setTimeout(() => {
            if (Date.now() - lastToastAt < 2500) return;
            toast(task.status === "FAILED"
              ? { kind: "error", title: `Δεν έγινε: ${task.title}`, detail: task.error ?? undefined }
              : { kind: "success", title: `${task.title}: ${outcome}`, href: task.failuresHref ?? task.resultHref ?? undefined, linkText: task.failuresHref ? "Δες ποιες απέτυχαν" : "Δες το αποτέλεσμα" });
          }, 1200);
        }
      }
    }
    known.current = new Map(next.tasks.map((task) => [task.id, task.status]));
    setList(next);
  }, []);

  // πρώτο φόρτωμα, κάθε αλλαγή οθόνης, και όποτε μια φόρμα ξεκινά ή τελειώνει (lib/use-busy.ts)
  useEffect(() => {
    const first = setTimeout(load, 0);
    window.addEventListener(TASKS_EVENT, load);
    document.addEventListener("visibilitychange", load);
    return () => { clearTimeout(first); window.removeEventListener(TASKS_EVENT, load); document.removeEventListener("visibilitychange", load); };
  }, [load, pathname]);
  const running = list?.running ?? 0;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // άνοιξε το παράθυρο: οι αποτυχίες του θεωρούνται πια «ιδωμένες» (σβήνει η κόκκινη ένδειξη)
    if (next && list?.unseen) seenTasks().then(load);
  };

  // καμία εργασία στο τελευταίο 24ωρο: τίποτα στην οθόνη
  if (!list?.total) return <span aria-live="polite" className="sr-only">{announcement}</span>;
  return (
    <section role="region" aria-label="Εργασίες" className="pointer-events-auto flex max-w-full flex-col items-end max-sm:w-full">
      <span aria-live="polite" className="sr-only">{announcement}</span>
      {open ? (
        <Card id="tasks-panel" className="w-[22.5rem] max-w-[calc(100vw-1.5rem)] shadow-[var(--shadow-pop)] max-sm:w-full">
          <div className="flex items-center gap-2 py-1 pr-1 pl-4">
            <h2 className="min-w-0 flex-1 text-sm font-semibold">Εργασίες{running ? ` · ${runningText(running)}` : ""}</h2>
            <button type="button" onClick={toggle} aria-expanded aria-controls="tasks-panel" aria-label="Σύμπτυξη εργασιών" className={btn("ghost", "sm", "size-11 shrink-0 px-0")}><ChevronDown /></button>
          </div>
          <ul>{list.tasks.map((task) => <TaskRow key={task.id} task={task} />)}</ul>
          {list.total > list.tasks.length ? <p className="border-t border-border/70 px-4 py-2.5"><Link href="/tasks" className="text-sm font-semibold underline underline-offset-2">Όλο το ιστορικό</Link></p> : null}
        </Card>
      ) : (
        <button type="button" onClick={toggle} aria-expanded={false} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-card-foreground shadow-[var(--shadow-pop)] outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
          {running ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ListChecks className="size-4" aria-hidden />}
          Εργασίες{running ? ` · ${runningText(running)}` : ""}
          {!running && list.unseen ? <><span aria-hidden className="size-2 rounded-full bg-destructive" /><span className="sr-only">· υπάρχει αποτυχία που δεν έχεις δει</span></> : null}
        </button>
      )}
    </section>
  );
}
