import { ArrowDown, ArrowRight, ArrowUp, Banknote, BarChart3, ChevronDown, CircleCheck, Clock, CreditCard, Plus, ReceiptText, Store, TabletSmartphone, ThermometerSnowflake, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RankChart, ShareChart, type TrendPoint, TrendChart } from "@/components/charts";
import { Progress } from "@/components/shadcn/progress";
import { Badge, btn, Card, cn, Page } from "@/components/ui";
import { WidgetBoard } from "@/components/widget-board";
import { currentOrg } from "@/lib/auth";
import { compare, targetPace } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { DEVICE_KIND, readingStatus } from "@/lib/devices";
import { euro } from "@/lib/money";
import type { Permission } from "@/lib/permissions";

type Hour = { h: number; total: number };
type Meta = { now_hour: number; today: string; y_same: number; y_total: number; y_count: number };
type Day = { d: string; total: number };
const PERIODS = { today: "Σήμερα", "7": "7 ημέρες", "30": "30 ημέρες" } as const;
const PERIOD_ORDER = ["today", "7", "30"] as const; // τα αριθμητικά κλειδιά ενός αντικειμένου βγαίνουν πρώτα
const shortDay = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "numeric", timeZone: "UTC" });
/** Ημερομηνία `iso` (YYYY-MM-DD) μετατοπισμένη κατά `by` ημέρες. */
const shift = (iso: string, by: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + by * 864e5).toISOString().slice(0, 10);
type Top = { name: string; qty: number; total: number };

const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 864e5);
const time = new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Athens" });
const day = new Intl.DateTimeFormat("el-GR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Athens" });
// με την ημέρα μπροστά ο μήνας βγαίνει στη γενική («Νοεμβρίου»)
const dayMonth = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long", timeZone: "Europe/Athens" });
// «Σήμερα» = ημέρα Αθήνας (το issuedAt αποθηκεύεται σε UTC)
const LOCAL = `("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Athens')`;
const NOW = `(now() AT TIME ZONE 'Europe/Athens')`;
const SCOPE = `"orgId" = $1 AND ($2::text[] IS NULL OR "storeId" = ANY($2)) AND status = 'COMPLETED'`;

const Head = ({ title, note, href, all }: { title: string; note?: ReactNode; href?: string; all?: string }) => (
  <div className="flex items-baseline gap-3 px-5 pt-4 pb-3">
    <h2 className="text-base">{title}</h2>
    {note ? <span className="text-xs text-muted-foreground tabular-nums">{note}</span> : null}
    {/* αρνητικό κάθετο margin: ο στόχος αφής μεγαλώνει χωρίς να ψηλώσει η κεφαλίδα */}
    {href ? <Link href={href} className="-my-2 ml-auto inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-primary hover:underline pointer-coarse:-my-3 pointer-coarse:min-h-11">{all} <ArrowRight className="size-4" /></Link> : null}
  </div>
);
const ROW = "flex min-h-11 items-center gap-3 border-t border-border px-5 py-1.5 pointer-coarse:min-h-12";
const ROW_LINK = cn(ROW, "-outline-offset-2 hover:bg-secondary");

