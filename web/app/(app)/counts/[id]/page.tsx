import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Layers3, Plus, Save, Scale, ShoppingCart, Trash2 } from "lucide-react";
import { OfflineCountMeasurements, OfflineCountQueue, OnlineOnlyFinalize } from "@/components/offline-counts";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Kpi, Page } from "@/components/ui";
import { baseToCountInput } from "@/lib/count-input";
import { countReview, countReviewTotals, type CountReviewItem } from "@/lib/count-review";
import { WASTE_APPROVAL_CENTS } from "@/lib/consumption";
import { db } from "@/lib/db";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { formatStockQuantity, formatStockValue, stockDisplayUnit, stockUnitCostHundredths, stockValueHundredths } from "@/lib/stock-view";
import { addCountLine, addCountLot, finalizeCount, saveCountMeasurements } from "../actions";
import { StatusBadge } from "@/components/status-badge";

const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60";
const th = "px-4 py-3 text-left text-xs font-semibold whitespace-nowrap text-muted-foreground";
// Στο κινητό ο πίνακας γίνεται κάρτες (ίδια πεδία, μία φόρμα): κάθε κελί δείχνει τη δική του ετικέτα.
const td = "align-top md:border-t md:border-border/70 md:px-4 md:py-3";
const cellLabel = "mb-1 block text-xs text-muted-foreground md:hidden";
const pct = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("el-GR", { maximumFractionDigits: 1 })}%`;
const REVIEW: Record<CountReviewItem["status"], { tone: "success" | "danger" | "warning" | "neutral"; text: (item: CountReviewItem) => string }> = {
  ok: { tone: "success", text: (i) => pct(i.deviationPct ?? 0) },
  high: { tone: "danger", text: (i) => `${pct(i.deviationPct ?? 0)} · έλεγξε` },
  low: { tone: "warning", text: (i) => `${pct(i.deviationPct ?? 0)} · λιγότερο` },
  stockout: { tone: "neutral", text: () => "Τελείωσε" },
  pending: { tone: "neutral", text: () => "Περιμένει μέτρηση" },
  noSales: { tone: "neutral", text: () => "Χωρίς πωλήσεις" },
};
const BAR_TONE: Record<CountReviewItem["status"], string> = { ok: "bg-primary/85", high: "bg-destructive", low: "bg-warning", stockout: "bg-muted-foreground/35", pending: "bg-transparent", noSales: "bg-primary/50" };
const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// Η καρτέλα παραμένει Server Component· οι φόρμες συνδέονται με id χωρίς nested forms ή client state.
export default async function CountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const ctx = await requireStockContext("counts.read");
  const warehouses = await db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true } });
  const count = await db.stockCount.findFirst({
    where: { id, orgId: ctx.orgId, warehouseId: { in: warehouses.map((warehouse) => warehouse.id) } },
    include: {
      warehouse: { select: { name: true, active: true } },
      store: { select: { name: true, active: true } },
      lines: {
        include: {
          genericItem: { include: { baseUnit: true } },
          lot: { select: { batchNumber: true, expiresAt: true } },
          movement: { select: { id: true } },
        },
        orderBy: [{ genericItem: { name: "asc" } }, { lotId: "asc" }],
      },
    },
  });
  if (!count) notFound();

  const draft = count.status === "DRAFT";
  const activeScope = count.warehouse.active && (count.store?.active ?? true);
  const canEdit = draft && activeScope && ctx.can("counts.edit");
  const canFinalize = draft && activeScope && ctx.can("counts.finalize");
  const [generics, lots] = canEdit ? await Promise.all([
    db.genericItem.findMany({
      where: { orgId: ctx.orgId, trackStock: true, active: true },
      include: { baseUnit: true },
      orderBy: { name: "asc" },
    }),
    db.stockLot.findMany({
      where: { orgId: ctx.orgId, warehouseId: count.warehouseId },
      include: { genericItem: { select: { name: true } } },
      orderBy: [{ genericItem: { name: "asc" } }, { batchNumber: "asc" }],
    }),
  ]) : [[], []];
  const present = new Set(count.lines.map((line) => `${line.genericItemId}|${line.lotId ?? ""}`));
  const existingOptions = [
    ...generics.map((generic) => ({ value: `${generic.id}|`, label: `${generic.name} · χωρίς παρτίδα` })),
    ...lots.map((lot) => ({ value: `${lot.genericItemId}|${lot.id}`, label: `${lot.genericItem.name} · παρτίδα ${lot.batchNumber ?? "χωρίς αριθμό"}` })),
  ].filter((option) => !present.has(option.value));
  const error = param(q.error);

  // Θεωρητική κατανάλωση (πωλήσεις × μερίδα) στις ημέρες που καλύπτει η απογραφή: από την επόμενη της
  // προηγούμενης οριστικής ως σήμερα, το πολύ 31 ημέρες.
  // shortcut: η προηγούμενη απογραφή είναι ανά αποθήκη, όχι ανά είδος (η οριστικοποίηση το κάνει ανά είδος).
  const countItemIds = [...new Set(count.lines.filter((l) => l.genericItem.consumptionSource === "COUNT").map((l) => l.genericItemId))];
  const previous = countItemIds.length ? await db.stockCount.findFirst({ where: { orgId: ctx.orgId, warehouseId: count.warehouseId, status: "FINALIZED", countedOn: { lt: count.countedOn }, NOT: { id: count.id } }, orderBy: { countedOn: "desc" }, select: { countedOn: true } }) : null;
  const fromDay = new Date(Math.max(previous ? previous.countedOn.getTime() + 86_400_000 : count.countedOn.getTime(), count.countedOn.getTime() - 30 * 86_400_000));
  const theoreticalRows = countItemIds.length ? await db.demandDaily.groupBy({ by: ["genericItemId"], where: { orgId: ctx.orgId, warehouseId: count.warehouseId, genericItemId: { in: countItemIds }, day: { gte: fromDay, lte: count.countedOn } }, _sum: { theoreticalBase: true } }) : [];
  const review = countReview(count.lines.map((l) => ({ genericItemId: l.genericItemId, name: l.genericItem.name, dimension: l.genericItem.baseUnit.dimension, consumptionSource: l.genericItem.consumptionSource, expectedQty: l.expectedQty, actualQty: l.actualQty, wasteQty: l.wasteQty, consumptionQty: l.consumptionQty, unitCostHundredths: l.unitCostHundredths })), new Map(theoreticalRows.map((r) => [r.genericItemId, r._sum.theoreticalBase ?? 0])));
  const reviewById = new Map(review.map((item) => [item.genericItemId, item]));
  const totals = countReviewTotals(review);
  const wasteLines = count.lines.filter((l) => l.wasteQty > 0);
  const wasteCents = wasteLines.reduce((sum, l) => sum + stockValueHundredths(l.wasteQty, l.unitCostHundredths, l.genericItem.baseUnit.dimension) / 100, 0);
  const chartMax = Math.max(1, ...review.map((i) => Math.max(i.consumption ?? 0, i.theoretical)));
  const flagged = review.filter((i) => i.status === "high" || i.status === "low");
  const firstLineOf = new Set(review.map((i) => count.lines.find((l) => l.genericItemId === i.genericItemId)!.id));

  return (
    <Page
      section="Αποθήκη & αγορές"
      title={`Απογραφή ${day.format(count.countedOn)}`}
      description={`${count.store ? `Κατάστημα: ${count.store.name} · ` : "Εργαστήριο / αποθήκη · "}${count.warehouse.name} · ${draft ? "προσχέδιο μετρήσεων" : "οριστικοποιημένο ιστορικό"}`}
      actions={<Link href="/counts" className={btn("outline", "sm")}><ArrowLeft /> Όλες οι απογραφές</Link>}
    >
      <div className="grid max-w-[100rem] gap-5">
        {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Η ενέργεια δεν ολοκληρώθηκε: {error.slice(0, 250)}</p> : null}

        <Card className="px-5 py-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">Στοιχεία απογραφής</h2><StatusBadge kind="stockCount" value={count.status} /></div>
              {count.note ? <p className="mt-2 text-sm">{count.note}</p> : null}
            </div>
            <dl className="grid w-full gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:w-auto lg:min-w-[34rem]">
              <div><dt className="text-xs text-muted-foreground">Snapshot αποθέματος</dt><dd className="font-medium">{dateTime.format(count.snapshotAt)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Δημιουργήθηκε από</dt><dd className="font-medium">{count.createdByName}</dd></div>
              {count.finalizedAt ? <div><dt className="text-xs text-muted-foreground">Οριστικοποίηση</dt><dd className="font-medium">{dateTime.format(count.finalizedAt)}</dd></div> : null}
              {count.finalizedByName ? <div><dt className="text-xs text-muted-foreground">Οριστικοποιήθηκε από</dt><dd className="font-medium">{count.finalizedByName}</dd></div> : null}
            </dl>
          </div>
          {draft ? <p className="mt-4 rounded-lg bg-secondary/45 px-3 py-2 text-xs text-muted-foreground">Γράψε τις ποσότητες σε κιλά, λίτρα ή τεμάχια, όπως φαίνεται σε κάθε γραμμή (π.χ. 1,80 kg). Στο «Πετάχτηκε» μπαίνει ό,τι πετάχτηκε ή έληξε. Αποθήκευσε τις μετρήσεις πριν από την οριστικοποίηση. Αν καταγραφεί νέα κίνηση μετά το snapshot, η οριστικοποίηση απορρίπτεται αντί να γίνει rebase.</p> : null}
          {!count.warehouse.active && draft ? <p className="mt-3 text-sm font-medium text-destructive">Η αποθήκη είναι ανενεργή· η απογραφή παραμένει read-only.</p> : null}
          {count.store && !count.store.active && draft ? <p className="mt-3 text-sm font-medium text-destructive">Το κατάστημα είναι ανενεργό· η απογραφή παραμένει read-only.</p> : null}
        </Card>

        {review.length ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Kpi icon={Scale} label={count.status === "FINALIZED" ? "Κατανάλωση" : "Κατανάλωση ως τώρα"} value={formatStockQuantity(totals.consumption, totals.dimension)} hint={totals.pending ? `${totals.measured} μετρήθηκαν · ${totals.pending} περιμένουν` : `από ${totals.measured} είδη της βιτρίνας`} />
              <Kpi icon={ShoppingCart} label="Σύμφωνα με τις πωλήσεις" value={totals.theoretical > 0 ? formatStockQuantity(totals.theoretical, totals.dimension) : "—"}
                tone={totals.deviationPct === null ? "neutral" : Math.abs(totals.deviationPct) <= 10 ? "success" : totals.deviationPct > 10 ? "danger" : "warning"}
                hint={totals.deviationPct === null ? "Δεν υπάρχουν πωλήσεις για σύγκριση" : `${pct(totals.deviationPct)} απόκλιση · όριο ±10%`} />
              <Kpi icon={Trash2} label="Πετάχτηκαν" value={formatStockValue(Math.round(wasteCents * 100))} tone={wasteCents > WASTE_APPROVAL_CENTS ? "warning" : "neutral"}
                hint={wasteLines.length ? `${wasteLines.length} ${wasteLines.length === 1 ? "είδος" : "είδη"}${wasteCents > WASTE_APPROVAL_CENTS ? " · πάνω από 50 €, δες γιατί" : ""} · δεν μετράνε ως ζήτηση` : "Τίποτα ακόμα"} />
            </div>
            <Card className="px-5 py-4">
              <h2 className="text-lg font-semibold">Ζύγισμα ή πωλήσεις</h2>
              <p className="text-sm text-muted-foreground">Μπάρα: ό,τι έφυγε σύμφωνα με το ζύγισμα. Γραμμή: ό,τι λένε οι πωλήσεις × μερίδα</p>
              <ul className="mt-4 grid gap-3" role="img" aria-label={review.map((i) => `${i.name}: ${i.consumption === null ? "δεν μετρήθηκε" : formatStockQuantity(i.consumption, i.dimension)} έναντι ${formatStockQuantity(i.theoretical, i.dimension)}`).join("· ")}>
                {review.map((item) => (
                  <li key={item.genericItemId} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_8rem]">
                    <span className="truncate text-sm font-medium">{item.name}</span>
                    <span className="relative block h-5 rounded bg-secondary/60">
                      {item.consumption !== null && item.consumption > 0 ? <span className={`absolute inset-y-0 left-0 rounded ${BAR_TONE[item.status]}`} style={{ width: `${(item.consumption / chartMax) * 100}%` }} /> : null}
                      {item.theoretical > 0 ? <span aria-hidden className="absolute -inset-y-1 w-0.5 rounded bg-gold" style={{ left: `calc(${(item.theoretical / chartMax) * 100}% - 1px)` }} /> : null}
                    </span>
                    <span className="col-span-2 text-xs text-muted-foreground tabular-nums sm:col-span-1 sm:text-right"><Badge tone={REVIEW[item.status].tone}>{REVIEW[item.status].text(item)}</Badge></span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-primary/85" />Ζύγισμα</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-0.5 rounded bg-gold" />Πωλήσεις × μερίδα</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-destructive" />Θέλει έλεγχο</span>
              </div>
              {flagged.length ? (
                <div className="mt-4 flex gap-2.5 rounded-lg bg-warning/15 px-4 py-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden />
                  <div className="grid gap-1">
                    {flagged.map((i) => <p key={i.genericItemId}><strong>{i.name}:</strong> {i.status === "high" ? `έφυγε ${pct(i.deviationPct ?? 0).slice(1)} περισσότερο απ’ όσο πουλήθηκε. Ζύγισε ξανά ή γράψε τον λόγο στη γραμμή (μεγάλες μερίδες, δοκιμές, λάθος ζύγισμα).` : `έφυγε ${pct(i.deviationPct ?? 0).slice(1)} λιγότερο απ’ όσο πουλήθηκε. Μάλλον ήρθε ποσότητα που δεν καταχωρήθηκε ή η μερίδα της συνταγής είναι μεγάλη.`}</p>)}
                  </div>
                </div>
              ) : null}
            </Card>
          </>
        ) : null}

        {count.store ? <OfflineCountQueue identity={{ orgId: ctx.orgId, userId: ctx.userId }} /> : null}
        {canEdit ? <form id="count-measurements" action={saveCountMeasurements.bind(null, count.id)} /> : null}
        {canEdit && count.store ? <OfflineCountMeasurements identity={{ orgId: ctx.orgId, userId: ctx.userId }} formId="count-measurements" countId={count.id} expectedUpdatedAt={count.updatedAt.toISOString()} /> : null}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-64 flex-1"><h2 className="text-lg font-semibold">Μετρήσεις ειδών και παρτίδων</h2><p className="text-sm text-muted-foreground">Αναμενόμενο = ό,τι υπήρχε στο snapshot. Στα είδη της βιτρίνας: αναμενόμενο − μετρήθηκε − πετάχτηκε = κατανάλωση. Στα υπόλοιπα, η διαφορά είναι διόρθωση αποθέματος</p></div>
            {canEdit && count.lines.length ? <Submit form="count-measurements" className={btn("outline", "sm")} pendingText="Αποθήκευση…"><Save /> Αποθήκευση μετρήσεων</Submit> : null}
          </div>
          <div className="md:overflow-x-auto">
            <table className="w-full border-collapse text-sm max-md:block md:min-w-[76rem]">
              <thead className="bg-secondary/35 max-md:hidden"><tr><th className={th} scope="col">Είδος</th><th className={th} scope="col">Παρτίδα / λήξη</th><th className={`${th} text-right`} scope="col">Αναμενόμενο</th><th className={`${th} text-right`} scope="col">Μετρήθηκε</th><th className={`${th} text-right`} scope="col">Πετάχτηκε</th><th className={`${th} text-right`} scope="col">Αποτέλεσμα</th><th className={th} scope="col">Σε σχέση με πωλήσεις</th><th className={`${th} text-right`} scope="col">Αξία διαφοράς</th><th className={th} scope="col">Αιτιολογία</th></tr></thead>
              <tbody className="max-md:block">
                {count.lines.map((line) => {
                  const unit = stockDisplayUnit(line.genericItem.baseUnit);
                  const dim = line.genericItem.baseUnit.dimension;
                  const isCount = line.genericItem.consumptionSource === "COUNT";
                  const item = reviewById.get(line.genericItemId);
                  const preview = isCount && line.actualQty !== null ? (line.consumptionQty ?? line.expectedQty - line.actualQty - line.wasteQty) : null;
                  return (
                    <tr key={line.id} className="max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-3 max-md:border-t max-md:border-border/70 max-md:px-5 max-md:py-4">
                      <td className={`${td} font-semibold max-md:col-span-2`}>
                        {canEdit ? <><input form="count-measurements" type="hidden" name="lineIds" value={line.id} /><input form="count-measurements" type="hidden" name={`scale_${line.id}`} value={unit.toBase} /></> : null}
                        <span className="flex flex-wrap items-center gap-2">{line.genericItem.name}{isCount ? <Badge>Από την απογραφή</Badge> : null}</span>
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">Μετριέται σε {unit.code}</span>
                      </td>
                      <td className={`${td} max-md:col-span-2 max-md:text-xs`}><span className={cellLabel}>Παρτίδα</span>{line.lot ? <><span className="font-medium">{line.lot.batchNumber ?? "Χωρίς αριθμό"}</span><span className="mt-1 block whitespace-nowrap text-xs text-muted-foreground">{line.lot.expiresAt ? `Λήξη: ${day.format(line.lot.expiresAt)}` : "Χωρίς λήξη"}</span></> : "Χωρίς παρτίδα"}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums md:text-right`}><span className={cellLabel}>Αναμενόμενο</span>{formatStockQuantity(line.expectedQty, dim)}{line.inflowQty > 0 ? <span className="mt-1 block text-xs text-muted-foreground">ήρθαν {formatStockQuantity(line.inflowQty, dim)}</span> : null}</td>
                      <td className={`${td} md:text-right`}>
                        <span className={cellLabel}>Μετρήθηκε ({unit.code})</span>
                        {canEdit ? <input form="count-measurements" aria-label={`Μετρήθηκε σε ${unit.code}: ${line.genericItem.name}`} name={`actual_${line.id}`} type="text" inputMode="decimal" autoComplete="off" defaultValue={baseToCountInput(line.actualQty, unit.toBase)} placeholder={unit.code} className={`${field} text-right tabular-nums md:ml-auto md:w-28`} /> : <span className="whitespace-nowrap tabular-nums">{line.actualQty === null ? "—" : formatStockQuantity(line.actualQty, dim)}</span>}
                      </td>
                      <td className={`${td} md:text-right`}>
                        <span className={cellLabel}>Πετάχτηκε ({unit.code})</span>
                        {canEdit ? <input form="count-measurements" aria-label={`Πετάχτηκε σε ${unit.code}: ${line.genericItem.name}`} name={`waste_${line.id}`} type="text" inputMode="decimal" autoComplete="off" defaultValue={line.wasteQty ? baseToCountInput(line.wasteQty, unit.toBase) : ""} placeholder="0" className={`${field} text-right tabular-nums md:ml-auto md:w-24`} /> : <span className="whitespace-nowrap tabular-nums">{line.wasteQty ? formatStockQuantity(line.wasteQty, dim) : "—"}</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap tabular-nums md:text-right`}>
                        <span className={cellLabel}>{isCount ? "Κατανάλωση" : "Διαφορά"}</span>
                        {isCount
                          ? (preview === null ? <span className="text-muted-foreground">—</span> : <><strong>{formatStockQuantity(Math.abs(preview), dim)}</strong>{preview < 0 ? <span className="mt-1 block text-xs text-destructive">περισσότερο από το αναμενόμενο</span> : <span className="mt-1 block text-xs text-muted-foreground max-md:hidden">κατανάλωση</span>}</>)
                          : <span className={`font-medium ${line.differenceQty ? line.differenceQty > 0 ? "text-success" : "text-destructive" : ""}`}>{line.differenceQty === null ? "—" : formatStockQuantity(line.differenceQty, dim)}</span>}
                      </td>
                      <td className={td}><span className={cellLabel}>Σε σχέση με πωλήσεις</span>{item && firstLineOf.has(line.id) ? <Badge tone={REVIEW[item.status].tone}>{REVIEW[item.status].text(item)}</Badge> : <span className="text-muted-foreground">{isCount ? "" : "—"}</span>}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums md:text-right`}><span className={cellLabel}>Αξία διαφοράς</span>{line.unitCostHundredths > 0 && line.differenceQty !== null && !isCount ? formatStockValue(stockValueHundredths(line.differenceQty, line.unitCostHundredths, dim)) : "—"}{line.unitCostHundredths > 0 ? <span className="mt-1 block text-xs text-muted-foreground">{formatStockValue(stockUnitCostHundredths(line.unitCostHundredths, unit.toBase, dim))} / {unit.code}</span> : null}</td>
                      <td className={`${td} max-md:col-span-2`}>
                        <span className={cellLabel}>Αιτιολογία</span>
                        {canEdit ? <textarea form="count-measurements" aria-label={`Αιτιολογία: ${line.genericItem.name}`} name={`reason_${line.id}`} rows={2} maxLength={200} defaultValue={line.reason ?? ""} placeholder={isCount ? "Προαιρετική· γράψε τη αν η απόκλιση θέλει έλεγχο" : "Υποχρεωτική μόνο αν υπάρχει διαφορά"} className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 md:w-60" /> : line.reason ?? "—"}
                        {line.movement ? <span className="mt-1 block text-xs text-muted-foreground">Καταγράφηκε διόρθωση αποθέματος</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!count.lines.length ? <p className="px-5 py-6 text-sm text-muted-foreground">Το snapshot δεν είχε μη μηδενικό απόθεμα. Πρόσθεσε ρητά είδος ή φυσική παρτίδα που βρέθηκε στη μέτρηση.</p> : null}
          {canEdit && count.lines.length ? <div className="flex justify-end border-t border-border/70 px-5 py-4"><Submit form="count-measurements" className={btn("default")} pendingText="Αποθήκευση…"><Save /> Αποθήκευση μετρήσεων</Submit></div> : null}
        </Card>

        {canEdit ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <div className="border-b border-border/70 px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-semibold"><Plus className="size-5" /> Είδος ή υπάρχουσα παρτίδα</h2><p className="mt-1 text-sm text-muted-foreground">Για ποσότητα που δεν υπήρχε στο αρχικό snapshot. Η γραμμή ξεκινά με αναμενόμενο μηδέν.</p></div>
              {existingOptions.length ? <form action={addCountLine.bind(null, count.id)} className="grid gap-4 px-5 py-5">
                <label className="space-y-1 text-sm font-medium">Είδος και παρτίδα
                  <select name="stockKey" required defaultValue="" className={field}><option value="" disabled>Επίλεξε γραμμή</option>{existingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                </label>
                <Submit className={`${btn("outline")} justify-self-end`} pendingText="Προσθήκη…">Προσθήκη γραμμής</Submit>
              </form> : <p className="px-5 py-5 text-sm text-muted-foreground">Όλα τα διαθέσιμα είδη και οι παρτίδες της αποθήκης υπάρχουν ήδη στην απογραφή.</p>}
            </Card>

            <Card>
              <div className="border-b border-border/70 px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-semibold"><Layers3 className="size-5" /> Νέα φυσική παρτίδα</h2><p className="mt-1 text-sm text-muted-foreground">Καταχώρισε τον πραγματικό αριθμό και τη λήξη που αναγράφονται στη συσκευασία· δεν παράγεται αυτόματο batch.</p></div>
              {generics.length ? <form action={addCountLot.bind(null, count.id)} className="grid gap-4 px-5 py-5 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium sm:col-span-2">Είδος
                  <select name="genericItemId" required defaultValue="" className={field}><option value="" disabled>Επίλεξε είδος</option>{generics.map((generic) => <option key={generic.id} value={generic.id}>{generic.name}</option>)}</select>
                </label>
                <label className="space-y-1 text-sm font-medium">Πραγματικός αριθμός παρτίδας<input name="batchNumber" required minLength={1} maxLength={80} className={field} /></label>
                <label className="space-y-1 text-sm font-medium">Λήξη (προαιρετική)<input name="expiresAt" type="date" className={field} /></label>
                <div className="sm:col-span-2 sm:justify-self-end"><Submit className={btn("outline")} pendingText="Προσθήκη…">Δημιουργία παρτίδας & γραμμής</Submit></div>
              </form> : <p className="px-5 py-5 text-sm text-muted-foreground">Δεν υπάρχει ενεργό είδος με παρακολούθηση αποθέματος.</p>}
            </Card>
          </div>
        ) : null}

        {draft ? <Card className="px-5 py-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">Οριστικοποίηση</h2><p className="mt-1 text-sm text-muted-foreground">Χρειάζεται μέτρηση σε κάθε γραμμή. Αιτιολογία (3–200 χαρακτήρες) μόνο στις διαφορές ειδών που φεύγουν με την πώληση· στα είδη της βιτρίνας η διαφορά είναι κατανάλωση. Επιτρέπεται μία οριστική απογραφή ανά αποθήκη και ημερομηνία.</p></div>
            {canFinalize && count.lines.length ? <form id="count-finalize" action={finalizeCount.bind(null, count.id)}>{count.store ? <OnlineOnlyFinalize formId="count-finalize" className={btn("default")} identity={{ orgId: ctx.orgId, userId: ctx.userId }} countId={count.id}><CheckCircle2 /> Οριστικοποίηση απογραφής</OnlineOnlyFinalize> : <Submit className={btn("default")} pendingText="Οριστικοποίηση…"><CheckCircle2 /> Οριστικοποίηση απογραφής</Submit>}</form> : null}
          </div>
          {!ctx.can("counts.finalize") ? <p className="mt-3 text-sm text-muted-foreground">Δεν έχεις δικαίωμα οριστικοποίησης.</p> : null}
        </Card> : null}
      </div>
    </Page>
  );
}
