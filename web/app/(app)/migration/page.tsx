import { DatabaseBackup, RotateCcw, Upload } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, TextareaField } from "@/components/ui";
import { migrationRuns, type MigrationMode, type MigrationResult } from "@/lib/legacy-migration-db";
import type { MigrationReconciliation } from "@/lib/legacy-migration";
import { expectedActivationConfirmation } from "@/lib/migration-cutover";
import { migrationCutover } from "@/lib/migration-cutover-db";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { activateCutover, freezeCutover, migrateLegacy, readyCutover, rollbackCutover, rollbackMigration, startCutover } from "./actions";

type Summary = { mode: MigrationMode; results: MigrationResult[]; expected: MigrationReconciliation; actual: MigrationReconciliation; differences: string[]; note: string; rollback?: { reason: string; deleted: number } };
const example = (source = "old-gelato") => JSON.stringify({ version: 1, source, parties: [], items: [], stockLots: [], documents: [] }, null, 2);
const labels = { party: "Συναλλασσόμενοι", item: "Γενικά είδη", stock_lot: "Παρτίδες", sales_document: "Παραστατικά" } as const;
const date = (value: Date) => new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(value);

export default async function MigrationPage({ searchParams }: PageProps<"/migration">) {
  const ctx = await requireStockContext("migration.read");
  const query = await searchParams;
  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;
  const runs = restricted ? [] : await migrationRuns(ctx);
  const cutover = restricted ? null : await migrationCutover(ctx);
  const selected = runs.find((run) => run.id === query.run) ?? runs[0] ?? null;
  const summary = selected?.summary as unknown as Summary | undefined;
  const kind = cutover?.status === "PREPARING" ? "BASELINE" : "DELTA";
  const canImport = !cutover || (cutover.status === "PREPARING" && !cutover.baselineRunId) || cutover.status === "FROZEN" || cutover.status === "DELTA_IMPORTED";
  return <Page section="Ρυθμίσεις" title="Μεταφορά παλιών δεδομένων" description="Canonical JSON, dry-run, idempotent import και reconciliation πριν από οποιοδήποτε cutover">
    <div className="grid max-w-7xl gap-5">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
      {typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}
      {restricted ? <Card role="alert" className="p-5 text-sm text-warning-ink">Η μεταφορά απαιτεί καθολικό δικαίωμα σε όλα τα καταστήματα και τις αποθήκες του tenant.</Card> : <>
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto font-semibold">Ελεγχόμενο cutover</h2>{cutover ? <Badge tone={cutover.status === "ACTIVE" ? "success" : cutover.status === "ROLLED_BACK" ? "warning" : "neutral"}>{cutover.status}</Badge> : null}</div>
          {!cutover ? <form action={startCutover} className="mt-4 flex flex-wrap items-end gap-2"><Field label="Πηγή" name="source" defaultValue="old-gelato" required maxLength={80} /><Submit className={btn("default")}>Έναρξη PREPARING</Submit></form> : <div className="mt-3 grid gap-3 text-sm">
            <p><strong>{cutover.source}</strong> · cursor <code>{cutover.cursor ?? "—"}</code></p>
            <p className="text-xs text-muted-foreground">Το freeze απαιτεί πραγματικό adapter evidence. Χωρίς ρυθμισμένο adapter η ενέργεια αποτυγχάνει και δεν δηλώνεται επιτυχής. Μετά το ROLLED_BACK ο tenant παραμένει frozen.</p>
            {ctx.can("migration.add") ? <div className="flex flex-wrap gap-2">
              {cutover.status === "PREPARING" && cutover.baselineRunId ? <form action={freezeCutover}><input type="hidden" name="cutoverId" value={cutover.id} /><Submit className={btn("default")}>Freeze legacy και tenant</Submit></form> : null}
              {cutover.status === "DELTA_IMPORTED" ? <form action={readyCutover}><input type="hidden" name="cutoverId" value={cutover.id} /><Submit className={btn("default")}>Υπολογισμός smoke / READY</Submit></form> : null}
            </div> : null}
            {cutover.status === "READY" && ctx.can("migration.add") ? <form action={activateCutover} className="grid max-w-xl gap-2 rounded-lg border border-border p-3"><input type="hidden" name="cutoverId" value={cutover.id} /><Field label={`Πληκτρολόγησε: ${expectedActivationConfirmation(cutover.id)}`} name="confirmation" required autoComplete="off" /><Submit className={btn("destructive", "default", "justify-self-start")}>Οριστική ενεργοποίηση</Submit></form> : null}
            {!["ACTIVE", "ROLLED_BACK"].includes(cutover.status) && ctx.can("migration.add") ? <form action={rollbackCutover} className="grid max-w-xl gap-2 border-t border-border pt-3"><input type="hidden" name="cutoverId" value={cutover.id} /><TextareaField label="Μη καταστροφικό rollback cutover — αιτιολογία" name="reason" required maxLength={300} rows={2} /><Submit className={btn("outline", "default", "justify-self-start")}><RotateCcw /> Rollback φάσης</Submit></form> : null}
          </div>}
        </Card>
        <Card className="p-5"><div className="flex items-start gap-3"><DatabaseBackup className="mt-1 size-5 text-muted-foreground" /><div><h2 className="font-semibold">Κανονικό legacy export</h2><p className="mt-1 text-sm text-muted-foreground">Υποστηρίζονται parties, items, stockLots και ιστορικά documents με paidCents. Χρησιμοποίησε βασικές ακέραιες μονάδες, λεπτά και έγκυρα store/warehouse IDs του tenant. Credentials, sessions και tokens απορρίπτονται.</p></div></div>
          {ctx.can("migration.add") && canImport ? <form action={migrateLegacy} className="mt-4 grid gap-3">
            {cutover ? <><input type="hidden" name="cutoverId" value={cutover.id} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="previousCursor" value={kind === "DELTA" ? cutover.cursor ?? "" : ""} /><div className="grid gap-3 sm:grid-cols-3"><Field label="Export ID" name="exportId" required maxLength={120} /><Field label="Νέος source cursor" name="sourceCursor" required maxLength={200} /><Field label="Ημερομηνία export" name="exportedAt" type="datetime-local" required /></div></> : null}
            <TextareaField label={`JSON ${cutover ? kind : "export"}`} name="payload" defaultValue={example(cutover?.source)} required rows={14} spellCheck={false} className="font-mono text-xs" />
            <div className="flex flex-wrap gap-2"><Submit name="mode" value="dry-run" className={btn("outline")}>Έλεγχος dry-run</Submit><Submit name="mode" value="import" className={btn("default")} pendingText="Εισαγωγή και συμφωνία…"><Upload /> Εισαγωγή με reconciliation</Submit></div>
          </form> : <p className="mt-4 text-sm text-muted-foreground">{ctx.can("migration.add") ? "Δεν επιτρέπεται νέο import στην τρέχουσα φάση." : "Έχεις μόνο δικαίωμα προβολής."}</p>}
        </Card>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <Card className="overflow-hidden"><h2 className="border-b border-border p-4 font-semibold">Πρόσφατα runs</h2><div className="divide-y divide-border">{runs.map((run) => <a key={run.id} href={`/migration?run=${run.id}`} className="flex items-center gap-3 p-3 hover:bg-secondary"><span className="min-w-0 flex-1"><strong className="block truncate">{run.source}</strong><span className="block text-xs text-muted-foreground">{date(run.createdAt)} · {run.createdByName} · {run.kind}{run.exportId ? ` · ${run.exportId}` : ""}</span></span><Badge tone={run.status === "IMPORTED" ? "success" : run.status === "ROLLED_BACK" ? "warning" : "neutral"}>{run.status}</Badge></a>)}{!runs.length ? <p className="p-6 text-center text-sm text-muted-foreground">Δεν υπάρχουν runs.</p> : null}</div></Card>
          {selected && summary ? <Card className="p-5"><div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Αναφορά {selected.source}</h2><Badge>{summary.results.filter((row) => row.status === "CREATED").length} νέες</Badge><Badge>{summary.results.filter((row) => row.status === "UPDATED").length} ενημερώσεις</Badge><Badge>{summary.results.filter((row) => row.status === "SKIPPED").length} ίδιες</Badge></div>
            <p className="mt-3 text-sm text-muted-foreground">{summary.note}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{(Object.keys(labels) as (keyof typeof labels)[]).map((key) => <div key={key} className="rounded-lg bg-secondary p-3"><dt className="text-xs text-muted-foreground">{labels[key]}</dt><dd className="mt-1 text-xl font-semibold">{summary.actual.counts[key]} / {summary.expected.counts[key]}</dd></div>)}</dl>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><p>Καθαρή αξία: <strong>{euro(summary.actual.money.netCents)}</strong></p><p>Σύνολο: <strong>{euro(summary.actual.money.totalCents)}</strong></p><p>Απλήρωτα: <strong>{euro(summary.actual.money.outstandingCents)}</strong></p><p>Απόθεμα: <strong>{summary.actual.stock.reduce((sum, row) => sum + row.quantityBase, 0)} βασικές μονάδες</strong></p><p>Κόστος αποθέματος: <strong>{euro(summary.actual.stock.reduce((sum, row) => sum + row.costCents, 0))}</strong></p></div>
            {summary.differences.length ? <div role="alert" className="mt-4 rounded-lg bg-warning/15 p-3 text-sm text-warning-ink"><strong>Αποκλίσεις από την τρέχουσα εικόνα</strong><ul className="mt-1 list-disc pl-5">{summary.differences.slice(0, 12).map((difference) => <li key={difference}>{difference}</li>)}</ul></div> : <p role="status" className="mt-4 rounded-lg bg-success/10 p-3 text-sm text-success-ink">Πλήρης συμφωνία πλήθους, χρημάτων, αποθέματος, ανεξόφλητων και κόστους.</p>}
            {selected.status === "IMPORTED" && !selected.cutoverId && ctx.can("migration.add") ? <form action={rollbackMigration} className="mt-5 grid gap-3 border-t border-border pt-4"><input type="hidden" name="runId" value={selected.id} /><TextareaField label="Αιτιολογία rollback" name="reason" required maxLength={300} rows={2} /><Submit className={btn("destructive", "default", "justify-self-start")}><RotateCcw /> Rollback μόνο εγγραφών αυτού του run</Submit><p className="text-xs text-muted-foreground">Δεν διαγράφονται εγγραφές που είχαν ήδη ενημερωθεί, μεταγενέστερες πληρωμές ή παρτίδες με νεότερες κινήσεις.</p></form> : null}
            {summary.rollback ? <p className="mt-4 text-sm text-muted-foreground">Rollback: {summary.rollback.reason} · {summary.rollback.deleted} διαγραφές</p> : null}
          </Card> : null}
        </div>
      </>}
    </div>
  </Page>;
}
