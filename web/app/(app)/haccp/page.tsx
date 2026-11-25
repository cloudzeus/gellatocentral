import Link from "next/link";
import { BookOpen, CheckCircle2, FilePlus2, Printer, ShieldCheck } from "lucide-react";
import { DocumentPdfButton } from "@/components/document-output";
import { Badge, btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { assessTenant } from "@/lib/haccp/assessment-db";
import { HACCP_CATEGORIES, HACCP_FORMS } from "@/lib/haccp/forms";
import { HACCP_GLOSSARY, HACCP_LEGAL_NOTES, HACCP_PRINCIPLES, HACCP_START_STEPS } from "@/lib/haccp/guide";
import { HACCP_SOURCES } from "@/lib/haccp/sources";

const views = [["overview", "Επισκόπηση"], ["records", "Καταχωρίσεις"], ["forms", "Έντυπα & αναφορές"], ["guide", "Απλός οδηγός"], ["sources", "Επίσημες πηγές"]] as const;
const fmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });
const severity = { HIGH: ["Κρίσιμο", "danger"], MEDIUM: ["Προσοχή", "warning"], LOW: ["Παρατήρηση", "neutral"] } as const;
const statusLabel: Record<string, string> = { OK: "Αμετάβλητη", CHANGED: "Άλλαξε", REVIEW: "Πρώτος έλεγχος", ERROR: "Αδυναμία" };

