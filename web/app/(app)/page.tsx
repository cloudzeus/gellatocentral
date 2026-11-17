import { ArrowDown, ArrowRight, ArrowUp, Banknote, BarChart3, CircleCheck, CreditCard, Plus, ReceiptText, Store, TabletSmartphone, ThermometerSnowflake, Users } from "lucide-react";
import Link from "next/link";
import { Badge, btn, Card, cn, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { compare } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { DEVICE_KIND, readingStatus } from "@/lib/devices";
import { METHOD } from "@/lib/labels";
import { euro } from "@/lib/money";

type Hour = { h: number; total: number };
type Meta = { now_hour: number; y_same: number; y_total: number; y_count: number };
type Top = { name: string; qty: number; total: number };

const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 864e5);
const time = new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Athens" });
const day = new Intl.DateTimeFormat("el-GR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Athens" });
// «Σήμερα» = ημέρα Αθήνας (το issuedAt αποθηκεύεται σε UTC)
const LOCAL = `("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Athens')`;
const NOW = `(now() AT TIME ZONE 'Europe/Athens')`;
const SCOPE = `"orgId" = $1 AND ($2::text IS NULL OR "storeId" = $2) AND status = 'COMPLETED'`;

/** Στήλες = σήμερα, διακεκομμένη = χθες. Μία έμφαση: η καλύτερη ώρα. Η ώρα που τρέχει είναι πιο αχνή (δεν έκλεισε). */
function HourChart({ today, yesterday, nowHour, width, height, font, className }: { today: Hour[]; yesterday: Hour[]; nowHour: number; width: number; height: number; font: number; className: string }) {
  const all = [...today, ...yesterday];
  const from = Math.min(...all.map((x) => x.h)), to = Math.max(...all.map((x) => x.h), nowHour);
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const top = Math.max(...all.map((x) => x.total));
  const step = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000].find((s) => top / s <= 4) ?? 1000000;
  const max = Math.ceil(top / step) * step;
  const pad = { l: font * 4.2, r: 8, t: font * 1.8, b: font * 2.4 };
  const bw = (width - pad.l - pad.r) / hours.length;
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const x = (h: number) => pad.l + (h - from) * bw;
  const peak = Math.max(0, ...today.map((t) => t.total));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-auto w-full", className)} style={{ fontSize: font }} role="img"
      aria-label={`Πωλήσεις ανά ώρα, σήμερα και χθες.${peak ? ` Καλύτερη ώρα σήμερα ${today.find((t) => t.total === peak)?.h}:00 με ${euro(peak)}.` : ""}`}>
      {Array.from({ length: max / step + 1 }, (_, i) => i * step).map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={width - pad.r} y1={y(g)} y2={y(g)} className="stroke-border" />
          <text x={pad.l - 6} y={y(g) + font * 0.35} textAnchor="end" className="fill-muted-foreground tabular-nums">{g / 100} €</text>
        </g>
      ))}
      {hours.map((h) => <text key={h} x={x(h) + bw / 2} y={height - font * 0.6} textAnchor="middle" className="fill-muted-foreground tabular-nums">{h}</text>)}
      {today.map((t) => (
        <g key={t.h}>
          <rect x={x(t.h) + bw * 0.22} y={y(t.total)} width={bw * 0.56} height={Math.max(1, y(0) - y(t.total))} rx={2} className={t.total === peak ? "fill-gold" : t.h === nowHour ? "fill-chart-1/40" : "fill-chart-1/80"}>
            <title>{`${t.h}:00 · ${euro(t.total)}`}</title>
          </rect>
          {t.total === peak ? <text x={x(t.h) + bw / 2} y={y(t.total) - font * 0.5} textAnchor="middle" className="fill-gold-ink font-semibold tabular-nums">{euro(t.total)}</text> : null}
        </g>
      ))}
      {yesterday.length > 1 ? <polyline fill="none" strokeWidth={1.5} strokeDasharray="3 4" className="stroke-muted-foreground" points={yesterday.map((d) => `${x(d.h) + bw / 2},${y(d.total)}`).join(" ")} /> : null}
      {yesterday.map((d) => <circle key={d.h} cx={x(d.h) + bw / 2} cy={y(d.total)} r={2.5} strokeWidth={1.25} className="fill-card stroke-muted-foreground"><title>{`Χθες ${d.h}:00 · ${euro(d.total)}`}</title></circle>)}
    </svg>
  );
}

