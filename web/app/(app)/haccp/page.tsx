import Link from "next/link";
import { BookOpen, CheckCircle2, FilePlus2, Printer, ShieldCheck } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { DocumentPdfButton } from "@/components/document-output";
import { StatusBadge } from "@/components/status-badge";
import { Badge, btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { assessTenant } from "@/lib/haccp/assessment-db";
import { HACCP_CATEGORIES, HACCP_FORMS } from "@/lib/haccp/forms";
import { HACCP_GLOSSARY, HACCP_LEGAL_NOTES, HACCP_PRINCIPLES, HACCP_START_STEPS } from "@/lib/haccp/guide";
import { HACCP_SOURCES } from "@/lib/haccp/sources";
import { filterParam, listParams } from "@/lib/paging";
import { look, statusOptions, statusValues } from "@/lib/status";

const views = [["overview", "Επισκόπηση"], ["records", "Καταχωρίσεις"], ["forms", "Έντυπα & αναφορές"], ["guide", "Απλός οδηγός"], ["sources", "Επίσημες πηγές"]] as const;
const fmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });

export default async function HaccpPage({ searchParams }: PageProps<"/haccp">) {
  const [ctx, q] = await Promise.all([currentOrg("haccp.read"), searchParams]);
  const view = views.some(([key]) => key === q.view) ? String(q.view) : "overview";
  const scope = ctx.storeIds.length ? { OR: [{ storeId: { in: ctx.storeIds } }, { storeId: null }] } : {};
  const list = listParams(q, 25, ["date"]);
  const result = filterParam(q, "result", statusValues("haccpResult"));
  const status = filterParam(q, "status", statusValues("haccpRecord"));
  const contains = { contains: list.q, mode: "insensitive" as const };
  const needle = list.q.toLocaleLowerCase("el");
  // αναζήτηση: τίτλος εντύπου (ζει στον κώδικα, όχι στη βάση), υπεύθυνος ή κατάστημα· το scope μένει ξεχωριστό AND για να μην το «σπάσει» το OR
  const where = {
    orgId: ctx.org.id,
    AND: [scope, list.q ? { OR: [{ templateId: { in: HACCP_FORMS.filter((item) => item.title.toLocaleLowerCase("el").includes(needle)).map((item) => item.id) } }, { responsibleName: contains }, { store: { name: contains } }] } : {}],
    ...(result ? { result } : {}),
    ...(status ? { status } : {}),
  };
  const isRecords = view === "records";
  const [assessment, records, total, checks] = await Promise.all([
    assessTenant(ctx.org.id, { storeIds: ctx.storeIds }),
    isRecords ? db.haccpRecord.findMany({ where, include: { store: { select: { name: true } } }, orderBy: [{ occurredAt: list.sort === "date" ? list.dir : "desc" }, { id: "desc" }], skip: list.skip, take: list.take }) : [],
    isRecords ? db.haccpRecord.count({ where }) : 0,
    db.haccpSourceCheck.findMany(),
  ]);
  const checkMap = new Map(checks.map((item) => [item.sourceId, item]));
  const scoreTone = assessment.score >= 80 ? "success" : assessment.score >= 50 ? "warning" : "danger";
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit" }).format(new Date());
  const create = ctx.can("haccp.add") ? <Link href="/haccp/records/new" className={btn("default", "sm")}><FilePlus2 /> Νέα καταχώριση</Link> : null;
  return <Page section="Παραγωγή" title="HACCP & ΕΦΕΤ" description="Οδηγός, τεκμηρίωση, αυτόματα έντυπα και έλεγχος ελλείψεων" actions={<span className="flex flex-wrap gap-2"><DocumentPdfButton entityType="haccp_monthly" entityId={month} />{create}</span>}>
    <div className="grid max-w-[110rem] gap-5">
      <nav aria-label="Ενότητες HACCP" className="flex flex-wrap gap-2">{views.map(([key, label]) => <Link key={key} href={`/haccp?view=${key}`} className={btn(view === key ? "default" : "outline", "sm")}>{label}</Link>)}</nav>
      <p className="rounded-lg bg-secondary/45 px-4 py-3 text-sm text-muted-foreground">Ο δείκτης μετρά <strong>πληρότητα τεκμηρίωσης</strong>, όχι νομική συμμόρφωση ή πιστοποίηση. Τα όρια, η ανάλυση κινδύνων και η διάθεση προϊόντος απαιτούν τεκμηρίωση και ευθύνη της επιχείρησης.</p>

      {view === "overview" ? <>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="px-5 py-5"><p className="text-sm text-muted-foreground">Δείκτης πληρότητας</p><div className="mt-2 flex items-end gap-2"><strong className="text-4xl tabular-nums">{assessment.score}</strong><span className="pb-1 text-muted-foreground">/ 100</span><StatusBadge look={look(scoreTone, assessment.score >= 80 ? "Καλή κάλυψη" : "Χρειάζεται ενέργεια")} /></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${assessment.score}%` }} /></div></Card>
          <Card className="px-5 py-5"><p className="text-sm text-muted-foreground">Κρίσιμα ευρήματα</p><p className="mt-2 text-4xl font-semibold text-destructive tabular-nums">{assessment.critical}</p><p className="mt-2 text-sm">Αποκλίσεις, βασικές ελλείψεις ή θερμοκρασίες εκτός ορίων.</p></Card>
          <Card className="px-5 py-5"><p className="text-sm text-muted-foreground">Προειδοποιήσεις</p><p className="mt-2 text-4xl font-semibold text-gold-ink tabular-nums">{assessment.warnings}</p><p className="mt-2 text-sm">Επανεξετάσεις, πρόσθετη τεκμηρίωση και όρια συσκευών.</p></Card>
        </div>
        <Card><div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4"><div className="flex-1"><h2 className="text-lg font-semibold">Προτεινόμενες ενέργειες</h2><p className="text-sm text-muted-foreground">Αυτόματη αξιολόγηση {fmt.format(assessment.evaluatedAt)}</p></div><Link href="/haccp/forms/assessment-report" className={btn("outline", "sm")}><Printer /> Αναφορά</Link></div>
          {assessment.findings.length ? <div className="divide-y divide-border/70">{assessment.findings.slice(0, 40).map((item) => <div key={item.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[8rem_1fr_auto] lg:items-start"><StatusBadge kind="haccpSeverity" value={item.severity} /><div><h3 className="font-semibold">{item.title}</h3><p className="mt-1 text-sm text-muted-foreground">{item.detail}</p><p className="mt-2 text-sm"><strong>Ενέργεια:</strong> {item.action}</p></div><Link href={item.link} className={btn("outline", "sm")}>Άνοιγμα</Link></div>)}{assessment.findings.length > 40 ? <p className="px-5 py-3 text-sm text-muted-foreground">Εμφανίζονται οι 40 πρώτες από {assessment.findings.length}</p> : null}</div> : <p className="flex items-center gap-2 px-5 py-8 text-success"><CheckCircle2 /> Δεν εντοπίστηκαν ελλείψεις από τους διαθέσιμους αυτοματοποιημένους ελέγχους.</p>}
        </Card>
      </> : null}

      {isRecords ? <section className="grid gap-3"><div><h2 className="text-lg font-semibold">Ημερολόγιο τεκμηρίωσης</h2><p className="text-sm text-muted-foreground">Όλες οι καταχωρίσεις, οι πιο πρόσφατες πρώτα. Κάθε αλλαγή τους καταγράφεται στο ιστορικό ελέγχου.</p></div>
        <Card>
          <DataTable
            id="haccp-records"
            listing={{
              ...list, total, placeholder: "Έντυπο, υπεύθυνος ή κατάστημα", params: { view: "records" },
              filters: [
                { key: "result", label: "Αποτέλεσμα", value: result, options: statusOptions("haccpResult") },
                { key: "status", label: "Κατάσταση", value: status, options: statusOptions("haccpRecord") },
              ],
            }}
            empty={<><p>Εδώ γράφεται κάθε έλεγχος HACCP που κάνεις (θερμοκρασίες, καθαρισμοί, παραλαβές). Δεν υπάρχει καμία καταχώριση ακόμα.</p>{create ? <div className="mt-3 flex justify-center">{create}</div> : null}</>}
            columns={[
              { key: "form", label: "Έντυπο", required: true },
              { key: "date", label: "Ημερομηνία", sortable: true },
              { key: "measured", label: "Μέτρηση", numeric: true },
              { key: "store", label: "Κατάστημα" },
              { key: "responsible", label: "Υπεύθυνος" },
              { key: "result", label: "Αποτέλεσμα" },
              { key: "status", label: "Κατάσταση" },
            ]}
            rows={records.map((record) => ({
              id: record.id,
              cells: {
                form: <Link href={`/haccp/records/${record.id}`} className="font-semibold underline-offset-2 hover:underline">{HACCP_FORMS.find((item) => item.id === record.templateId)?.title ?? record.templateId}</Link>,
                date: fmt.format(record.occurredAt),
                measured: record.measuredValue !== null ? `${record.measuredValue} ${record.unit ?? ""}`.trim() : "—",
                store: record.store?.name ?? "Όλη η επιχείρηση",
                responsible: record.responsibleName,
                result: <StatusBadge kind="haccpResult" value={record.result} />,
                status: <StatusBadge kind="haccpRecord" value={record.status} />,
              },
            }))}
          />
        </Card>
      </section> : null}

      {view === "forms" ? <div className="grid gap-5">{HACCP_CATEGORIES.map((category) => <Card key={category}><div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg font-semibold">{category}</h2><p className="text-sm text-muted-foreground">{HACCP_FORMS.filter((item) => item.category === category).length} πρότυπα</p></div><div className="grid gap-px bg-border/60 md:grid-cols-2 xl:grid-cols-3">{HACCP_FORMS.filter((item) => item.category === category).map((item) => <article key={item.id} className="flex flex-col gap-3 bg-card p-5"><div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{item.title}</h3><Badge tone={item.basis === "LEGAL" ? "warning" : "neutral"}>{item.basis === "LEGAL" ? "Νομική βάση" : "Βοήθημα"}</Badge></div><p className="flex-1 text-sm text-muted-foreground">{item.purpose}</p><p className="text-xs text-muted-foreground">{item.autoFill !== "none" ? "Αυτόματη συμπλήρωση διαθέσιμων δεδομένων · " : ""}Εκτύπωση ή αποθήκευση PDF από τον browser.</p><div className="flex flex-wrap gap-2"><Link href={`/haccp/forms/${item.id}`} className={btn("outline", "sm")}><Printer /> Άνοιγμα</Link>{ctx.can("haccp.add") ? <Link href={`/haccp/records/new?template=${item.id}`} className={btn("ghost", "sm")}>Καταχώριση</Link> : null}</div></article>)}</div></Card>)}</div> : null}

      {view === "guide" ? <div className="grid gap-5 lg:grid-cols-2">
        <Card className="px-5 py-5 lg:col-span-2"><h2 className="flex items-center gap-2 text-xl font-semibold"><BookOpen /> Από πού ξεκινάς</h2><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{HACCP_START_STEPS.map(([title, text]) => <section key={title}><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{text}</p></section>)}</div></Card>
        <Card className="px-5 py-5"><h2 className="text-xl font-semibold">Οι 7 αρχές</h2><div className="mt-4 space-y-4">{HACCP_PRINCIPLES.map(([title, text]) => <section key={title}><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{text}</p></section>)}</div></Card>
        <Card className="px-5 py-5"><h2 className="text-xl font-semibold">Έννοιες χωρίς ακαδημαϊκά</h2><dl className="mt-4 space-y-4">{HACCP_GLOSSARY.map(([title, text]) => <div key={title}><dt className="font-semibold">{title}</dt><dd className="mt-1 text-sm text-muted-foreground">{text}</dd></div>)}</dl></Card>
        <Card className="px-5 py-5 lg:col-span-2"><h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck /> Τι πρέπει να μην μπερδεύεις</h2><ul className="mt-4 grid gap-3 md:grid-cols-2">{HACCP_LEGAL_NOTES.map((note) => <li key={note} className="rounded-lg bg-secondary/35 px-4 py-3 text-sm">{note}</li>)}</ul></Card>
      </div> : null}

      {view === "sources" ? <Card><div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg font-semibold">Επίσημες πηγές και έλεγχος αλλαγών</h2><p className="text-sm text-muted-foreground">Fingerprint περιεχομένου και τελικού URL. Αλλαγή ή αδυναμία σημαίνει ανθρώπινη αναθεώρηση — όχι αυτόματη νομική ερμηνεία.</p></div><div className="divide-y divide-border/70">{HACCP_SOURCES.map((source) => { const check = checkMap.get(source.id); return <article key={source.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><Badge>{source.authority}</Badge><span className="text-xs text-muted-foreground">{source.topic}</span><StatusBadge kind="sourceCheck" value={check?.status ?? "NOT_CHECKED"} /></div><h3 className="mt-2 font-semibold"><a href={source.url} target="_blank" rel="noreferrer" className="hover:underline">{source.title}</a></h3><p className="mt-1 text-sm text-muted-foreground">{source.role}</p>{check ? <p className="mt-2 text-xs text-muted-foreground">Έλεγχος: {fmt.format(check.checkedAt)} · {check.message}</p> : null}</div><a href={source.url} target="_blank" rel="noreferrer" className={btn("outline", "sm")}>Επίσημο κείμενο</a></article>; })}</div></Card> : null}
    </div>
  </Page>;
}
