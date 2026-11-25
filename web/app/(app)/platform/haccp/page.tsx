import { RefreshCw, ShieldCheck } from "lucide-react";
import { Submit } from "@/components/submit";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Badge, btn, Card, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { HACCP_SOURCES } from "@/lib/haccp/sources";
import { listParams } from "@/lib/paging";
import { look } from "@/lib/status";
import { assessAllHaccpTenants, refreshHaccpSources } from "./actions";

const fmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });
export default async function PlatformHaccpPage({ searchParams }: PageProps<"/platform/haccp">) {
  await requirePlatform("orgs.read");
  const list = listParams(await searchParams, 25, ["name"]);
  // αναζήτηση: επωνυμία ή ΑΦΜ· η τελευταία αξιολόγηση κάθε επιχείρησης έρχεται μαζί της, όχι από τις 2000 πιο πρόσφατες όλων
  const where = list.q ? { OR: [{ name: { contains: list.q, mode: "insensitive" as const } }, { vatNumber: { contains: list.q } }] } : {};
  const [orgs, total, orgCount, assessed, checks] = await Promise.all([
    db.organization.findMany({ where, orderBy: [{ name: list.sort === "name" ? list.dir : "asc" }, { id: "asc" }], skip: list.skip, take: list.take, select: { id: true, name: true, vatNumber: true, haccpAssessments: { orderBy: { evaluatedAt: "desc" }, take: 1 } } }),
    db.organization.count({ where }),
    db.organization.count(),
    db.organization.count({ where: { haccpAssessments: { some: {} } } }),
    db.haccpSourceCheck.findMany(),
  ]);
  const checkMap = new Map(checks.map((item) => [item.sourceId, item]));
  return <Page section="Πλατφόρμα" title="HACCP ανά συνδρομητή" description="Στιγμιότυπα πληρότητας τεκμηρίωσης και κατάσταση επίσημων πηγών" actions={<div className="flex flex-wrap gap-2"><form action={refreshHaccpSources}><Submit className={btn("outline", "sm")} pendingText="Έλεγχος πηγών…"><RefreshCw /> Έλεγχος πηγών</Submit></form><form action={assessAllHaccpTenants}><Submit className={btn("default", "sm")} pendingText="Αξιολόγηση…"><ShieldCheck /> Αξιολόγηση όλων</Submit></form></div>}>
    <div className="grid max-w-[110rem] gap-5">
      <p className="rounded-lg bg-secondary/45 px-4 py-3 text-sm text-muted-foreground">Ο βαθμός συγκρίνει πληρότητα τεκμηρίωσης, όχι νομική συμμόρφωση. Η προγραμματισμένη εργασία αποθηκεύει νέο snapshot ανά tenant· εδώ εμφανίζεται το τελευταίο.</p>
      <Card>
        <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg font-semibold">Ελλείψεις ανά επιχείρηση</h2><p className="text-sm text-muted-foreground">{orgCount} συνδρομητές · {assessed} αξιολογήσεις</p></div>
        <DataTable
          id="platform-haccp-orgs"
          listing={{ ...list, total, placeholder: "Επωνυμία ή ΑΦΜ" }}
          empty="Εδώ φαίνεται, για κάθε συνδρομητή, πόσο πλήρης είναι η τεκμηρίωση HACCP του. Δεν υπάρχει κανένας συνδρομητής ακόμα."
          columns={[
            { key: "name", label: "Επιχείρηση", required: true, sortable: true },
            { key: "vat", label: "ΑΦΜ" },
            { key: "score", label: "Δείκτης" },
            { key: "critical", label: "Κρίσιμα", numeric: true },
            { key: "warnings", label: "Προειδοποιήσεις", numeric: true },
            { key: "evaluated", label: "Αξιολόγηση" },
          ]}
          rows={orgs.map((org) => {
            const item = org.haccpAssessments[0];
            return {
              id: org.id,
              cells: {
                name: <span className="font-semibold">{org.name}</span>,
                vat: org.vatNumber,
                score: item ? <StatusBadge look={look(item.score >= 80 ? "success" : item.score >= 50 ? "warning" : "danger", `${item.score}/100`)} /> : "—",
                critical: item ? (item.critical > 0 ? <StatusBadge look={look("danger", String(item.critical))} /> : 0) : "—",
                warnings: item ? (item.warnings > 0 ? <StatusBadge look={look("warning", String(item.warnings))} /> : 0) : "—",
                evaluated: item ? fmt.format(item.evaluatedAt) : "Δεν έχει εκτελεστεί",
              },
            };
          })}
        />
      </Card>
      <Card><div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg font-semibold">Υγεία πηγών</h2><p className="text-sm text-muted-foreground">Κάθε πηγή που άλλαξε ή δεν ελέγχθηκε θέλει ανθρώπινο έλεγχο του σχετικού περιεχομένου.</p></div><div className="grid gap-px bg-border/60 md:grid-cols-2 xl:grid-cols-3">{HACCP_SOURCES.map((source) => { const check = checkMap.get(source.id); return <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="bg-card p-4 hover:bg-secondary/25"><div className="flex items-center gap-2"><Badge>{source.authority}</Badge><StatusBadge kind="sourceCheck" value={check?.status ?? "NOT_CHECKED"} /></div><h3 className="mt-2 text-sm font-semibold">{source.title}</h3><p className="mt-1 text-xs text-muted-foreground">{check ? fmt.format(check.checkedAt) : "Χωρίς έλεγχο"}</p></a>; })}</div></Card>
    </div>
  </Page>;
}
