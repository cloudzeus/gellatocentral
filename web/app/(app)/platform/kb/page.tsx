import { Eye, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { StatusBadge } from "@/components/status-badge";
import { btn, Card, cn, Field, menuItem, Page, Select } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { statusOptions } from "@/lib/status";
import { helpful } from "@/lib/support/kb";
import { CATEGORIES } from "@/lib/support/rules";
import { budget } from "@/lib/ai/agent";
import { aiConfig } from "@/lib/ai/openrouter";
import { refreshMemory } from "../support/agent-actions";
import { createArticle } from "./actions";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeZone: "Europe/Athens" });

export default async function KbPage({ searchParams }: PageProps<"/platform/kb">) {
  const me = await requirePlatform("support.tickets");
  const sp = await searchParams;
  const list = listParams(sp, 25, ["title", "updated", "views"]);
  const status = filterParam(sp, "status", ["DRAFT", "REVIEW", "PUBLISHED", "RETIRED"]);
  const vis = filterParam(sp, "vis", ["public", "internal"]);
  const like = { contains: list.q, mode: "insensitive" as const };
  const where = { ...(status ? { status } : {}), ...(vis ? { internal: vis === "internal" } : {}), ...(list.q ? { OR: [{ title: like }, { body: like }] } : {}) };
  const [rows, total, counts, votes] = await Promise.all([
    db.kbArticle.findMany({ where, orderBy: list.sort === "title" ? { title: list.dir } : list.sort === "views" ? { views: list.dir } : { updatedAt: list.sort === "updated" ? list.dir : "desc" }, skip: list.skip, take: list.take }),
    db.kbArticle.count({ where }),
    db.kbArticle.groupBy({ by: ["status", "internal"], _count: true }),
    db.kbArticle.aggregate({ where: { status: "PUBLISHED" }, _sum: { helpfulYes: true, helpfulNo: true, views: true } }),
  ]);
  const [ai, money, chunkRows, runRows] = await Promise.all([
    aiConfig(), budget(),
    db.kbChunk.groupBy({ by: ["sourceType"], _count: true }),
    db.agentRun.groupBy({ by: ["outcome"], where: { createdAt: { gte: new Date(new Date().getTime() - 30 * 864e5) } }, _count: true }),
  ]);
  const chunks = { article: chunkRows.find((c) => c.sourceType === "article")?._count ?? 0, ticket: chunkRows.find((c) => c.sourceType === "ticket")?._count ?? 0 };
  const runs = { total: runRows.reduce((x, r) => x + r._count, 0), decided: runRows.filter((r) => r.outcome).reduce((x, r) => x + r._count, 0), sent: runRows.find((r) => r.outcome === "sent")?._count ?? 0 };
  const n = (s: string, internal?: boolean) => counts.filter((c) => c.status === s && (internal === undefined || c.internal === internal)).reduce((x, c) => x + c._count, 0);
  const rate = helpful(votes._sum.helpfulYes ?? 0, votes._sum.helpfulNo ?? 0);
  const tiles = [
    { label: "Δημοσιευμένα άρθρα", value: String(n("PUBLISHED")), hint: `${n("PUBLISHED", false)} για τους πελάτες · ${n("PUBLISHED", true)} εσωτερικά`, warn: false },
    { label: "Προς έγκριση", value: String(n("REVIEW")), hint: n("REVIEW") ? (me.can("support.kb") ? "Περιμένουν εσένα: δημοσιεύονται μόνο αφού τα εγκρίνεις" : "Τα δημοσιεύει όποιος έχει δικαίωμα έγκρισης") : "Κανένα δεν περιμένει έγκριση", warn: n("REVIEW") > 0 },
    { label: "Βοήθησαν τους πελάτες", value: rate === null ? "—" : `${rate}%`, hint: rate === null ? "Δεν υπάρχουν ακόμα αρκετές ψήφοι «Σε βοήθησε;»" : `Από ${(votes._sum.helpfulYes ?? 0) + (votes._sum.helpfulNo ?? 0)} ψήφους · ${votes._sum.views ?? 0} προβολές`, warn: false },
  ];

  return (
    <Page section="Υποστήριξη πελατών" title="Βάση γνώσεων" description="Οι οδηγοί που διαβάζουν οι πελάτες στη «Βοήθεια» και οι εσωτερικές οδηγίες της υποστήριξης"
      actions={
        <Modal label={<><Plus /> Νέο άρθρο</>} variant="default" title="Νέο άρθρο" description="Ξεκινά ως πρόχειρο. Το κείμενο το γράφεις στο επόμενο βήμα">
          <form action={createArticle} className="grid gap-4 [&>button]:justify-self-end">
            <Field label="Τίτλος" name="title" required minLength={5} maxLength={160} placeholder="π.χ. Ο εκτυπωτής δεν τυπώνει" hint="Όπως θα το έψαχνε ο πελάτης" />
            <Select label="Θέμα" name="category" options={Object.entries(CATEGORIES)} />
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="internal" className="size-4 accent-[var(--primary)]" /> Εσωτερικό: το βλέπει μόνο η υποστήριξη</label>
            <Submit className={btn("default")}>Δημιουργία</Submit>
          </form>
        </Modal>
      }>
      <div className="max-w-7xl space-y-4">
        {typeof sp.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{sp.error.slice(0, 200)}</p> : null}
        <div className="grid gap-4 md:grid-cols-3">
          {tiles.map((t) => (
            <Card key={t.label} className="px-5 py-4">
              <p className="font-medium text-muted-foreground">{t.label}</p>
              <p className={cn("mt-1.5 text-3xl leading-tight font-semibold tabular-nums", t.warn && "text-gold-ink")}>{t.value}</p>
              <p className="mt-1.5 text-muted-foreground">{t.hint}</p>
            </Card>
          ))}
        </div>
        <Card id="agent" className="scroll-mt-28">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
            <Sparkles className="size-5 shrink-0 text-gold-ink" />
            <div className="min-w-0 flex-1"><h2 className="text-lg">Μνήμη και agent</h2><p className="text-sm text-muted-foreground">{ai.memory ? "Τα δημοσιευμένα άρθρα και τα λυμένα αιτήματα γίνονται αναζητήσιμα με το νόημα. Τα αιτήματα ενός πελάτη χρησιμοποιούνται μόνο για τον ίδιο" : "Κλειστό: ορίζεται στις Ρυθμίσεις & email › OpenRouter. Μέχρι τότε η αναζήτηση γίνεται με λέξεις και δεν υπάρχουν προσχέδια"}</p></div>
            {ai.memory && me.can("support.kb") ? <form action={refreshMemory}><Submit className={btn("outline")}>Ενημέρωση μνήμης</Submit></form> : null}
          </div>
          <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs font-medium text-muted-foreground">Στη μνήμη</dt><dd className="font-semibold tabular-nums">{chunks.article} κομμάτια άρθρων · {chunks.ticket} από λυμένα αιτήματα</dd></div>
            <div><dt className="text-xs font-medium text-muted-foreground">Agent</dt><dd className="font-semibold">{ai.level >= 1 && ai.chat ? "Βοηθός υπαλλήλου: προσχέδια" : "Κλειστός"}</dd></div>
            <div><dt className="text-xs font-medium text-muted-foreground">Κόστος αυτόν τον μήνα</dt><dd className={cn("font-semibold tabular-nums", money.limit > 0 && money.left <= 0 && "text-destructive")}>{money.spent.toFixed(2)} $ {money.limit ? `από όριο ${money.limit.toFixed(2)} $` : "· χωρίς όριο, άρα χωρίς προσχέδια"}</dd></div>
            <div><dt className="text-xs font-medium text-muted-foreground">Προσχέδια (30 ημέρες)</dt><dd className="font-semibold tabular-nums">{runs.total ? `${runs.total} · ${Math.round((runs.sent / Math.max(1, runs.decided)) * 100)}% στάλθηκαν χωρίς αλλαγή` : "Κανένα ακόμα"}</dd></div>
          </dl>
        </Card>
        <Card>
          <DataTable
            id="kb"
            listing={{
              ...list, total, placeholder: "Τίτλος ή κείμενο",
              filters: [
                { key: "status", label: "Κατάσταση", value: status, options: statusOptions("kb") },
                { key: "vis", label: "Ορατότητα", value: vis, options: [["public", "Για τους πελάτες"], ["internal", "Εσωτερικά"]] },
              ],
            }}
            empty="Κανένα άρθρο ακόμα. Πάτα «Νέο άρθρο», ή φτιάξε ένα από λυμένο αίτημα"
            columns={[
              { key: "title", label: "Άρθρο", required: true, sortable: true },
              { key: "vis", label: "Ορατότητα" },
              { key: "status", label: "Κατάσταση" },
              { key: "use", label: "Χρησιμότητα" },
              { key: "views", label: "Προβολές", numeric: true, sortable: true },
              { key: "updated", label: "Τελευταία αλλαγή", sortable: true },
            ]}
            rows={rows.map((a) => {
              const h = helpful(a.helpfulYes, a.helpfulNo);
              return {
                id: a.id,
                cells: {
                  title: <><Link href={`/platform/kb/${a.id}`} className="font-semibold underline-offset-2 hover:underline">{a.title}</Link><span className="block text-xs text-muted-foreground">{CATEGORIES[a.category as keyof typeof CATEGORIES] ?? a.category}{a.sourceTicketId ? " · από αίτημα" : ""}</span></>,
                  vis: a.internal ? "Εσωτερικό" : "Για τους πελάτες",
                  status: <StatusBadge kind="kb" value={a.status} />,
                  use: a.internal ? <span className="text-muted-foreground">—</span> : h === null ? <span className="text-muted-foreground">λίγες ψήφοι</span> : `Βοήθησε το ${h}%`,
                  views: a.views,
                  updated: `${a.updatedByName ?? a.authorName} · ${day.format(a.updatedAt)}`,
                },
                menu: <Link href={`/platform/kb/${a.id}`} role="menuitem" className={menuItem}><Eye /> Άνοιγμα άρθρου</Link>,
              };
            })}
          />
        </Card>
      </div>
    </Page>
  );
}
