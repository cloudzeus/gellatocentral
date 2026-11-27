import Link from "next/link";
import { CheckCircle2, Clock, Download, RefreshCw, Wrench } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { btn, Card, Kpi, Page } from "@/components/ui";
import { attemptPage, DOC_TYPES, fiscalOverview, STATUSES } from "@/lib/fiscal-log";
import { filterParam, listParams } from "@/lib/paging";
import { requireStockContext } from "@/lib/stock-context";

const time = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", dateStyle: "short", timeStyle: "medium" });
const clock = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit" });
const STATUS_LABEL = { SIGNED: "Στάλθηκε", PENDING: "Σε εξέλιξη", FAILED: "Απέτυχε", NOT_SENT: "Δοκιμαστική" } as const;

export default async function TransmissionsPage({ searchParams }: PageProps<"/transmissions">) {
  const ctx = await requireStockContext("invoices.read");
  const query = await searchParams;
  const list = listParams(query, 50);
  const docType = filterParam(query, "type", Object.keys(DOC_TYPES));
  const status = filterParam(query, "status", STATUSES);
  const filter = { orgId: ctx.orgId, docType, status, q: list.q };
  const [overview, page] = await Promise.all([fiscalOverview(ctx.orgId), attemptPage(filter, list.skip, list.take)]);
  const exportHref = `/api/transmissions/export?${new URLSearchParams({ ...(docType ? { type: docType } : {}), ...(status ? { status } : {}), ...(list.q ? { q: list.q } : {}) })}`;
  return (
    <Page
      section="Πελάτες & πωλήσεις"
      title="Διαβιβάσεις myDATA"
      description="Κάθε αποστολή παραστατικού στην ΑΑΔΕ, με την ώρα, το αποτέλεσμα και το MARK. Οι γραμμές δεν αλλάζουν, για έλεγχο."
      actions={<a href={exportHref} className={btn("outline", "sm")}><Download /> CSV για έλεγχο</a>}
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Kpi icon={CheckCircle2} tone="success" label="Στάλθηκαν (24 ώρες)" value={overview.signed} hint="Έχουν MARK από την ΑΑΔΕ" />
          <Kpi icon={Clock} tone={overview.waiting ? "warning" : "neutral"} label="Περιμένουν MARK" value={overview.waiting} hint={overview.waiting ? "Η Viva τα ξαναστέλνει μόνη της· δεν χρειάζεται κάτι" : "Τίποτα σε αναμονή"} />
          <Kpi icon={RefreshCw} tone={overview.retrying ? "warning" : "neutral"} label="Θα ξαναδοκιμαστούν" value={overview.retrying} hint={overview.retrying ? "Χωρίς σύνδεση· η επανάληψη γίνεται αυτόματα" : "Καμία αποτυχία σύνδεσης"} />
          <Kpi icon={Wrench} tone={overview.manual ? "danger" : "success"} label="Θέλουν διόρθωση" value={overview.manual} hint={overview.manual ? "Η ΑΑΔΕ τα απέρριψε· άνοιξέ τα από τη λίστα παρακάτω" : "Κανένα απορριφθέν"} />
        </div>
        {overview.attention.length ? (
          <Card className="p-0">
            <h2 className="border-b px-5 py-3 font-semibold">Θέλουν προσοχή</h2>
            <ul className="divide-y">
              {overview.attention.map((a) => (
                <li key={a.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[12rem_1fr_auto] sm:items-center sm:gap-4">
                  <p className="font-semibold">{a.href ? <Link href={a.href} className="underline-offset-2 hover:underline">{a.label}</Link> : a.label} <span className="font-normal text-muted-foreground">{DOC_TYPES[a.docType] ?? a.docType}</span></p>
                  <p className="text-sm break-words text-muted-foreground">{a.message ?? "Χωρίς μήνυμα"}</p>
                  <p className={a.manual ? "text-sm font-medium text-destructive" : "text-sm text-warning-ink"}>
                    {a.manual ? `Διόρθωση από εσένα · ${a.attempts} ${a.attempts === 1 ? "προσπάθεια" : "προσπάθειες"}` : `Ξανά στις ${clock.format(a.nextAt!)} · προσπάθεια ${a.attempts + 1}`}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card>
          <DataTable
            id="fiscal-attempts"
            listing={{
              ...list, total: page.total, placeholder: "MARK",
              filters: [
                { key: "type", label: "Είδος", value: docType, options: Object.entries(DOC_TYPES) },
                { key: "status", label: "Αποτέλεσμα", value: status, options: STATUSES.map((s): [string, string] => [s, STATUS_LABEL[s]]) },
              ],
            }}
            empty={<p>Εδώ γράφεται κάθε αποστολή παραστατικού στην ΑΑΔΕ. Δεν έχει σταλεί κανένα ακόμα.</p>}
            columns={[
              { key: "at", label: "Ώρα", required: true },
              { key: "document", label: "Παραστατικό" },
              { key: "type", label: "Είδος" },
              { key: "status", label: "Αποτέλεσμα" },
              { key: "mark", label: "MARK" },
              { key: "error", label: "Μήνυμα", wrap: true, narrowHidden: true },
            ]}
            rows={page.rows.map((r) => ({
              id: r.id,
              details: r.message ? { label: r.label, view: <p className="text-sm break-words">{r.message}</p> } : undefined,
              cells: {
                at: <span className="tabular-nums">{time.format(r.at)}</span>,
                document: r.label,
                type: DOC_TYPES[r.docType] ?? r.docType,
                status: <StatusBadge kind="fiscal" value={r.toStatus} />,
                mark: r.mark ? <span className="font-mono tabular-nums">{r.mark}</span> : "—",
                error: r.message ?? "—",
              },
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