export default async function HaccpPage({ searchParams }: PageProps<"/haccp">) {
  const [ctx, q] = await Promise.all([currentOrg("haccp.read"), searchParams]);
  const view = views.some(([key]) => key === q.view) ? String(q.view) : "overview";
  const scope = ctx.storeIds.length ? { OR: [{ storeId: { in: ctx.storeIds } }, { storeId: null }] } : {};
  const [assessment, records, checks] = await Promise.all([
    assessTenant(ctx.org.id, { storeIds: ctx.storeIds }),
    db.haccpRecord.findMany({ where: { orgId: ctx.org.id, ...scope }, include: { store: { select: { name: true } } }, orderBy: { occurredAt: "desc" }, take: 80 }),
    db.haccpSourceCheck.findMany(),
  ]);
  const checkMap = new Map(checks.map((item) => [item.sourceId, item]));
  const scoreTone = assessment.score >= 80 ? "success" : assessment.score >= 50 ? "warning" : "danger";
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit" }).format(new Date());
  return <Page section="Παραγωγή" title="HACCP & ΕΦΕΤ" description="Οδηγός, τεκμηρίωση, αυτόματα έντυπα και έλεγχος ελλείψεων" actions={<span className="flex flex-wrap gap-2"><DocumentPdfButton entityType="haccp_monthly" entityId={month} />{ctx.can("haccp.add") ? <Link href="/haccp/records/new" className={btn("default", "sm")}><FilePlus2 /> Νέα καταχώριση</Link> : null}</span>}>
    <div className="grid max-w-[110rem] gap-5">
      <nav aria-label="Ενότητες HACCP" className="flex flex-wrap gap-2">{views.map(([key, label]) => <Link key={key} href={`/haccp?view=${key}`} className={btn(view === key ? "default" : "outline", "sm")}>{label}</Link>)}</nav>
      <p className="rounded-lg bg-secondary/45 px-4 py-3 text-sm text-muted-foreground">Ο δείκτης μετρά <strong>πληρότητα τεκμηρίωσης</strong>, όχι νομική συμμόρφωση ή πιστοποίηση. Τα όρια, η ανάλυση κινδύνων και η διάθεση προϊόντος απαιτούν τεκμηρίωση και ευθύνη της επιχείρησης.</p>

      {view === "overview" ? <>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="px-5 py-5"><p className="text-sm text-muted-foreground">Δείκτης πληρότητας</p><div className="mt-2 flex items-end gap-2"><strong className="text-4xl tabular-nums">{assessment.score}</strong><span className="pb-1 text-muted-foreground">/ 100</span><Badge tone={scoreTone}>{assessment.score >= 80 ? "Καλή κάλυψη" : "Χρειάζεται ενέργεια"}</Badge></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${assessment.score}%` }} /></div></Card>
          <Card className="px-5 py-5"><p className="text-sm text-muted-foreground">Κρίσιμα ευρήματα</p><p className="mt-2 text-4xl font-semibold text-destructive tabular-nums">{assessment.critical}</p><p className="mt-2 text-sm">Αποκλίσεις, βασικές ελλείψεις ή θερμοκρασίες εκτός ορίων.</p></Card>
          <Card className="px-5 py-5"><p className="text-sm text-muted-foreground">Προειδοποιήσεις</p><p className="mt-2 text-4xl font-semibold text-warning-ink tabular-nums">{assessment.warnings}</p><p className="mt-2 text-sm">Επανεξετάσεις, πρόσθετη τεκμηρίωση και όρια συσκευών.</p></Card>
        </div>
        <Card><div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4"><div className="flex-1"><h2 className="text-lg font-semibold">Προτεινόμενες ενέργειες</h2><p className="text-sm text-muted-foreground">Αυτόματη αξιολόγηση {fmt.format(assessment.evaluatedAt)}</p></div><Link href="/haccp/forms/assessment-report" className={btn("outline", "sm")}><Printer /> Αναφορά</Link></div>
          {assessment.findings.length ? <div className="divide-y divide-border/70">{assessment.findings.slice(0, 40).map((item) => <div key={item.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[8rem_1fr_auto] lg:items-start"><Badge tone={severity[item.severity][1]}>{severity[item.severity][0]}</Badge><div><h3 className="font-semibold">{item.title}</h3><p className="mt-1 text-sm text-muted-foreground">{item.detail}</p><p className="mt-2 text-sm"><strong>Ενέργεια:</strong> {item.action}</p></div><Link href={item.link} className={btn("outline", "sm")}>Άνοιγμα</Link></div>)}</div> : <p className="flex items-center gap-2 px-5 py-8 text-success"><CheckCircle2 /> Δεν εντοπίστηκαν ελλείψεις από τους διαθέσιμους αυτοματοποιημένους ελέγχους.</p>}
        </Card>
      </> : null}

      {view === "records" ? <Card><div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg font-semibold">Ημερολόγιο τεκμηρίωσης</h2><p className="text-sm text-muted-foreground">Οι 80 πρόσφατες καταχωρίσεις· κάθε αλλαγή καταγράφεται στο audit.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[65rem] text-sm"><thead className="bg-secondary/35 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3">Ημερομηνία</th><th className="px-4 py-3">Έντυπο</th><th className="px-4 py-3">Κατάστημα</th><th className="px-4 py-3">Υπεύθυνος</th><th className="px-4 py-3">Αποτέλεσμα</th><th className="px-4 py-3">Κατάσταση</th></tr></thead><tbody className="divide-y divide-border/70">{records.map((record) => { const template = HACCP_FORMS.find((item) => item.id === record.templateId); return <tr key={record.id}><td className="px-4 py-3 whitespace-nowrap">{fmt.format(record.occurredAt)}</td><td className="px-4 py-3"><Link href={`/haccp/records/${record.id}`} className="font-semibold hover:underline">{template?.title ?? record.templateId}</Link>{record.measuredValue !== null ? <span className="block text-xs text-muted-foreground">{record.measuredValue} {record.unit}</span> : null}</td><td className="px-4 py-3">{record.store?.name ?? "Όλη η επιχείρηση"}</td><td className="px-4 py-3">{record.responsibleName}</td><td className="px-4 py-3"><Badge tone={record.result === "DEVIATION" ? "danger" : record.result === "NA" ? "neutral" : "success"}>{record.result === "DEVIATION" ? "Απόκλιση" : record.result === "NA" ? "Μ.Ο." : "Συμμορφούμενο"}</Badge></td><td className="px-4 py-3">{record.status === "DRAFT" ? "Πρόχειρο" : "Ολοκληρωμένο"}</td></tr>; })}</tbody></table></div>
        {!records.length ? <p className="px-5 py-8 text-muted-foreground">Καμία καταχώριση ακόμη. Ξεκίνα από «Νέα καταχώριση» ή άνοιξε ένα έντυπο.</p> : null}
      </Card> : null}

      {view === "forms" ? <div className="grid gap-5">{HACCP_CATEGORIES.map((category) => <Card key={category}><div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg font-semibold">{category}</h2><p className="text-sm text-muted-foreground">{HACCP_FORMS.filter((item) => item.category === category).length} πρότυπα</p></div><div className="grid gap-px bg-border/60 md:grid-cols-2 xl:grid-cols-3">{HACCP_FORMS.filter((item) => item.category === category).map((item) => <article key={item.id} className="flex flex-col gap-3 bg-card p-5"><div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{item.title}</h3><Badge tone={item.basis === "LEGAL" ? "warning" : "neutral"}>{item.basis === "LEGAL" ? "Νομική βάση" : "Βοήθημα"}</Badge></div><p className="flex-1 text-sm text-muted-foreground">{item.purpose}</p><p className="text-xs text-muted-foreground">{item.autoFill !== "none" ? "Αυτόματη συμπλήρωση διαθέσιμων δεδομένων · " : ""}Εκτύπωση ή αποθήκευση PDF από τον browser.</p><div className="flex flex-wrap gap-2"><Link href={`/haccp/forms/${item.id}`} className={btn("outline", "sm")}><Printer /> Άνοιγμα</Link>{ctx.can("haccp.add") ? <Link href={`/haccp/records/new?template=${item.id}`} className={btn("ghost", "sm")}>Καταχώριση</Link> : null}</div></article>)}</div></Card>)}</div> : null}

      {view === "guide" ? <div className="grid gap-5 lg:grid-cols-2">
        <Card className="px-5 py-5 lg:col-span-2"><h2 className="flex items-center gap-2 text-xl font-semibold"><BookOpen /> Από πού ξεκινάς</h2><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{HACCP_START_STEPS.map(([title, text]) => <section key={title}><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{text}</p></section>)}</div></Card>
        <Card className="px-5 py-5"><h2 className="text-xl font-semibold">Οι 7 αρχές</h2><div className="mt-4 space-y-4">{HACCP_PRINCIPLES.map(([title, text]) => <section key={title}><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{text}</p></section>)}</div></Card>
        <Card className="px-5 py-5"><h2 className="text-xl font-semibold">Έννοιες χωρίς ακαδημαϊκά</h2><dl className="mt-4 space-y-4">{HACCP_GLOSSARY.map(([title, text]) => <div key={title}><dt className="font-semibold">{title}</dt><dd className="mt-1 text-sm text-muted-foreground">{text}</dd></div>)}</dl></Card>
        <Card className="px-5 py-5 lg:col-span-2"><h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck /> Τι πρέπει να μην μπερδεύεις</h2><ul className="mt-4 grid gap-3 md:grid-cols-2">{HACCP_LEGAL_NOTES.map((note) => <li key={note} className="rounded-lg bg-secondary/35 px-4 py-3 text-sm">{note}</li>)}</ul></Card>
      </div> : null}

      {view === "sources" ? <Card><div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg font-semibold">Επίσημες πηγές και έλεγχος αλλαγών</h2><p className="text-sm text-muted-foreground">Fingerprint περιεχομένου και τελικού URL. Αλλαγή ή αδυναμία σημαίνει ανθρώπινη αναθεώρηση — όχι αυτόματη νομική ερμηνεία.</p></div><div className="divide-y divide-border/70">{HACCP_SOURCES.map((source) => { const check = checkMap.get(source.id); return <article key={source.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><Badge>{source.authority}</Badge><span className="text-xs text-muted-foreground">{source.topic}</span>{check ? <Badge tone={check.status === "OK" ? "success" : check.status === "ERROR" ? "danger" : "warning"}>{statusLabel[check.status] ?? check.status}</Badge> : <Badge>Δεν ελέγχθηκε</Badge>}</div><h3 className="mt-2 font-semibold"><a href={source.url} target="_blank" rel="noreferrer" className="hover:underline">{source.title}</a></h3><p className="mt-1 text-sm text-muted-foreground">{source.role}</p>{check ? <p className="mt-2 text-xs text-muted-foreground">Έλεγχος: {fmt.format(check.checkedAt)} · {check.message}</p> : null}</div><a href={source.url} target="_blank" rel="noreferrer" className={btn("outline", "sm")}>Επίσημο κείμενο</a></article>; })}</div></Card> : null}
    </div>
  </Page>;
}
