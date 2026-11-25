import { BarChart3, CalendarDays, Coins, Factory, Info, Landmark, Percent, ReceiptText, TrendingUp, WalletCards } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge, btn, Card, Field, Kpi, Page, Select } from "@/components/ui";
import { DataTable, type Column } from "@/components/data-table";
import { PrintButton } from "@/components/print-button";
import { Submit } from "@/components/submit";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { businessReport, reportTarget } from "@/lib/reports-db";
import { moveLabel } from "@/lib/status";
import { requireStockContext } from "@/lib/stock-context";

const money = (value: number) => euro(value);
const number = (value: number) => value.toLocaleString("el-GR");
const day = (value: Date) => new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens" }).format(value);
const maybe = (value: number | null) => value == null ? "—" : money(value);
const COST_COLS: Column[] = [{ key: "materials", label: "Υλικά", numeric: true, narrowHidden: true }, { key: "labour", label: "Εργατικά", numeric: true, narrowHidden: true }, { key: "waste", label: "Φύρα", numeric: true, narrowHidden: true }, { key: "cogs", label: "Κόστος", numeric: true }];
const AGING_COLS: Column[] = [{ key: "current", label: "Εντός", numeric: true }, { key: "d30", label: "1–30", numeric: true }, { key: "d60", label: "31–60", numeric: true }, { key: "late", label: "61+", numeric: true }, { key: "total", label: "Σύνολο", numeric: true }];
type Aging = { current: number; days1to30: number; days31to60: number; days61to90: number; over90: number };
const agingCells = (a: Aging, total: number) => {
  const late = a.days61to90 + a.over90;
  return { current: money(a.current), d30: money(a.days1to30), d60: <span className={a.days31to60 ? "text-warning-ink" : ""}>{money(a.days31to60)}</span>, late: <span className={late ? "font-semibold text-destructive" : ""}>{money(late)}</span>, total: <strong>{money(total)}</strong> };
};
/** Πρόοδος προς στόχο: για έσοδα το «πάνω από» είναι καλό, για κόστη είναι πρόβλημα. */
function TargetBar({ label, actual, target, higherIsBetter }: { label: string; actual: number; target: number; higherIsBetter?: boolean }) {
  const pct = target ? Math.round(actual * 100 / target) : 0;
  const good = higherIsBetter ? pct >= 100 : pct <= 100;
  const tone = good ? "bg-success" : higherIsBetter && pct >= 80 ? "bg-warning" : !higherIsBetter && pct <= 110 ? "bg-warning" : "bg-destructive";
  return <div>
    <p className="flex justify-between gap-3"><span>{label}</span><span className="tabular-nums"><strong>{money(actual)}</strong> <span className="text-muted-foreground">/ {money(target)} · {pct}%</span></span></p>
    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${label}: ${pct}% του στόχου`}><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
  </div>;
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const ctx = await requireStockContext("reports.read");
  const query = await searchParams;
  const stores = await db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : ctx.warehouseIds.length ? { id: { in: [] } } : {}) }, orderBy: { name: "asc" } });
  const wanted = typeof query.store === "string" ? query.store : "";
  if (wanted && !stores.some((store) => store.id === wanted)) notFound();
  const store = stores.find((row) => row.id === wanted) ?? null;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
  const defaultFromDate = new Date(`${today}T00:00:00.000Z`);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);
  const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
  const from = typeof query.from === "string" ? query.from : defaultFrom;
  const to = typeof query.to === "string" ? query.to : today;
  const report = await businessReport(ctx, { from, to, storeId: store?.id });
  const target = await reportTarget(ctx, report.period, store?.id);
  const marginPct = report.sales.netRevenueCents ? Math.round(report.margin.grossCents * 1000 / report.sales.netRevenueCents) / 10 : 0;

  return <Page section="Ομάδα & δεδομένα" title="Επιχειρησιακές αναφορές" description="Πωλήσεις, κόστος και περιθώριο ανά κατάστημα, χωριστά λιανική και χονδρική" actions={<span className="print:hidden"><PrintButton /></span>}>
    <div className="grid max-w-[100rem] gap-4">
      <Card className="p-4 print:hidden"><form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.5fr_auto]"><Field label="Από" name="from" type="date" defaultValue={report.period.from} required /><Field label="Έως" name="to" type="date" defaultValue={report.period.to} required /><Select label="Κατάστημα" name="store" defaultValue={store?.id ?? ""} options={[...(ctx.storeIds.length || ctx.warehouseIds.length ? [] : [["", "Όλα τα καταστήματα"] as [string, string]]), ...stores.map((row): [string, string] => [row.id, row.name])]} /><Submit className={btn("default")}><CalendarDays /> Εφαρμογή</Submit></form></Card>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={TrendingUp} label="Καθαρές πωλήσεις" value={money(report.sales.netRevenueCents)} tone={target ? (report.sales.netRevenueCents >= target.salesCents ? "success" : "warning") : "neutral"} hint={`Ταμείο ${money(report.sales.posNetCents)} · χονδρική ${money(report.sales.wholesaleNetCents)}`} />
        <Kpi icon={Percent} label="Μικτό περιθώριο" value={`${marginPct}%`} tone={!report.sales.netRevenueCents ? "neutral" : marginPct >= 60 ? "success" : marginPct >= 40 ? "warning" : "danger"} hint={!report.sales.netRevenueCents ? "Δεν υπάρχουν πωλήσεις στην περίοδο" : `${money(report.margin.grossCents)} μετά από κόστος ${money(report.margin.cogsCents)}${marginPct < 60 ? " · έλεγξε τιμές και φύρα" : ""}`} />
        <Kpi icon={Coins} label="Επιχειρησιακό αποτέλεσμα" value={money(report.margin.operatingCents)} tone={report.margin.operatingCents > 0 ? "success" : report.margin.operatingCents < 0 ? "danger" : "neutral"} hint={`${report.margin.operatingCents < 0 ? "Ζημιά · " : ""}Έξοδα ${money(report.margin.expenseNetCents)}${ctx.can("staff.pay") ? ` · προσωπικό ${money(report.margin.payrollCents)}` : ""}`} />
        <Kpi icon={Landmark} label={report.vat.balanceCents >= 0 ? "ΦΠΑ για πληρωμή" : "ΦΠΑ προς επιστροφή"} value={money(Math.abs(report.vat.balanceCents))} tone={report.vat.balanceCents > 0 ? "warning" : report.vat.balanceCents < 0 ? "success" : "neutral"} hint={`Εκτίμηση · από πωλήσεις ${money(report.vat.outputCents)}, συμψηφίζεται ${money(report.vat.purchaseCents + report.vat.expenseCents)}`} />
      </section>
      {report.margin.unallocatedPosCogsCents || report.margin.unallocatedCommissionCents ? <p role="status" className="rounded-lg bg-warning/15 px-4 py-3 text-warning-ink">Κόστος ταμείου {money(report.margin.unallocatedPosCogsCents)} και προμήθειες {money(report.margin.unallocatedCommissionCents)} δεν αντιστοιχίστηκαν σε προϊόν. Τα σύνολα είναι σωστά, η ανάλυση ανά προϊόν όχι πλήρης.</p> : null}
      <details className="rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground">
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-foreground"><Info className="size-4 text-gold-ink" aria-hidden /> Πώς υπολογίζονται · {report.margin.posCostedMovements}/{report.margin.posMovementCount} πωλήσεις ταμείου έχουν πραγματικό κόστος</summary>
        <div className="mt-2 grid gap-2">
          <p>Η αναφορά είναι διαχειριστική, όχι φορολογική δήλωση. Το θεωρητικό κόστος συνταγής δεν μετράει ως πραγματικό κόστος πώλησης.</p>
          <p>Υλικά, εργατικά και φύρα έρχονται από το κόστος της παρτίδας που πουλήθηκε και αθροίζουν στο κόστος· δεν χρεώνονται ξανά. Η γενική μισθοδοσία, οι βάρδιες καταστημάτων και τα λοιπά έξοδα δεν μοιράζονται σε προϊόντα.</p>
          <p>Προμήθειες {money(report.margin.commissionCents)} από κλεισμένα ταμεία. Μοιράζονται μόνο στις πωλήσεις ταμείου, ανάλογα με τις πωλήσεις κάρτας/πλατφόρμας της ίδιας ημέρας και καταστήματος.</p>
          {!ctx.can("staff.pay") ? <p>Η ανάλυση υλικών/εργατικών/φύρας θέλει δικαίωμα αμοιβών· το «—» δεν σημαίνει μηδενικό κόστος.</p> : null}
        </div>
      </details>

      <section className="grid gap-2"><h2 className="flex items-center gap-2 text-base font-semibold"><BarChart3 className="size-4 text-gold-ink" aria-hidden /> Ταμείο ανά προϊόν</h2>
        <Card><DataTable id="report-products" empty={<p>Καμία πώληση ταμείου στην περίοδο.</p>}
          columns={[{ key: "name", label: "Προϊόν", required: true }, { key: "qty", label: "Τεμ.", numeric: true }, { key: "net", label: "Καθαρές", numeric: true }, ...COST_COLS, { key: "commission", label: "Προμήθειες", numeric: true, narrowHidden: true }, { key: "contribution", label: "Μένουν", numeric: true }]}
          rows={report.products.map((row) => ({ id: row.id, cells: { name: <span className="font-medium">{row.name}</span>, qty: number(row.quantity), net: money(row.netCents), materials: maybe(row.materialsCents), labour: maybe(row.labourCents), waste: maybe(row.wasteCents), cogs: money(row.cogsCents), commission: money(row.commissionCents), contribution: <strong className={row.contributionCents < 0 ? "text-destructive" : "text-success-ink"}>{money(row.contributionCents)}</strong> } }))} /></Card>
      </section>
      <section className="grid gap-2"><h2 className="flex items-center gap-2 text-base font-semibold"><ReceiptText className="size-4 text-gold-ink" aria-hidden /> Χονδρική ανά είδος</h2>
        <Card><DataTable id="report-wholesale" empty={<p>Κανένα τιμολόγιο ή πιστωτικό χονδρικής στην περίοδο.</p>}
          columns={[{ key: "name", label: "Είδος", required: true }, { key: "qty", label: "Ποσότητα", numeric: true }, { key: "net", label: "Καθαρές", numeric: true }, ...COST_COLS, { key: "contribution", label: "Μένουν", numeric: true }]}
          rows={report.wholesaleItems.map((row) => ({ id: row.id, cells: { name: <span className="font-medium">{row.name}</span>, qty: number(row.quantityBase), net: money(row.netCents), materials: maybe(row.materialsCents), labour: maybe(row.labourCents), waste: maybe(row.wasteCents), cogs: money(row.cogsCents), contribution: <strong className={row.contributionCents < 0 ? "text-destructive" : "text-success-ink"}>{money(row.contributionCents)}</strong> } }))} /></Card>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden"><h2 className="flex items-center gap-2 border-b border-border p-4 font-semibold"><Factory className="size-4 text-gold-ink" aria-hidden /> Παραγωγή & φύρα</h2>
          <div className="grid grid-cols-2 gap-px bg-border/70 sm:grid-cols-4">{([["Παρτίδες", number(report.production.batches), ""], ["Παρήχθησαν", `${number(report.production.actualGrams)} g`, ""], ["Φύρα", `${number(report.production.wasteGrams)} g`, report.production.wasteGrams ? "text-warning-ink" : "text-success-ink"], ["Εργασία", `${number(report.production.labourMinutes)} λεπτά`, ""]] as const).map(([label, value, tone]) => <div key={label} className="bg-card p-3"><p className="text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</p></div>)}</div>
          <ul className="divide-y divide-border/60">{report.production.rows.map((row) => <li key={row.id} className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><strong>{row.batchNumber}</strong><span className="block text-muted-foreground">{row.recipeName} · {day(row.producedAt)}</span></div><span className="tabular-nums">{number(row.actualGrams)} / {number(row.expectedGrams)} g</span><div className="text-right"><Badge tone={row.wasteGrams ? "warning" : "success"}>{row.wasteGrams ? `φύρα ${number(row.wasteGrams)} g` : "χωρίς φύρα"}</Badge>{row.scrapReason ? <span className="mt-1 block text-muted-foreground">{row.scrapReason}</span> : null}</div></li>)}</ul>
          {!report.production.rows.length ? <p className="p-6 text-center text-muted-foreground">Καμία παρτίδα στην περίοδο.</p> : null}
        </Card>
        <Card className="overflow-hidden"><h2 className="flex items-center gap-2 border-b border-border p-4 font-semibold"><WalletCards className="size-4 text-gold-ink" aria-hidden /> Κίνηση λογαριασμών</h2>
          <div className="grid grid-cols-3 gap-px bg-border/70"><div className="bg-card p-4"><p className="text-muted-foreground">Μπήκαν</p><p className="text-lg font-semibold text-success-ink tabular-nums">{money(report.cash.inCents)}</p></div><div className="bg-card p-4"><p className="text-muted-foreground">Βγήκαν</p><p className="text-lg font-semibold text-destructive tabular-nums">{money(report.cash.outCents)}</p></div><div className="bg-card p-4"><p className="text-muted-foreground">Διαφορά</p><p className={`text-lg font-semibold tabular-nums ${report.cash.netCents < 0 ? "text-destructive" : ""}`}>{money(report.cash.netCents)}</p></div></div>
          <ul className="divide-y divide-border/60 border-t border-border/60">{report.cash.rows.slice(0, 12).map((row) => <li key={row.id} className="flex justify-between gap-3 p-3"><span>{moveLabel(row.kind)}<span className="block text-muted-foreground">{day(row.occurredAt)}</span></span><span className={`tabular-nums ${row.amountCents < 0 ? "text-destructive" : "text-success-ink"}`}>{money(row.amountCents)}</span></li>)}</ul>
          <p className="border-t border-border/60 p-3 text-muted-foreground">Χωρίς τις μεταφορές μεταξύ λογαριασμών.</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="grid gap-2"><h2 className="text-base font-semibold">Μας χρωστούν (πελάτες)</h2>
          <Card><DataTable id="report-customers-aging" empty={<p>Κανένας πελάτης δεν χρωστά.</p>} columns={[{ key: "name", label: "Πελάτης", required: true }, ...AGING_COLS]} rows={report.customers.map((row) => ({ id: row.id, cells: { name: row.name, ...agingCells(row.aging, row.outstandingCents) } }))} /></Card>
        </section>
        <section className="grid gap-2"><h2 className="text-base font-semibold">Χρωστάμε (προμηθευτές)</h2>
          <Card><DataTable id="report-suppliers-aging" empty={<p>Δεν χρωστάμε σε κανέναν προμηθευτή.</p>} columns={[{ key: "name", label: "Προμηθευτής", required: true }, ...AGING_COLS]} rows={report.suppliers.map((row) => ({ id: row.id, cells: { name: row.name, ...agingCells(row.aging, row.outstandingCents) } }))} /></Card>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4"><h2 className="font-semibold">Στόχος μήνα</h2>{target ? <div className="mt-3 grid gap-3">
          <TargetBar label="Πωλήσεις" actual={report.sales.netRevenueCents} target={target.salesCents} higherIsBetter />
          <TargetBar label="Κόστος" actual={report.margin.cogsCents} target={target.cogsCents} />
          <TargetBar label="Έξοδα" actual={report.margin.expenseNetCents} target={target.expenseCents} />
          {ctx.can("staff.pay") ? <TargetBar label="Προσωπικό" actual={report.margin.payrollCents} target={target.payrollCents} /> : null}
        </div> : <p className="mt-3 text-muted-foreground">Δεν έχει οριστεί στόχος για αυτό το κατάστημα και μήνα. Όρισέ τον από τα Οικονομικά → Στόχος.</p>}</Card>
        <Card className="p-4"><h2 className="font-semibold">Αγορές περιόδου</h2><p className="mt-1 text-muted-foreground">Καθαρή αξία {money(report.purchases.netCents)} · ΦΠΑ {money(report.purchases.vatCents)}</p><ul className="mt-3 divide-y divide-border/60">{report.purchases.rows.slice(0, 12).map((row) => <li key={row.id} className="flex justify-between gap-3 py-2"><span>{row.number ?? "Χωρίς αριθμό"}<span className="block text-muted-foreground">{row.supplierName}</span></span><strong className="tabular-nums">{money(row.totalCents)}</strong></li>)}</ul>{!report.purchases.rows.length ? <p className="text-muted-foreground">Καμία οριστικοποιημένη αγορά.</p> : null}</Card>
      </div>
      {ctx.can("staff.pay") ? <section className="grid gap-2"><h2 className="text-base font-semibold">Προσωπικό περιόδου</h2>
        <Card><DataTable id="report-payroll" empty={<p>Δεν υπάρχουν βάρδιες στην περίοδο.</p>} columns={[{ key: "name", label: "Εργαζόμενος", required: true }, { key: "hours", label: "Ώρες", numeric: true }, { key: "cost", label: "Κόστος", numeric: true }]} rows={report.payroll.map((row) => ({ id: row.employeeId, cells: { name: row.name, hours: (row.minutes / 60).toLocaleString("el-GR", { maximumFractionDigits: 1 }), cost: <strong>{money(row.costCents)}</strong> } }))} /></Card>
      </section> : null}
    </div>
  </Page>;
}
