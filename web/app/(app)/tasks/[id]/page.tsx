import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Page } from "@/components/ui";
import { dateTime } from "@/lib/labels";
import { look } from "@/lib/status";
import { retryable } from "@/lib/task-kinds";
import { failuresOf, stepsOf, taskView } from "@/lib/task-progress";
import { findTask } from "@/lib/tasks";
import { retryTask } from "../actions";

/** «Δες ποιες απέτυχαν»: τι δεν έγινε σε μια εργασία και γιατί, με «Ξανά» όπου είναι ασφαλές. */
export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const found = await findTask((await params).id);
  if (!found) notFound();
  const view = taskView(found.row, found.user.id, new Date(), retryable(found.row.kind));
  const failures = failuresOf(found.row.failures);
  const steps = stepsOf(found.row.steps);
  return (
    <Page section="Πορεία εργασιών" title={view.title} description={`Ξεκίνησε ${dateTime.format(found.row.startedAt)} από ${found.row.userName}`} actions={<Link href="/tasks" className={btn("outline", "sm")}><ArrowLeft /> Όλες οι εργασίες</Link>}>
      <div className="grid max-w-3xl gap-4">
        <Card className="flex flex-wrap items-center gap-3 p-4">
          {view.status === "RUNNING" ? <StatusBadge look={look("warning", view.progress ? `Τρέχει · ${view.progress}` : "Τρέχει")} /> : null}
          {view.status === "DONE" ? <StatusBadge look={look("success", `Έγινε ${view.finished}`)} /> : null}
          {view.status === "PARTIAL" ? <StatusBadge look={look("warning", view.summary ?? "Έγινε εν μέρει")} /> : null}
          {view.status === "FAILED" ? <StatusBadge look={look("danger", "Απέτυχε")} /> : null}
          {view.error ? <p className="min-w-0 flex-1 text-sm text-muted-foreground">{view.error}</p> : <span className="flex-1" />}
          {view.resultHref ? <Link href={view.resultHref} className={btn("outline", "sm")}>Δες το αποτέλεσμα</Link> : null}
          {view.canRetry && view.mine ? <form action={retryTask.bind(null, view.id)}><Submit className={btn("default", "sm", "pointer-coarse:min-h-11")} pendingText="Ξανά…">Ξανά μόνο όσα απέτυχαν</Submit></form> : null}
        </Card>
        {steps.length ? (
          <Card>
            <h2 className="px-4 pt-4 text-sm font-semibold">Βήματα που έγιναν ({steps.length})</h2>
            <ul className="mt-3">
              {steps.map((s, i) => (
                <li key={`${s.label}-${i}`} className="flex gap-3 border-t border-border/70 px-4 py-3 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  <span className="grid"><span className="font-medium">{s.label}</span><span className="text-xs text-muted-foreground">{s.detail}</span></span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {steps.length && !failures.length ? null : <Card>
          <h2 className="px-4 pt-4 text-sm font-semibold">{failures.length ? `Δεν έγιναν (${failures.length})` : "Όλα έγιναν"}</h2>
          {failures.length ? (
            <ul className="mt-3">
              {failures.map((failure, index) => (
                <li key={`${failure.id ?? failure.label}-${index}`} className="border-t border-border/70 px-4 py-3 text-sm">
                  <p className="font-medium">{failure.label}</p>
                  <p className="text-xs text-muted-foreground">{failure.reason}</p>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 pt-1 pb-4 text-sm text-muted-foreground">Η εργασία δεν κατέγραψε κάτι που να απέτυχε.</p>}
        </Card>}
      </div>
    </Page>
  );
}