const Swatch = ({ className }: { className: string }) => <i aria-hidden className={cn("mr-1.5 inline-block size-2.5 rounded-xs align-[-1px]", className)} />;
const Head = ({ title, note, href, all }: { title: string; note?: string | number; href?: string; all?: string }) => (
  <div className="flex items-baseline gap-3 px-5 pt-4 pb-3">
    <h2 className="text-base">{title}</h2>
    {note !== undefined ? <span className="text-xs text-muted-foreground tabular-nums">{note}</span> : null}
    {href ? <Link href={href} className="ml-auto flex items-center gap-1 text-sm font-semibold text-primary hover:underline">{all} <ArrowRight className="size-4" /></Link> : null}
  </div>
);
const ROW = "flex min-h-11 items-center gap-3 border-t border-border px-5 py-1.5 pointer-coarse:min-h-12";
const DOT = { danger: "bg-destructive", warning: "bg-gold" };

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const { org, permissions } = await currentOrg("dashboard.view");
  const stores = await db.store.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const wanted = (await searchParams).store;
  const store = stores.find((s) => s.id === wanted) ?? null;
  const args = [org.id, store?.id ?? null] as const;
  const inStore = store ? { storeId: store.id } : {};

  const byHour = (dayOffset: number) =>
    db.$queryRawUnsafe<Hour[]>(`SELECT extract(hour FROM ${LOCAL})::int AS h, sum("totalCents")::int AS total FROM "Sale" WHERE ${SCOPE} AND ${LOCAL}::date = ${NOW}::date - ${dayOffset} GROUP BY 1 ORDER BY 1`, ...args);
  const [hours, yHours, [meta], paid, top, last, unsent, devices, subscription] = await Promise.all([
    byHour(0),
    byHour(1),
    db.$queryRawUnsafe<Meta[]>(
      `SELECT extract(hour FROM ${NOW})::int AS now_hour,
        coalesce(sum("totalCents") FILTER (WHERE ${LOCAL} <= ${NOW} - interval '1 day'), 0)::int AS y_same,
        coalesce(sum("totalCents"), 0)::int AS y_total, count(*)::int AS y_count
       FROM "Sale" WHERE ${SCOPE} AND ${LOCAL}::date = ${NOW}::date - 1`, ...args),
    db.$queryRawUnsafe<{ method: "CASH" | "CARD"; total: number; n: number }[]>(
      `SELECT p.method, sum(p."amountCents")::int AS total, count(*)::int AS n FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId"
       WHERE s."orgId" = $1 AND ($2::text IS NULL OR s."storeId" = $2) AND s.status = 'COMPLETED' AND (s."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Athens')::date = ${NOW}::date GROUP BY 1`, ...args),
    db.$queryRawUnsafe<Top[]>(
      `SELECT l.name, sum(l.quantity)::int AS qty, sum(l.quantity * l."unitPriceCents")::int AS total FROM "SaleLine" l JOIN "Sale" s ON s.id = l."saleId"
       WHERE s."orgId" = $1 AND ($2::text IS NULL OR s."storeId" = $2) AND s.status = 'COMPLETED' AND (s."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Athens')::date = ${NOW}::date
       GROUP BY 1 ORDER BY 3 DESC LIMIT 5`, ...args),
    db.sale.findMany({ where: { orgId: org.id, status: "COMPLETED", ...inStore }, orderBy: { issuedAt: "desc" }, take: 5, include: { payment: true, fiscal: true } }),
    db.fiscalDocument.count({ where: { sale: { orgId: org.id, status: "COMPLETED", ...inStore }, status: { not: "SIGNED" } } }),
    db.device.findMany({ where: { store: { orgId: org.id }, active: true, ...inStore }, orderBy: { createdAt: "asc" }, include: { store: true, readings: { orderBy: { at: "desc" }, take: 1 } } }),
    db.subscription.findUnique({ where: { orgId: org.id } }),
  ]);
  const sum = (m: "CASH" | "CARD") => paid.find((p) => p.method === m)?.total ?? 0;

  const total = hours.reduce((s, h) => s + h.total, 0);
  const count = paid.reduce((s, p) => s + p.n, 0);
  const vs = compare(total, meta.y_same);
  const avg = count ? Math.round(total / count) : 0;
  const yAvg = meta.y_count ? Math.round(meta.y_total / meta.y_count) : 0;
  const best = hours.length ? hours.reduce((a, b) => (b.total > a.total ? b : a)) : null;

  // Ό,τι χρειάζεται ενέργεια σήμερα, με το πού πατάς για να το λύσεις
  const status = devices.map((d) => ({ d, st: DEVICE_KIND[d.kind].measures ? readingStatus(d, d.readings[0]) : null }));
  const issues: { tone: "danger" | "warning"; text: string; detail?: string; href: string; action: string }[] = [];
  for (const { d, st } of status) if (st && d.readings[0] && st.tone !== "success" && st.tone !== "neutral") issues.push({ tone: st.tone, text: `${d.name}: ${st.text}`, detail: d.store.name, href: "/devices", action: "Δες το" });
  if (unsent > 0) issues.push({ tone: "danger", text: `${unsent} ${unsent === 1 ? "απόδειξη δεν διαβιβάστηκε" : "αποδείξεις δεν διαβιβάστηκαν"} στην ΑΑΔΕ`, href: "/receipts", action: "Δες ποιες" });
  for (const { d } of status) if (d.kind !== "POS_WEB" && !d.pairedAt) issues.push({ tone: "warning", text: `${d.name}: δεν έχει συνδεθεί ακόμα`, detail: d.store.name, href: "/devices", action: "Σύζευξη" });
  const daysLeft = subscription ? daysUntil(subscription.currentPeriodEnd) : null;
  if (daysLeft !== null && daysLeft <= 7) issues.push({ tone: daysLeft < 0 ? "danger" : "warning", text: daysLeft < 0 ? "Η συνδρομή έληξε" : `Η συνδρομή λήγει σε ${daysLeft} ${daysLeft === 1 ? "ημέρα" : "ημέρες"}`, href: "/billing", action: "Συνδρομή" });

  const shortcuts = [
    { href: "/pos", label: "Ταμείο", needs: "pos.use", icon: Store },
    { href: "/receipts", label: "Αποδείξεις", needs: "receipts.view", icon: ReceiptText },
    { href: "/devices", label: "Νέα συσκευή", needs: "devices.manage", icon: Plus },
    { href: "/users", label: "Νέος χρήστης", needs: "users.manage", icon: Users },
  ].filter((x) => permissions.includes(x.needs));
  const tiles = [
    { label: "Μετρητά", value: euro(sum("CASH")), hint: "Τόσα πρέπει να έχει το συρτάρι", icon: Banknote },
    { label: "Κάρτες", value: euro(sum("CARD")), hint: "Πιστώνονται από τη Viva", icon: CreditCard },
    { label: "Μέση απόδειξη", value: euro(avg), hint: `${count} ${count === 1 ? "απόδειξη" : "αποδείξεις"}${yAvg ? ` · χθες ${euro(yAvg)}` : ""}`, icon: BarChart3 },
  ];
  const seg = (on: boolean) => cn("rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap pointer-coarse:py-2.5", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground");

  return (
    <Page section="Επισκόπηση" title="Πίνακας ελέγχου" description={`${day.format(new Date())} · ${store?.name ?? org.name}`}
      actions={
        <>
          {stores.length > 1 ? (
            <nav aria-label="Κατάστημα" className="scrollbar-hide flex max-w-full overflow-x-auto rounded-lg border border-border bg-card p-0.5 max-md:order-last max-md:w-full">
              <Link href="/" className={seg(!store)} aria-current={!store ? "true" : undefined}>Όλα τα καταστήματα</Link>
              {stores.map((s) => <Link key={s.id} href={`/?store=${s.id}`} className={seg(s.id === store?.id)} aria-current={s.id === store?.id ? "true" : undefined}>{s.name}</Link>)}
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
                <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-px text-xs font-semibold tabular-nums", vs.tone === "up" ? "bg-success/12 text-success-ink" : "bg-destructive/10 text-destructive")}>
                  {vs.tone === "up" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{vs.pct}%
                </span>
              ) : null}
              {vs.text}
            </p>
          </Card>
          {tiles.map(({ label, value, hint, icon: Icon }, i) => (
            <Card key={label} className={cn("px-5 py-4", i === 2 && "max-xl:col-span-2")}>
              <p className="flex items-center gap-2 font-medium text-muted-foreground"><Icon className="size-4 text-gold-ink" /> {label}</p>
              <p className="mt-1.5 text-3xl leading-tight font-semibold tabular-nums">{value}</p>
              <p className="mt-1.5 text-muted-foreground">{hint}</p>
            </Card>
          ))}
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
          <Card>
            <Head title="Πωλήσεις ανά ώρα" note={best ? `Καλύτερη ώρα ${best.h}:00` : undefined} />
            {hours.length + yHours.length === 0 ? (
              <p className="px-5 py-12 text-center text-muted-foreground">Το γράφημα γεμίζει με την πρώτη απόδειξη της ημέρας</p>
            ) : (
              <>
                <div className="px-5 pb-3">
                  <HourChart today={hours} yesterday={yHours} nowHour={meta.now_hour} width={760} height={330} font={11} className="max-md:hidden" />
                  <HourChart today={hours} yesterday={yHours} nowHour={meta.now_hour} width={360} height={220} font={11.5} className="md:hidden" />
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-4 text-xs text-muted-foreground">
                  <span><Swatch className="bg-chart-1/80" />Σήμερα</span>
                  <span><Swatch className="bg-gold" />Καλύτερη ώρα</span>
                  <span><Swatch className="bg-chart-1/40" />Η ώρα που τρέχει</span>
                  <span><i aria-hidden className="mr-1.5 inline-block w-4 border-t-2 border-dashed border-muted-foreground align-middle" />Χθες</span>
                </p>
              </>
            )}
          </Card>

          <Card>
            <Head title="Θέλουν προσοχή" note={issues.length || undefined} />
            {issues.length === 0 ? (
              <p className={cn(ROW, "text-muted-foreground")}><CircleCheck className="size-4 text-success" /> Όλα εντάξει: αποδείξεις, συσκευές και συνδρομή</p>
            ) : (
              <ul>
                {issues.map((i) => (
                  <li key={i.text}>
                    <Link href={i.href} className={cn(ROW, "hover:bg-secondary")}>
                      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[i.tone])} />
                      <span className="min-w-0 flex-1"><span className="block font-medium">{i.text}</span>{i.detail ? <span className="block text-xs text-muted-foreground">{i.detail}</span> : null}</span>
                      <span className="flex shrink-0 items-center gap-1 font-semibold text-primary">{i.action} <ArrowRight className="size-4" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {shortcuts.length ? (
              <>
                <Head title="Γρήγορες ενέργειες" />
                <div className="grid grid-cols-2 gap-2 px-5 pb-5">
                  {shortcuts.map(({ href, label, icon: Icon }) => (
                    <Link key={label} href={href} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 font-medium hover:bg-secondary">
                      <Icon className="size-4 text-muted-foreground" /> {label}
                    </Link>
                  ))}
                </div>
              </>
            ) : null}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
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
          </Card>

          <Card>
            <Head title="Τελευταίες αποδείξεις" href={permissions.includes("receipts.view") ? "/receipts" : undefined} all="Όλες" />
            {last.length === 0 ? <p className={cn(ROW, "text-muted-foreground")}>Καμία απόδειξη ακόμα</p> : null}
            <ul>
              {last.map((s) => (
                <li key={s.id}>
                  <Link href={`/receipts/${s.id}`} className={cn(ROW, "hover:bg-secondary")}>
                    {/* ο αριθμός απόδειξης σαν απόκομμα: το σήμα της εφαρμογής */}
                    <span className="shrink-0 rounded-sm border border-dashed border-primary/30 bg-background px-1.5 py-1 font-mono text-xs leading-none font-medium">{s.series}-{s.aa}</span>
                    <span className="min-w-0 flex-1 text-muted-foreground tabular-nums">{s.issuedAt ? time.format(s.issuedAt) : ""}{s.payment ? ` · ${METHOD[s.payment.method]}` : ""}</span>
                    {s.fiscal && s.fiscal.status !== "SIGNED" ? <Badge tone="danger">Δεν στάλθηκε</Badge> : null}
                    <span className="w-18 shrink-0 text-right font-semibold tabular-nums">{euro(s.totalCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <Head title="Συσκευές" href={permissions.includes("devices.manage") ? "/devices" : undefined} all="Όλες" />
            {status.length === 0 ? <p className={cn(ROW, "text-muted-foreground")}>Καμία συσκευή ακόμα</p> : null}
            <ul>
              {status.slice(0, 6).map(({ d, st }) => {
                const Icon = DEVICE_KIND[d.kind].measures === "TEMPERATURE" ? ThermometerSnowflake : d.kind === "POS_WEB" ? Store : TabletSmartphone;
                return (
                  <li key={d.id} className={ROW}>
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.name}</span><span className="block truncate text-xs text-muted-foreground">{d.store.name} · {DEVICE_KIND[d.kind].label}</span></span>
                    {st ? <Badge tone={st.tone}>{st.text}</Badge> : d.kind !== "POS_WEB" && !d.pairedAt ? <Badge tone="warning">Χωρίς σύζευξη</Badge> : <Badge tone="success">Ενεργή</Badge>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
