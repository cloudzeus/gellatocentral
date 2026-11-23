import { RefreshCw, ShieldCheck } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { HACCP_SOURCES } from "@/lib/haccp/sources";
import { assessAllHaccpTenants, refreshHaccpSources } from "./actions";

const fmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });
export default async function PlatformHaccpPage() {
  await requirePlatform("orgs.read");
  const [orgs, snapshots, checks] = await Promise.all([
    db.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, vatNumber: true } }),
    db.haccpAssessment.findMany({ orderBy: { evaluatedAt: "desc" }, take: 2000 }),
    db.haccpSourceCheck.findMany(),
  ]);
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) if (!latest.has(snapshot.orgId)) latest.set(snapshot.orgId, snapshot);
  const checkMap = new Map(checks.map((item) => [item.sourceId, item]));
  return <Page section="Πλατφόρμα" title="HACCP ανά συνδρομητή" description="Στιγμιότυπα πληρότητας τεκμηρίωσης και κατάσταση επίσημων πηγών" actions={<div className="flex flex-wrap gap-2"><form action={refreshHaccpSources}><Submit className={btn("outline", "sm")} pendingText="Έλεγχος πηγών…"><RefreshCw /> Έλεγχος πηγών</Submit></form><form action={assessAllHaccpTenants}><Submit className={btn("default", "sm")} pendingText="Αξιολόγηση…"><ShieldCheck /> Αξιολόγηση όλων</Submit></form></div>}>
    <div className="grid max-w-[110rem] gap-5">
      <p className="rounded-lg bg-secondary/45 px-4 py-3 text-sm text-muted-foreground">Ο βαθμός συγκρίνει πληρότητα τεκμηρίωσης, όχι νομική συμμόρφωση. Η προγραμματισμένη εργασία αποθηκεύει νέο snapshot ανά tenant· εδώ εμφανίζεται το τελευταίο.</p>
      <Card><div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg font-semibold">Ελλείψεις ανά επιχείρηση</h2><p className="text-sm text-muted-foreground">{orgs.length} συνδρομητές · {latest.size} αξιολογήσεις</p></div><div className="overflow-x-auto"><table className="w-full min-w-[55rem] text-sm"><thead className="bg-secondary/35 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3">Επιχείρηση</th><th className="px-4 py-3">Δείκτης</th><th className="px-4 py-3">Κρίσιμα</th><th className="px-4 py-3">Προειδοποιήσεις</th><th className="px-4 py-3">Αξιολόγηση</th></tr></thead><tbody className="divide-y divide-border/70">{orgs.map((org) => { const item = latest.get(org.id); return <tr key={org.id}><td className="px-4 py-3"><span className="font-semibold">{org.name}</span><span className="block text-xs text-muted-foreground">ΑΦΜ {org.vatNumber}</span></td><td className="px-4 py-3">{item ? <Badge tone={item.score >= 80 ? "success" : item.score >= 50 ? "warning" : "danger"}>{item.score}/100</Badge> : "—"}</td><td className="px-4 py-3 text-destructive tabular-nums">{item?.critical ?? "—"}</td><td className="px-4 py-3 text-gold-ink tabular-nums">{item?.warnings ?? "—"}</td><td className="px-4 py-3">{item ? fmt.format(item.evaluatedAt) : "Δεν έχει εκτελεστεί"}</td></tr>; })}</tbody></table></div></Card>
      <Card><div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg font-semibold">Υγεία πηγών</h2><p className="text-sm text-muted-foreground">Κάθε CHANGED/ERROR απαιτεί ανθρώπινη αναθεώρηση του σχετικού περιεχομένου.</p></div><div className="grid gap-px bg-border/60 md:grid-cols-2 xl:grid-cols-3">{HACCP_SOURCES.map((source) => { const check = checkMap.get(source.id); return <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="bg-card p-4 hover:bg-secondary/25"><div className="flex items-center gap-2"><Badge>{source.authority}</Badge><Badge tone={check?.status === "OK" ? "success" : check?.status === "ERROR" ? "danger" : "warning"}>{check?.status ?? "NOT_CHECKED"}</Badge></div><h3 className="mt-2 text-sm font-semibold">{source.title}</h3><p className="mt-1 text-xs text-muted-foreground">{check ? fmt.format(check.checkedAt) : "Χωρίς έλεγχο"}</p></a>; })}</div></Card>
    </div>
  </Page>;
}
