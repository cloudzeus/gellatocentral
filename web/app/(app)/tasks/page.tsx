import Link from "next/link";
import { redirect } from "next/navigation";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Card, Page } from "@/components/ui";
import { dateTime } from "@/lib/labels";
import { listParams } from "@/lib/paging";
import { look } from "@/lib/status";
import { retryable } from "@/lib/task-kinds";
import { taskHistory } from "@/lib/tasks";

/** Όλο το ιστορικό του παραθύρου «Εργασίες»: ό,τι επιτρέπει ο ρόλος του χρήστη να δει, με σελίδες στη βάση. */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const list = listParams(await searchParams);
  const history = await taskHistory(retryable, list);
  if (!history) redirect("/login");
  return (
    <Page section="Πορεία εργασιών" title="Εργασίες" description="Ό,τι έτρεξε για ώρα: αποστολές, εισαγωγές και μαζικές ενέργειες, με το πώς κατέληξε">
      <Card>
        <DataTable
          id="tasks"
          listing={{ ...list, total: history.total, placeholder: "Εργασία ή ποιος την ξεκίνησε" }}
          empty="Εδώ φαίνονται οι εργασίες που κρατούν ώρα, όπως οι εισαγωγές αρχείων και οι μαζικές αποστολές. Καμία δεν έχει τρέξει ακόμα."
          columns={[
            { key: "title", label: "Εργασία", required: true, wrap: true },
            { key: "status", label: "Κατάληξη", wrap: true },
            { key: "count", label: "Έγιναν", numeric: true },
            { key: "who", label: "Ξεκίνησε από" },
            { key: "started", label: "Ξεκίνησε" },
          ]}
          rows={history.rows.map(({ view, userName, startedAt }) => ({
            id: view.id,
            cells: {
              title: view.failuresHref ? <Link href={view.failuresHref} className="font-semibold underline-offset-2 hover:underline">{view.title}</Link> : <span className="font-semibold">{view.title}</span>,
              status: (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {view.status === "RUNNING" ? <StatusBadge look={look("warning", view.progress ? `Τρέχει · ${view.progress}` : "Τρέχει")} /> : null}
                  {view.status === "DONE" ? <StatusBadge look={look("success", `Έγινε ${view.finished}`)} /> : null}
                  {view.status === "PARTIAL" ? <StatusBadge look={look("warning", view.summary ?? "Έγινε εν μέρει")} /> : null}
                  {view.status === "FAILED" ? <StatusBadge look={look("danger", "Απέτυχε")} /> : null}
                  {view.error ? <span className="text-xs text-muted-foreground">{view.error}</span> : null}
                  {view.resultHref ? <Link href={view.resultHref} className="text-xs font-semibold underline underline-offset-2">Δες το αποτέλεσμα</Link> : null}
                </span>
              ),
              count: view.counted ? `${view.done} από ${view.total}` : "—",
              who: userName,
              started: dateTime.format(startedAt),
            },
          }))}
        />
      </Card>
    </Page>
  );
}
