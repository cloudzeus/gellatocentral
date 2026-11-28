import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarClock, Check, Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Info, Plus, ShoppingCart, Snowflake, Sun, Truck } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Page, Select } from "@/components/ui";
import { businessDay, isoDay } from "@/lib/consumption-rules";
import { db } from "@/lib/db";
import { mrpV2Suggestions, productionSuggestions, storeDemandWeek, type ProductionSuggestionRow } from "@/lib/planning/planning-db";
import { addDays, containersLabel, WEEKDAY_GENITIVE, weekdayUtc, type Suggestion, type SuggestPart } from "@/lib/planning/production-suggest";
import { weatherKind } from "@/lib/planning/weather-forecast";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { formatStockQuantity } from "@/lib/stock-view";
import { schedulePlans } from "./actions";

const WEEKDAY = ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"];
const WEEKDAY_SHORT = ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"];
const dayLabel = (day: string) => `${WEEKDAY[weekdayUtc(day)]} ${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;
/** «την Τρίτη», αλλά «το Σάββατο» */
const article = (day: string) => (weekdayUtc(day) === 6 ? "το" : "την");
const WEATHER_ICON = { sun: Sun, partly: CloudSun, cloud: Cloud, fog: CloudFog, rain: CloudRain, snow: Snowflake, storm: CloudLightning, unknown: Cloud } as const;
const PART_LABEL: Record<Exclude<SuggestPart["key"], "avg">, string> = { stock: "απόθεμα", min: "ελάχιστο βιτρίνας", wholesale: "χονδρική", lab: "εργαστήριο", planned: "ήδη στο πρόγραμμα" };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Μίγμα σε γραμμάρια για το πλάνο· τα τεμάχια δεν προγραμματίζονται από εδώ (δεν ξέρουμε βάρος τεμαχίου). */
const mixGrams = (s: Suggestion, dimension: string) => (dimension === "mass" ? Math.round(s.mix / 1000) : dimension === "volume" ? s.mix : 0);

// Παραγωγή › Σχεδιασμός: τι να φτιάξει το εργαστήριο για τη βιτρίνα (αύριο ή 7 ημέρες, με ή χωρίς καιρό),
// τι πρώτες ύλες θα χρειαστούν, και πόσο αξιόπιστη είναι η πρόβλεψη.
export default async function PlanningPage({ searchParams }: PageProps<"/production/planning">) {
  const ctx = await requireStockContext("production.read");
  const q = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (!warehouses.length) notFound();
  const ids = warehouses.map((w) => w.id);
  const today = isoDay(businessDay(new Date()));
  // Προεπιλογές από τα δεδομένα (και το εργαστήριο συνδέεται με κατάστημα): βιτρίνα = ο χώρος με το περισσότερο
  // ιστορικό ζήτησης, εργαστήριο = ο χώρος που χρησιμοποιούν τα πλάνα παραγωγής.
  const [demandBy, planBy] = await Promise.all([
    db.demandDaily.groupBy({ by: ["warehouseId"], where: { orgId: ctx.orgId, warehouseId: { in: ids }, day: { gte: new Date(`${addDays(today, -60)}T00:00:00.000Z`) } }, _count: { _all: true } }),
    db.productionPlan.groupBy({ by: ["sourceWarehouseId"], where: { orgId: ctx.orgId, sourceWarehouseId: { in: ids } }, _count: { _all: true } }),
  ]);
  const busiestShop = demandBy.sort((a, b) => b._count._all - a._count._all)[0]?.warehouseId;
  const busiestLab = planBy.sort((a, b) => b._count._all - a._count._all).find((p) => p.sourceWarehouseId !== busiestShop)?.sourceWarehouseId;
  const shopId = one(q.shop) ?? busiestShop ?? warehouses[0]!.id;
  const labId = one(q.lab) ?? busiestLab ?? warehouses.find((w) => w.id !== shopId)?.id ?? shopId;
  if (![shopId, labId].every((id) => warehouses.some((w) => w.id === id))) notFound();
  const view = one(q.view) === "week" ? "week" : "day";
  const tomorrow = addDays(today, 1);
  const fmt = (base: number, dimension: string) => formatStockQuantity(base, dimension);

  const [week, firstDay, materials] = await Promise.all([
    storeDemandWeek(db, ctx, { warehouseId: shopId, today: tomorrow }),
    productionSuggestions(db, ctx, { shopWarehouseId: shopId, labWarehouseId: labId, day: tomorrow }),
    mrpV2Suggestions(db, ctx, { warehouseId: labId, today, horizonDays: 7 }),
  ]);
  const useWeather = week.hasWeather && one(q.weather) !== "0";
  // 7 ημέρες: κάθε ημέρα παραγωγής καλύπτει έως την επόμενη· μετά την πρώτη θεωρούμε ότι η προηγούμενη έγινε.
  const days: { day: string; rows: ProductionSuggestionRow[] }[] = [{ day: tomorrow, rows: firstDay }];
  if (view === "week") {
    let next = firstDay[0]?.coverage.length ? addDays(firstDay[0].coverage.at(-1)!, 1) : addDays(tomorrow, 1);
    while (next < addDays(tomorrow, 7) && days.length < 7) {
      const rows = await productionSuggestions(db, ctx, { shopWarehouseId: shopId, labWarehouseId: labId, day: next, assumeRefilled: true });
      days.push({ day: next, rows });
      next = rows[0]?.coverage.length ? addDays(rows[0].coverage.at(-1)!, 1) : addDays(next, 1);
    }
  }
  const pick = (row: ProductionSuggestionRow) => (useWeather && row.withWeather ? row.withWeather.suggestion : row.suggestion);
  const toOrder = materials.filter((m) => m.suggestedBaseQty > 0).slice(0, 8);

  const link = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams({ shop: shopId, lab: labId, view, ...(week.hasWeather && !useWeather ? { weather: "0" } : {}) });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    return `/production/planning?${params}`;
  };
  const here = link({});
  const scheduleAll = (rows: readonly ProductionSuggestionRow[], day: string) => rows.flatMap((r) => { const s = pick(r); const g = mixGrams(s, r.dimension); return s.output > 0 && g > 0 ? [`${r.recipeId}|${g}|${day}`] : []; });
  const containersOf = (rows: readonly ProductionSuggestionRow[]) => rows.reduce((n, r) => n + (pick(r).containers ?? 0), 0);

  const coverText = (rows: readonly ProductionSuggestionRow[], day: string) => {
    const cov = rows[0]?.coverage ?? [day];
    if (cov.length <= 1) return `Καλύπτει ${article(day)} ${WEEKDAY[weekdayUtc(day)]}`;
    return `Καλύπτει ${cov.map((d) => WEEKDAY[weekdayUtc(d)]).join(", ")} · επόμενη παραγωγή ${WEEKDAY[weekdayUtc(addDays(cov.at(-1)!, 1))]}`;
  };

  const suggestionRow = (row: ProductionSuggestionRow, day: string, compact: boolean) => {
    const s = pick(row);
    const grams = mixGrams(s, row.dimension);
    const avg = s.parts.find((p) => p.key === "avg");
    return (
      <li key={row.genericItemId} className="grid gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <p className="font-semibold">{row.name}</p>
          {s.output > 0
            ? <p className="text-base font-semibold text-primary tabular-nums">{s.containers ? containersLabel(s.containers, s.containerName) : fmt(s.output, row.dimension)} · μίγμα {fmt(s.mix, row.dimension)}</p>
            : <p className="text-base font-semibold text-success-ink">Δεν χρειάζεται</p>}
        </div>
        {s.output > 0 && grams > 0 && ctx.can("production.add")
          ? <form action={schedulePlans.bind(null, labId, here)}><input type="hidden" name="plan" value={`${row.recipeId}|${grams}|${day}`} /><Submit pendingText="Προσθήκη…" className={btn("outline", "sm", "w-full sm:w-auto")}><Plus /> Στο πρόγραμμα</Submit></form>
          : s.output > 0 ? null : <Badge tone="success" icon={Check}>Αρκεί το απόθεμα</Badge>}
        {!compact || s.output > 0 ? (
          <div className="sm:col-span-2">
            <p className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
              {s.parts.map((p, i) => (
                <span key={i} className="contents">
                  {i > 0 ? <span className="text-muted-foreground">{p.sign < 0 ? "−" : "+"}</span> : null}
                  <span className={`rounded-md px-2 py-0.5 ${p.sign < 0 ? "bg-success/12 text-success-ink" : "bg-secondary"}`}>{p.key === "avg" ? `μ.ο. ${p.day ? WEEKDAY_GENITIVE[weekdayUtc(p.day)] : ""}` : PART_LABEL[p.key]} {fmt(p.qty, row.dimension)}</span>
                </span>
              ))}
              <span className="text-muted-foreground">=</span><strong className="text-primary">{s.need > 0 ? fmt(s.need, row.dimension) : "0"}</strong>
            </p>
            {s.output > 0 ? <p className="mt-1 text-xs text-muted-foreground">{s.containers ? `Στρογγυλεύει σε ${s.containers} × ${fmt(s.output / s.containers, row.dimension)}. ` : ""}{s.lossPct > 0 ? `Μίγμα με φύρα ${s.lossPct.toLocaleString("el-GR")}%` : ""}{useWeather && row.withWeather ? ` · χωρίς καιρό: ${fmt(row.suggestion.output, row.dimension)}` : ""}</p> : null}
            {s.stockouts > 0 && avg?.demand ? (
              <p className="mt-2 flex gap-2 rounded-lg bg-warning/15 px-3 py-2 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-ink" aria-hidden />{s.lowerBound ? "Τελείωνε σε όλες τις ίδιες ημέρες: η πραγματική ζήτηση είναι άγνωστη και σίγουρα μεγαλύτερη" : `Τελείωσε σε ${s.stockouts} από τις ${avg.demand.samples} τελευταίες ίδιες ημέρες. Η πραγματική ζήτηση μάλλον είναι μεγαλύτερη`}</p>
            ) : null}
            {useWeather && row.withWeather?.lowData ? <p className="mt-1 text-xs text-muted-foreground">Λίγο ιστορικό: ο καιρός μετρά με τις αρχικές τιμές</p> : null}
          </div>
        ) : null}
      </li>
    );
  };

  // Γράφημα εβδομάδας (kg): στήλες = συνήθως, γραμμή = με τον καιρό.
  const W = 700, H = 144, base = 144, top = 14;
  const maxKg = Math.max(1, ...week.days.map((d) => Math.max(d.withWeather, d.withoutWeather) / 1_000_000));
  const niceMax = Math.ceil(maxKg / 5) * 5 || 5;
  const y = (qty: number) => base - (qty / 1_000_000 / niceMax) * (base - top);
  const colX = (i: number) => (i + 0.5) * 100;
  const firstFactor = week.days[0]?.factorPct ?? 0;
  const acc = week.accuracy;
  const mape = acc.mape === null ? null : Math.round(acc.mape);
  const mapeTone = mape === null ? "neutral" : mape < 15 ? "success" : mape < 25 ? "warning" : "danger";

  return (
    <Page section="Παραγωγή" title={view === "day" ? `Τι να φτιάξουμε ${article(tomorrow)} ${dayLabel(tomorrow)}` : "Τι να φτιάξουμε τις επόμενες 7 ημέρες"}
      description={`${warehouses.find((w) => w.id === labId)?.name ?? ""} → ${warehouses.find((w) => w.id === shopId)?.name ?? ""}. ${coverText(firstDay, tomorrow)}`}
      actions={<Link href="/production/plans" className={btn("outline", "sm")}><CalendarClock /> Πρόγραμμα παραγωγής</Link>}>
      <div className="grid max-w-[90rem] gap-4">
        <div className="flex flex-wrap items-end gap-3">
          {warehouses.length > 1 ? (
            <form className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
              <input type="hidden" name="view" value={view} />
              {week.hasWeather && !useWeather ? <input type="hidden" name="weather" value="0" /> : null}
              <div className="w-full sm:w-56"><Select label="Βιτρίνα" name="shop" defaultValue={shopId} options={warehouses.map((w): [string, string] => [w.id, w.name])} /></div>
              <div className="w-full sm:w-56"><Select label="Εργαστήριο" name="lab" defaultValue={labId} options={warehouses.map((w): [string, string] => [w.id, w.name])} /></div>
              <button type="submit" className={btn("outline")}>Προβολή</button>
            </form>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <div className="inline-flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Περίοδος">
              {(["day", "week"] as const).map((v) => <Link key={v} href={link({ view: v })} aria-current={view === v ? "page" : undefined} className={`inline-flex min-h-9 items-center px-3.5 text-sm pointer-coarse:min-h-11 ${view === v ? "bg-primary font-semibold text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary"}`}>{v === "day" ? "Αύριο" : "7 ημέρες"}</Link>)}
            </div>
            {week.hasWeather
              ? <Link href={link({ weather: useWeather ? "0" : null })} role="switch" aria-checked={useWeather} className="inline-flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11"><span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${useWeather ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${useWeather ? "left-[1.125rem]" : "left-0.5"}`} /></span>Με τον καιρό</Link>
              : <span className="text-xs text-muted-foreground">Χωρίς καιρό: λείπουν συντεταγμένες καταστήματος</span>}
          </div>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="grid gap-4">
            {days.map(({ day, rows }, index) => {
              const all = scheduleAll(rows, day);
              const containers = containersOf(rows);
              return (
                <Card key={day} className="p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div><h2 className="text-sm font-semibold">{view === "day" ? "Πρόταση ανά γεύση" : dayLabel(day)}</h2>{view === "week" ? <p className="text-xs text-muted-foreground">{coverText(rows, day)}{index > 0 ? " · εκτίμηση: θεωρεί ότι η προηγούμενη παραγωγή έγινε όπως προτάθηκε" : ""}</p> : null}</div>
                    {all.length > 1 && ctx.can("production.add") ? <form action={schedulePlans.bind(null, labId, here)} className="max-sm:w-full">{all.map((v) => <input key={v} type="hidden" name="plan" value={v} />)}<Submit pendingText="Προσθήκη…" className={btn("default", "default", "max-sm:w-full")}><Plus /> Όλα στο πρόγραμμα{containers ? ` · ${containersLabel(containers, null)}` : ""}</Submit></form> : null}
                  </div>
                  {rows.length
                    ? <ul className="divide-y divide-border/70">{rows.map((row) => suggestionRow(row, day, view === "week"))}</ul>
                    : <p className="rounded-lg bg-secondary px-4 py-3 text-muted-foreground">Δεν υπάρχει πρόταση: χρειάζονται συνταγές με παραγόμενο είδος και ιστορικό απογραφών ή πωλήσεων της βιτρίνας</p>}
                </Card>
              );
            })}

            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-sm font-semibold">Πρώτες ύλες για τις επόμενες 7 ημέρες</h2><p className="text-xs text-muted-foreground">Από το πρόγραμμα παραγωγής, την επιβεβαιωμένη χονδρική και τη συνηθισμένη χρήση</p></div>
                <Link href="/orders/mrp" className={btn("outline", "sm")}><ShoppingCart /> Φτιάξε παραγγελίες</Link>
              </div>
              {toOrder.length ? (
                <ul className="divide-y divide-border/70">
                  {toOrder.map((m) => (
                    <li key={m.genericItemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      <span className="min-w-0 flex-1 font-medium">{m.name}<span className="block text-xs font-normal text-muted-foreground tabular-nums">χρειάζεται {fmt(m.targetBaseQty, m.dimension)}{m.firmBaseQty > 0 ? ` · βέβαιη ${fmt(m.firmBaseQty, m.dimension)}` : ""}</span></span>
                      {m.shortageBaseQty > 0 ? <Badge tone="danger" icon={AlertTriangle}>Παράγγειλε σήμερα</Badge> : null}
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Truck className="size-3.5" aria-hidden />{m.leadDays === 1 ? "έρχεται σε 1 ημέρα" : `έρχεται σε ${m.leadDays} ημέρες`}{m.leadSource === "history" ? " (από τις παραλαβές)" : ""}</span>
                      <strong className="w-20 text-right tabular-nums">{fmt(m.suggestedBaseQty, m.dimension)}</strong>
                    </li>
                  ))}
                </ul>
              ) : <p className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-success-ink"><Check className="size-4" aria-hidden />Αρκούν τα αποθέματα του εργαστηρίου</p>}
              <p className="mt-3 text-xs text-muted-foreground">Ο χρόνος παράδοσης μαθαίνεται από τις παραλαβές (3+ παραγγελίες ανά προμηθευτή). Αλλιώς ισχύει αυτός των ρυθμίσεων παραγγελίας</p>
            </Card>
          </div>

          <div className="grid gap-4">
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Ζήτηση βιτρίνας, επόμενες 7 ημέρες</h2>
              {week.days.length ? (
                <>
                  {week.hasWeather ? (
                    <div className="mt-2 grid grid-cols-7 gap-1 text-center" aria-label="Καιρός MET Norway">
                      {week.days.map((d, i) => {
                        const Icon = WEATHER_ICON[weatherKind(d.weather?.code, d.weather?.precip)];
                        const covered = (firstDay[0]?.coverage ?? [tomorrow]).includes(d.day);
                        return <div key={d.day} className={`rounded-md py-1.5 ${covered && view === "day" ? "bg-secondary" : ""}`}><p className="text-[length:var(--text-2xs)] text-muted-foreground">{WEEKDAY_SHORT[weekdayUtc(d.day)]}</p><Icon className="mx-auto my-0.5 size-4 text-muted-foreground" aria-hidden /><p className="text-xs font-semibold tabular-nums">{d.weather?.tmax == null ? "—" : `${Math.round(d.weather.tmax)}°`}</p><span className="sr-only">{i}</span></div>;
                      })}
                    </div>
                  ) : null}
                  {/* SVG μόνο για τις μορφές· οι ετικέτες σε HTML ώστε να μένουν ευανάγνωστες σε κάθε πλάτος */}
                  <div className="relative mt-3">
                    <p className="absolute left-0 top-0 text-[length:var(--text-2xs)] text-muted-foreground tabular-nums">{niceMax.toLocaleString("el-GR")} kg</p>
                    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label={week.days.map((d) => `${WEEKDAY[weekdayUtc(d.day)]}: συνήθως ${fmt(d.withoutWeather, "mass")}${useWeather ? `, με καιρό ${fmt(d.withWeather, "mass")}` : ""}`).join("· ")}>
                      <g className="stroke-border" vectorEffect="non-scaling-stroke">{[0, 0.5, 1].map((t) => <line key={t} x1="0" x2={W} y1={y(t * niceMax * 1_000_000)} y2={y(t * niceMax * 1_000_000)} vectorEffect="non-scaling-stroke" />)}</g>
                      {week.days.map((d, i) => <rect key={d.day} x={colX(i) - 28} y={y(d.withoutWeather)} width="56" height={Math.max(0, base - y(d.withoutWeather))} rx="4" className="fill-primary/20" />)}
                      {useWeather ? <polyline fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={week.days.map((d, i) => `${colX(i)},${y(d.withWeather)}`).join(" ")} /> : null}
                    </svg>
                    <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">{week.days.map((d) => <span key={d.day}>{WEEKDAY_SHORT[weekdayUtc(d.day)]}</span>)}</div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-primary/20" />Συνήθως αυτή την ημέρα</span>
                    {useWeather ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full bg-primary" />Με τον καιρό</span> : null}
                  </div>
                  {useWeather && firstFactor !== 0 ? <p className="mt-2 text-xs">{WEEKDAY[weekdayUtc(tomorrow)]}: ο καιρός δίνει <strong>{firstFactor > 0 ? "+" : "−"}{Math.abs(firstFactor)}%</strong> από τα συνηθισμένα</p> : null}
                  {week.lowData ? <p className="mt-1 text-xs text-muted-foreground">Λίγο ιστορικό ακόμα: η πρόβλεψη θα βελτιωθεί με τις επόμενες απογραφές</p> : null}
                </>
              ) : <p className="mt-2 text-muted-foreground">Δεν υπάρχει ακόμα ιστορικό απογραφών ή πωλήσεων για τη βιτρίνα</p>}
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold">Πόσο πέφτει μέσα η πρόβλεψη</h2>
              {mape !== null && acc.days >= 7 ? (
                <>
                  <div className="mt-2 flex items-baseline gap-2"><p className="text-3xl font-semibold tabular-nums text-primary">{mape}%</p><Badge tone={mapeTone} icon={mapeTone === "success" ? Check : AlertTriangle}>{mapeTone === "success" ? "Καλή" : mapeTone === "warning" ? "Μέτρια" : "Αδύναμη"}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">Μέση απόκλιση σε {acc.days} ημέρες των τελευταίων 4 εβδομάδων. Κάτω από 15% είναι καλή, πάνω από 25% μην τη στηρίζεις</p>
                  <div className="relative mt-3 h-2 rounded-full" style={{ background: "linear-gradient(90deg, var(--success) 0 37.5%, var(--warning) 37.5% 62.5%, var(--destructive) 62.5%)" }}>
                    <span aria-hidden className="absolute -top-1 h-4 w-[3px] rounded bg-primary" style={{ left: `calc(${Math.min(100, (mape / 40) * 100)}% - 1px)` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-[length:var(--text-2xs)] text-muted-foreground tabular-nums"><span>0%</span><span>15%</span><span>25%</span><span>40%</span></div>
                  {acc.mapeBaseline !== null ? <p className="mt-3 text-xs text-muted-foreground">Με τον απλό μέσο όρο ημέρας η απόκλιση θα ήταν {Math.round(acc.mapeBaseline)}%</p> : null}
                </>
              ) : <p className="mt-2 text-muted-foreground">Χρειάζονται τουλάχιστον 7 ημέρες με απογραφή για να μετρηθεί</p>}
            </Card>

            <p className="flex gap-2.5 rounded-lg bg-secondary px-4 py-3 text-xs"><Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />Ο καιρός έρχεται από το MET Norway. Η ζήτηση έρχεται από τις απογραφές και τις πωλήσεις των 8 τελευταίων εβδομάδων. Τα πεταμένα και η χονδρική δεν μετράνε ως ζήτηση</p>
          </div>
        </div>
      </div>
    </Page>
  );
}