/** Αλλαγή απέναντι σε χθες: πράσινο πάνω, κόκκινο κάτω, πάντα με βέλος. */
const Delta = ({ up, children }: { up: boolean; children: ReactNode }) => (
  <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-px text-xs font-semibold tabular-nums", up ? "bg-success/12 text-success-ink" : "bg-destructive/10 text-destructive")}>
    {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{children}
  </span>
);

type Issue = { tone: "danger" | "warning"; text: string; detail?: string; href: string; action: string };
const ISSUE = {
  danger: { icon: TriangleAlert, tile: "bg-destructive/10 text-destructive", label: "Επείγον: ", group: "Κάνε το τώρα", head: "text-destructive" },
  warning: { icon: Clock, tile: "bg-warning/20 text-warning-ink", label: "Προσοχή: ", group: "Μέσα στη μέρα", head: "text-warning-ink" },
};
const GROUP_HEAD = "px-5 pt-2 pb-1 text-xs font-semibold";
function IssueRows({ items }: { items: Issue[] }) {
  return (
    <ul>
      {items.map((i) => {
        const { icon: Icon, tile, label } = ISSUE[i.tone];
        return (
          <li key={i.text}>
            <Link href={i.href} className={cn(ROW_LINK, "pointer-coarse:min-h-14")}>
              <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-md", tile)}><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block font-medium"><span className="sr-only">{label}</span>{i.text}</span>{i.detail ? <span className="block text-xs text-muted-foreground">{i.detail}</span> : null}</span>
              <span className="flex shrink-0 items-center gap-1 font-semibold text-primary"><span className="max-sm:sr-only">{i.action}</span> <ArrowRight className="size-4" /></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const { org, permissions, storeIds, warehouseIds } = await currentOrg("dashboard.read");
  const warehouseOnly = warehouseIds.length > 0 && storeIds.length === 0;
  const stores = warehouseOnly ? [] : await db.store.findMany({ where: { orgId: org.id, active: true, ...(storeIds.length ? { id: { in: [...storeIds] } } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const sp = await searchParams;
  const wanted = sp.store;
  const period = (typeof sp.period === "string" && sp.period in PERIODS ? sp.period : "today") as keyof typeof PERIODS;
  const span = period === "today" ? 0 : Number(period);
  const store = typeof wanted === "string" ? stores.find((s) => s.id === wanted) ?? null : null;
  if (wanted !== undefined && !store) notFound();
  // null = όλα· [] = κανένα store-only δεδομένο σε warehouse-only membership.
  const scopedStoreIds: string[] | null = store ? [store.id] : storeIds.length ? [...storeIds] : warehouseOnly ? [] : null;
  const args = [org.id, scopedStoreIds] as const;
  const inStore = scopedStoreIds === null ? {} : { storeId: { in: scopedStoreIds } };

  const byHour = (dayOffset: number) =>
    db.$queryRawUnsafe<Hour[]>(`SELECT extract(hour FROM ${LOCAL})::int AS h, sum("totalCents")::int AS total FROM "Sale" WHERE ${SCOPE} AND ${LOCAL}::date = ${NOW}::date - ${dayOffset} GROUP BY 1 ORDER BY 1`, ...args);
  const [hours, yHours, [meta], paid, top, last, unsent, devices, subscription, days, categories] = await Promise.all([
    byHour(0),
    byHour(1),
    db.$queryRawUnsafe<Meta[]>(
      `SELECT extract(hour FROM ${NOW})::int AS now_hour, ${NOW}::date::text AS today,
        coalesce(sum("totalCents") FILTER (WHERE ${LOCAL} <= ${NOW} - interval '1 day'), 0)::int AS y_same,
        coalesce(sum("totalCents"), 0)::int AS y_total, count(*)::int AS y_count
       FROM "Sale" WHERE ${SCOPE} AND ${LOCAL}::date = ${NOW}::date - 1`, ...args),
    db.$queryRawUnsafe<{ method: string; ledger: string; total: number; n: number }[]>(
      `SELECT m.name AS method, m."ledgerKind"::text AS ledger, sum(p."amountCents")::int AS total, count(*)::int AS n FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" JOIN "PaymentMethod" m ON m.id = p."methodId"
       WHERE s."orgId" = $1 AND ($2::text[] IS NULL OR s."storeId" = ANY($2)) AND s.status = 'COMPLETED' AND (s."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Athens')::date = ${NOW}::date GROUP BY 1, 2`, ...args),
    db.$queryRawUnsafe<Top[]>(
      `SELECT l.name, sum(l.quantity)::int AS qty, sum(l.quantity * l."unitPriceCents")::int AS total FROM "SaleLine" l JOIN "Sale" s ON s.id = l."saleId"
       WHERE s."orgId" = $1 AND ($2::text[] IS NULL OR s."storeId" = ANY($2)) AND s.status = 'COMPLETED' AND (s."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Athens')::date = ${NOW}::date
       GROUP BY 1 ORDER BY 3 DESC LIMIT 5`, ...args),
    permissions.includes("receipts.read") ? db.sale.findMany({ where: { orgId: org.id, status: "COMPLETED", ...inStore }, orderBy: { issuedAt: "desc" }, take: 5, include: { payment: { include: { method: true } }, fiscal: true } }) : Promise.resolve([]),
    permissions.includes("receipts.read") ? db.fiscalDocument.count({ where: { sale: { orgId: org.id, status: "COMPLETED", ...inStore }, status: { not: "SIGNED" } } }) : Promise.resolve(0),
    permissions.includes("devices.read") ? db.device.findMany({ where: { store: { orgId: org.id }, active: true, ...inStore }, orderBy: { createdAt: "asc" }, include: { store: true, readings: { orderBy: { at: "desc" }, take: 1 } } }) : Promise.resolve([]),
    permissions.includes("billing.read") ? db.subscription.findUnique({ where: { orgId: org.id } }) : Promise.resolve(null),
    // ημερήσια σύνολα: η περίοδος που ζητήθηκε και η αμέσως προηγούμενη ίδιου μήκους
    span
      ? db.$queryRawUnsafe<Day[]>(`SELECT ${LOCAL}::date::text AS d, sum("totalCents")::int AS total FROM "Sale" WHERE ${SCOPE} AND ${LOCAL}::date > ${NOW}::date - ${span * 2} GROUP BY 1`, ...args)
      : Promise.resolve([] as Day[]),
    db.$queryRawUnsafe<{ id: string; name: string; total: number }[]>(
      `SELECT c.id, c.name, sum(l.quantity * l."unitPriceCents")::int AS total FROM "SaleLine" l JOIN "Sale" s ON s.id = l."saleId" JOIN "Product" p ON p.id = l."productId" JOIN "Category" c ON c.id = p."categoryId"
       WHERE s."orgId" = $1 AND ($2::text[] IS NULL OR s."storeId" = ANY($2)) AND s.status = 'COMPLETED' AND (s."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Athens')::date = ${NOW}::date
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 6`, ...args),
  ]);

  const now = new Date();
  const { stockAlerts } = await import("@/lib/stock-alerts");
  const { athensDayRange } = await import("@/lib/production-day-close");
  const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", year: "numeric" }).format(now));
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", month: "numeric" }).format(now));
  const target = permissions.includes("finance.read") && (store || (!storeIds.length && !warehouseIds.length))
    ? await db.budgetTarget.findFirst({ where: { orgId: org.id, storeId: store?.id ?? null, year, month } })
    : null;
  const [stock, haccpDeviations, dueRoutes, outstandingDocuments] = await Promise.all([
    permissions.includes("stock.read") ? stockAlerts(db, { orgId: org.id, storeIds: store ? [store.id] : storeIds, warehouseIds }, now) : Promise.resolve({ thresholds: [], lowStock: [], expiringLots: [] }),
    permissions.includes("haccp.read") ? db.haccpRecord.count({ where: { orgId: org.id, result: "DEVIATION", status: { not: "COMPLETED" }, ...inStore } }) : Promise.resolve(0),
    permissions.includes("wholesale.read") ? db.deliveryRoute.count({ where: { orgId: org.id, status: "PLANNED", plannedFor: { lt: new Date(now.getTime() + 86400000) }, ...inStore } }) : Promise.resolve(0),
    permissions.includes("invoices.read") ? db.salesDocument.findMany({ where: { orgId: org.id, status: "ISSUED", docType: "1.1", ...inStore }, select: { id: true, totalCents: true, allocations: { select: { amountCents: true } } } }) : Promise.resolve([]),
  ]);
  const monthSales = target ? await db.sale.aggregate({ where: { orgId: org.id, status: "COMPLETED", issuedAt: { gte: athensDayRange(`${year}-${String(month).padStart(2, "0")}-01`).start }, ...inStore }, _sum: { totalCents: true } }) : null;

  const ledgerSum = (l: string) => paid.filter((p) => p.ledger === l).reduce((s, p) => s + p.total, 0);

  const total = hours.reduce((s, h) => s + h.total, 0);
  const count = paid.reduce((s, p) => s + p.n, 0);
  const vs = compare(total, meta.y_same);
  const avg = count ? Math.round(total / count) : 0;
  const yAvg = meta.y_count ? Math.round(meta.y_total / meta.y_count) : 0;
  const best = hours.length ? hours.reduce((a, b) => (b.total > a.total ? b : a)) : null;

  // Σημεία του γραφήματος: ανά ώρα (σήμερα απέναντι σε χθες) ή ανά ημέρα (περίοδος απέναντι στην προηγούμενη)
  let trend: TrendPoint[];
  if (span) {
    const byDay = new Map(days.map((d) => [d.d, d.total]));
    const dates = Array.from({ length: span }, (_, i) => shift(meta.today, i - span + 1));
    const peak = Math.max(0, ...dates.map((d) => byDay.get(d) ?? 0));
    trend = dates.map((d) => ({ label: shortDay.format(new Date(`${d}T00:00:00Z`)), current: byDay.get(d) ?? 0, previous: byDay.get(shift(d, -span)) ?? 0, highlight: peak > 0 && byDay.get(d) === peak, faded: d === meta.today }));
  } else {
    const all = [...hours, ...yHours];
    const from = Math.min(meta.now_hour, ...all.map((x) => x.h)), to = Math.max(meta.now_hour, ...all.map((x) => x.h));
    trend = Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => {
      const t = hours.find((x) => x.h === h)?.total;
      return { label: String(h), current: t ?? (h <= meta.now_hour ? 0 : null), previous: yHours.find((x) => x.h === h)?.total ?? 0, highlight: !!best && h === best.h, faded: h === meta.now_hour };
    });
  }
  const periodTotal = trend.reduce((x, p) => x + (p.current ?? 0), 0), prevTotal = trend.reduce((x, p) => x + (p.previous ?? 0), 0);
  const link = (change: Record<string, string | undefined>) => `/?${new URLSearchParams(Object.entries({ store: store?.id, period: period === "today" ? undefined : period, ...change }).filter((e): e is [string, string] => !!e[1]))}`;

  // Ό,τι χρειάζεται ενέργεια σήμερα, με το πού πατάς για να το λύσεις
  const status = devices.map((d) => ({ d, st: DEVICE_KIND[d.kind].measures ? readingStatus(d, d.readings[0]) : null }));
  const issues: Issue[] = [];
  for (const { d, st } of status) if (st && d.readings[0] && st.tone !== "success" && st.tone !== "neutral") issues.push({ tone: st.tone, text: `${d.name}: ${st.text}`, detail: d.store.name, href: "/devices", action: "Δες το" });
  if (unsent > 0) issues.push({ tone: "danger", text: `${unsent} ${unsent === 1 ? "απόδειξη δεν στάλθηκε" : "αποδείξεις δεν στάλθηκαν"} στην ΑΑΔΕ`, href: "/receipts", action: "Δες ποιες" });
  for (const { d } of status) if (d.kind !== "POS_WEB" && !d.pairedAt) issues.push({ tone: "warning", text: `${d.name}: δεν έχει συνδεθεί ακόμα`, detail: d.store.name, href: "/devices", action: "Σύνδεσέ το" });
  const daysLeft = subscription ? daysUntil(subscription.currentPeriodEnd) : null;
  if (daysLeft !== null && daysLeft <= 7) issues.push({ tone: daysLeft < 0 ? "danger" : "warning", text: daysLeft < 0 ? "Η συνδρομή έληξε" : `Η συνδρομή λήγει σε ${daysLeft} ${daysLeft === 1 ? "ημέρα" : "ημέρες"}`, href: "/billing", action: "Συνδρομή" });
  if (stock.lowStock.length) issues.push({ tone: "warning", text: `${stock.lowStock.length} ${stock.lowStock.length === 1 ? "είδος τελειώνει" : "είδη τελειώνουν"}`, href: "/inventory/alerts", action: "Απόθεμα" });
  if (stock.expiringLots.length) issues.push({ tone: "warning", text: `${stock.expiringLots.length} ${stock.expiringLots.length === 1 ? "παρτίδα λήγει" : "παρτίδες λήγουν"} σύντομα`, href: "/inventory/alerts", action: "Παρτίδες" });
  if (haccpDeviations) issues.push({ tone: "danger", text: `${haccpDeviations} ${haccpDeviations === 1 ? "έλεγχος υγιεινής (HACCP) θέλει διόρθωση" : "έλεγχοι υγιεινής (HACCP) θέλουν διόρθωση"}`, href: "/haccp", action: "Δες τους" });
  if (dueRoutes) issues.push({ tone: "warning", text: `${dueRoutes} ${dueRoutes === 1 ? "δρομολόγιο πρέπει" : "δρομολόγια πρέπει"} να παραδοθεί`, href: "/wholesale-orders", action: "Παραδόσεις" });
  const outstanding = outstandingDocuments.filter((d) => d.totalCents > d.allocations.reduce((sum, a) => sum + a.amountCents, 0)).length;
  if (outstanding) issues.push({ tone: "warning", text: `${outstanding} ${outstanding === 1 ? "τιμολόγιο είναι απλήρωτο" : "τιμολόγια είναι απλήρωτα"}`, href: "/invoices", action: "Δες ποια" });
  // πρώτα ό,τι καίει, μετά ό,τι περιμένει ως το βράδυ (η σειρά μέσα σε κάθε ομάδα μένει)
  const urgent = issues.filter((i) => i.tone === "danger"), later = issues.filter((i) => i.tone === "warning");
  const fold = urgent.length > 0 && issues.length > 3 && later.length > 0; // στο κινητό τα μη επείγοντα μαζεύονται

  // Στόχος μήνα: πρόοδος απέναντι στον ρυθμό που χρειάζεται, όχι μόνιμη προειδοποίηση
  const sold = monthSales?._sum.totalCents ?? 0;
  const today = Object.fromEntries(dayMonth.formatToParts(now).map((p) => [p.type, p.value]));
  const pace = target && target.salesCents > 0 ? targetPace(sold, target.salesCents, Number(today.day), new Date(Date.UTC(year, month, 0)).getUTCDate()) : null;
  const paceText = pace ? `${pace.pct}% του στόχου${pace.tone === "done" ? "" : ` · η γραμμή δείχνει πού έπρεπε να είσαι σήμερα (${pace.expectedPct}%)`}` : "";

  const shortcuts = ([
    { href: "/pos", label: "Ταμείο", needs: "pos.use", icon: Store },
    { href: "/receipts", label: "Αποδείξεις", needs: "receipts.read", icon: ReceiptText },
    { href: "/devices", label: "Νέα συσκευή", needs: "devices.add", icon: Plus },
    { href: "/users", label: "Νέος χρήστης", needs: "users.add", icon: Users },
  ] satisfies { href: string; label: string; needs: Permission; icon: LucideIcon }[]).filter((x) => permissions.includes(x.needs));
  const receipts = `${count} ${count === 1 ? "απόδειξη" : "αποδείξεις"}`;
  const tiles = [
    { label: "Μετρητά", value: euro(ledgerSum("CASH")), hint: "Τόσα πρέπει να έχει το συρτάρι", icon: Banknote },
    { label: "Κάρτες", value: euro(ledgerSum("CARD_CLEARING")), hint: "Μπαίνουν στην τράπεζα από τη Viva", icon: CreditCard },
    { label: "Μέση απόδειξη", value: euro(avg), hint: !yAvg || !count ? receipts : Math.abs(avg - yAvg) >= yAvg * 0.03
      ? <><Delta up={avg > yAvg}><span className="sr-only">{avg > yAvg ? "πάνω" : "κάτω"} </span>{euro(Math.abs(avg - yAvg))}</Delta> από χθες · {receipts}</>
      : `Περίπου όσο χθες · ${receipts}`, icon: BarChart3 },
  ] satisfies { label: string; value: string; hint: ReactNode; icon: LucideIcon }[];
  const seg = (on: boolean) => cn("inline-flex min-h-9 items-center rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap pointer-coarse:min-h-11", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground");

  return (
    <Page section="Επισκόπηση" title="Πίνακας ελέγχου" description={`${day.format(new Date())} · ${store?.name ?? org.name}`}
      actions={
        <>
          {stores.length > 1 ? (
            <nav aria-label="Κατάστημα" className="scrollbar-hide flex max-w-full overflow-x-auto rounded-lg border border-border bg-card p-0.5 max-md:order-last max-md:w-full">
              <Link href={link({ store: undefined })} className={seg(!store)} aria-current={!store ? "true" : undefined}>Όλα τα καταστήματα</Link>
              {stores.map((s) => <Link key={s.id} href={link({ store: s.id })} className={seg(s.id === store?.id)} aria-current={s.id === store?.id ? "true" : undefined}>{s.name}</Link>)}
            </nav>
          ) : null}
          {permissions.includes("pos.use") ? <Link href="/pos" className={btn("default")}><Store /> Άνοιγμα ταμείου</Link> : null}
        </>
      }>
      <div className="max-w-[90rem] space-y-4">
        <section aria-label="Η ημέρα μέχρι τώρα" className="grid grid-cols-2 gap-4 xl:grid-cols-[1.35fr_1fr_1fr_1fr]">
          <Card className="col-span-2 px-5 py-4 xl:col-span-1">
            <p className="flex items-center gap-2 font-medium text-muted-foreground"><ReceiptText className="size-4 text-gold-ink" /> Πωλήσεις σήμερα</p>
            <p className="mt-1.5 text-4xl leading-tight font-semibold tabular-nums">{euro(total)}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
              {vs.tone === "up" || vs.tone === "down" ? (
                <Delta up={vs.tone === "up"}>{vs.pct}%</Delta>
              ) : null}
              {vs.text}
            </p>
          </Card>
          {tiles.map(({ label, value, hint, icon: Icon }, i) => (
            <Card key={label} className={cn("px-5 py-4", i === 2 && "max-xl:col-span-2")}>
              <p className="flex items-center gap-2 font-medium text-muted-foreground"><Icon className="size-4 text-gold-ink" /> {label}</p>
              <p className="mt-1.5 text-3xl leading-tight font-semibold tabular-nums">{value}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">{hint}</p>
            </Card>
          ))}
        </section>

        {pace && target ? (
          <Card>
            <Link href="/finance" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 rounded-xl px-5 py-4 -outline-offset-2 md:grid-cols-[auto_minmax(0,1fr)_auto]">
              <h2 className="font-sans text-sm font-semibold">Στόχος {today.month}</h2>
              <span className="justify-self-end md:col-start-3"><Badge tone={pace.tone === "behind" ? "warning" : "success"}>{pace.tone === "behind" ? `Πίσω ${euro(pace.gapCents)}` : pace.tone === "ok" ? "Μέσα στον στόχο" : "Ο στόχος πιάστηκε"}</Badge></span>
              <p className="text-muted-foreground tabular-nums max-md:col-span-2 md:col-start-1 md:row-start-2">{euro(sold)} από {euro(target.salesCents)}</p>
              <div className="max-md:col-span-2 md:col-start-2 md:row-span-2 md:row-start-1">
                <div className="relative">
                  <Progress value={Math.min(100, pace.pct)} aria-label="Πρόοδος στόχου μήνα" aria-valuetext={paceText}
                    className={cn("h-2 bg-secondary", pace.tone === "behind" ? "[&>[data-slot=progress-indicator]]:bg-warning-ink" : "[&>[data-slot=progress-indicator]]:bg-success")} />
                  {pace.tone === "done" ? null : <span aria-hidden className="absolute -inset-y-1 w-0.5 bg-primary" style={{ left: `${pace.expectedPct}%` }} />}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{paceText}</p>
              </div>
              <p className="text-muted-foreground tabular-nums max-md:col-span-2 md:col-start-3 md:row-start-2 md:text-right">{pace.tone === "done" ? `${euro(sold - target.salesCents)} πάνω από τον στόχο` : `Θέλεις ${euro(pace.perDayCents)} την ημέρα`}</p>
            </Link>
          </Card>
        ) : null}

        <WidgetBoard
          id="dashboard"
          className="space-y-4"
          areas={[
            { id: "main", label: "Κύρια περιοχή", className: "grid gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]" },
            { id: "bottom", label: "Κάτω περιοχή", className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3" },
          ]}
          initial={{ main: ["sales", "attention"], bottom: ["top", "receipts", "devices", "payments", "categories", "shortcuts"] }}
          widgets={[
            {
              id: "sales", title: "Πωλήσεις",
              node: (
                <Card>
                  <Head title={span ? `Πωλήσεις ανά ημέρα` : "Πωλήσεις ανά ώρα"} note={span ? `${euro(periodTotal)} · προηγούμενες ${span} ημέρες ${euro(prevTotal)}` : best ? `Καλύτερη ώρα ${best.h}:00` : undefined} />
                  <TrendChart id="sales" data={trend} currentLabel={span ? `Τελευταίες ${span} ημέρες` : "Σήμερα"} previousLabel={span ? `Προηγούμενες ${span}` : "Χθες"}
                    summary={span ? `Πωλήσεις ανά ημέρα: ${euro(periodTotal)} τις τελευταίες ${span} ημέρες, ${euro(prevTotal)} τις προηγούμενες` : `Πωλήσεις ανά ώρα, σήμερα και χθες.${best ? ` Καλύτερη ώρα ${best.h}:00 με ${euro(best.total)}.` : ""}`}>
                    <nav aria-label="Περίοδος" className="flex rounded-lg border border-border bg-card p-0.5 max-sm:w-full">
                      {PERIOD_ORDER.map((k) => <Link key={k} href={link({ period: k === "today" ? undefined : k })} scroll={false} aria-current={k === period ? "true" : undefined} className={cn("inline-flex min-h-8 items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium max-sm:flex-1 pointer-coarse:min-h-11", k === period ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{PERIODS[k]}</Link>)}
                    </nav>
                  </TrendChart>
                </Card>
              ),
            },
            { id: "attention", title: "Θέλουν προσοχή", className: "max-lg:order-first", node: <Card>
            <Head title="Θέλουν προσοχή" note={issues.length ? urgent.length ? <Badge tone="danger">{urgent.length === 1 ? "1 επείγον" : `${urgent.length} επείγοντα`}</Badge> : <Badge tone="warning">{issues.length === 1 ? "1 ανοιχτό" : `${issues.length} ανοιχτά`}</Badge> : undefined} />
            {issues.length === 0 ? (
              <p className={cn(ROW, "text-muted-foreground")}><CircleCheck className="size-4 text-success" /> Όλα εντάξει: αποδείξεις, συσκευές και συνδρομή</p>
            ) : (
              <>
                {urgent.length ? <><h3 className={cn(GROUP_HEAD, "font-sans", ISSUE.danger.head)}>{ISSUE.danger.group}</h3><IssueRows items={urgent} /></> : null}
                {later.length ? (
                  // από md και πάνω φαίνονται όλα· στο κινητό, όταν κάτι καίει, τα υπόλοιπα ανοίγουν με ένα πάτημα
                  <div className={cn(fold && "max-md:hidden")}>
                    <h3 className={cn(GROUP_HEAD, "font-sans", ISSUE.warning.head, urgent.length > 0 && "border-t border-border")}>{ISSUE.warning.group}</h3>
                    <IssueRows items={later} />
                  </div>
                ) : null}
                {fold ? (
                  <details className="group md:hidden">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1 border-t border-border font-semibold text-primary -outline-offset-2 outline-ring focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                      Ακόμα {later.length} για μέσα στη μέρα <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <IssueRows items={later} />
                  </details>
                ) : null}
              </>
            )}
          </Card> },
            {
              id: "shortcuts", title: "Γρήγορες ενέργειες",
              node: (
                <Card>
                <Head title="Γρήγορες ενέργειες" />
                <div className="grid grid-cols-2 gap-2 px-5 pb-5">
                  {shortcuts.map(({ href, label, icon: Icon }) => (
                    <Link key={label} href={href} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 font-medium hover:bg-secondary">
                      <Icon className="size-4 text-muted-foreground" /> {label}
                    </Link>
                  ))}
                </div>
                </Card>
              ),
            },
            {
              id: "payments", title: "Τρόποι πληρωμής",
              node: (
                <Card>
                  <Head title="Τρόποι πληρωμής" note="σήμερα" />
                  {total ? <ShareChart totalLabel="σύνολο" summary={paid.map((p) => `${p.method} ${euro(p.total)}`).join(", ")} data={paid.map((p) => ({ key: p.method, label: p.method, value: p.total }))} /> : <p className={cn(ROW, "text-muted-foreground")}>Καμία πληρωμή ακόμα σήμερα</p>}
                </Card>
              ),
            },
            {
              id: "categories", title: "Πωλήσεις ανά κατηγορία",
              node: (
                <Card>
                  <Head title="Πωλήσεις ανά κατηγορία" note="σήμερα" />
                  {categories.length ? <RankChart summary={`Πρώτη κατηγορία: ${categories[0].name} με ${euro(categories[0].total)}`} data={categories.map((c) => ({ key: c.id, label: c.name, value: c.total }))} /> : <p className={cn(ROW, "text-muted-foreground")}>Καμία πώληση ακόμα σήμερα</p>}
                </Card>
              ),
            },
            { id: "top", title: "Τι πουλάει σήμερα", node: <Card>
            <Head title="Τι πουλάει σήμερα" />
            {top.length === 0 ? <p className={cn(ROW, "text-muted-foreground")}>Καμία πώληση ακόμα σήμερα</p> : null}
            <ul>
              {top.map((t) => (
                <li key={t.name} className={ROW}>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.name}</span><span className="block text-xs text-muted-foreground tabular-nums">{t.qty} τεμ.</span></span>
                  <span aria-hidden className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-secondary max-sm:hidden"><i className="block h-full rounded-full bg-chart-1/70" style={{ width: `${(t.total / top[0].total) * 100}%` }} /></span>
                  <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{euro(t.total)}</span>
                </li>
              ))}
            </ul>
          </Card> },
            { id: "receipts", title: "Τελευταίες αποδείξεις", node: <Card>
            <Head title="Τελευταίες αποδείξεις" href={permissions.includes("receipts.read") ? "/receipts" : undefined} all="Όλες" />
            {last.length === 0 ? <p className={cn(ROW, "text-muted-foreground")}>Καμία απόδειξη ακόμα</p> : null}
            <ul>
              {last.map((s) => (
                <li key={s.id}>
                  <Link href={`/receipts/${s.id}`} className={ROW_LINK}>
                    {/* ο αριθμός απόδειξης σαν απόκομμα: το σήμα της εφαρμογής */}
                    <span className="shrink-0 rounded-sm border border-dashed border-primary/30 bg-background px-1.5 py-1 font-mono text-xs leading-none font-medium">{s.series}-{s.aa}</span>
                    <span className="min-w-0 flex-1 text-muted-foreground tabular-nums">{s.issuedAt ? time.format(s.issuedAt) : ""}{s.payment ? ` · ${s.payment.method.name}` : ""}</span>
                    {s.fiscal && s.fiscal.status !== "SIGNED" ? <Badge tone="danger">Δεν στάλθηκε</Badge> : null}
                    <span className="w-18 shrink-0 text-right font-semibold tabular-nums">{euro(s.totalCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card> },
            { id: "devices", title: "Συσκευές", node: <Card>
            <Head title="Συσκευές" href={permissions.includes("devices.read") ? "/devices" : undefined} all="Όλες" />
            {status.length === 0 ? <p className={cn(ROW, "text-muted-foreground")}>Καμία συσκευή ακόμα</p> : null}
            <ul>
              {status.slice(0, 6).map(({ d, st }) => {
                const Icon = DEVICE_KIND[d.kind].measures === "TEMPERATURE" ? ThermometerSnowflake : d.kind === "POS_WEB" ? Store : TabletSmartphone;
                return (
                  <li key={d.id} className={ROW}>
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.name}</span><span className="block truncate text-xs text-muted-foreground">{d.store.name} · {DEVICE_KIND[d.kind].label}</span></span>
                    {st ? <Badge tone={st.tone}>{st.text}</Badge> : d.kind !== "POS_WEB" && !d.pairedAt ? <Badge tone="warning">Δεν έχει συνδεθεί</Badge> : <Badge tone="success">Ενεργή</Badge>}
                  </li>
                );
              })}
            </ul>
          </Card> },
          ]}
        />
      </div>
    </Page>
  );
}
