"use client";
// Συλλογή γραφημάτων πάνω στα chart components του shadcn (Recharts). Τα δεδομένα έρχονται έτοιμα από τον server·
// εδώ ζουν μόνο η σχεδίαση και οι επιλογές του χρήστη (είδος γραφήματος), που θυμάται ο browser.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Label, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/shadcn/chart";
import { useStored } from "@/lib/use-stored";
import { cn } from "./ui";

const euro = (cents: number) => new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" }).format(cents / 100);
const axisEuro = (cents: number) => `${Math.round(cents / 100)} €`;
const money = (value: unknown, name: unknown, cfg: ChartConfig) => (
  <span className="flex w-full items-center justify-between gap-4"><span className="text-muted-foreground">{cfg[String(name)]?.label ?? String(name)}</span><span className="font-semibold tabular-nums">{euro(Number(value))}</span></span>
);

const KINDS = [["bars", "Στήλες"], ["area", "Περιοχή"], ["line", "Γραμμή"]] as const;
type Kind = (typeof KINDS)[number][0];

/** Επιλογή είδους γραφήματος. Κοινή για όλα τα γραφήματα τάσης. */
function KindPicker({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  return (
    <div role="group" aria-label="Είδος γραφήματος" className="flex rounded-lg border border-border bg-card p-0.5">
      {KINDS.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={cn("cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium pointer-coarse:py-2", value === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
      ))}
    </div>
  );
}

export type TrendPoint = { label: string; current: number | null; previous: number | null; highlight?: boolean; faded?: boolean };

/**
 * Τάση πωλήσεων: τρέχουσα περίοδος απέναντι στην προηγούμενη. Στις στήλες, μία έμφαση (η καλύτερη) και η στήλη
 * που δεν έχει κλείσει πιο αχνή· η προηγούμενη περίοδος πάντα διακεκομμένη γραμμή.
 */
export function TrendChart({ id, data, currentLabel, previousLabel, summary, children }: { id: string; data: TrendPoint[]; currentLabel: string; previousLabel: string; summary: string; children?: React.ReactNode }) {
  const [kind, setKind] = useStored<Kind>(`gs.chart.${id}`, "bars");
  const config = { current: { label: currentLabel, color: "var(--chart-1)" }, previous: { label: previousLabel, color: "var(--muted-foreground)" } } satisfies ChartConfig;
  const common = { data, margin: { top: 16, right: 8, left: 0, bottom: 0 }, accessibilityLayer: true };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
      <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={axisEuro} />
      <ChartTooltip cursor={{ fill: "var(--secondary)" }} content={<ChartTooltipContent formatter={(v, n) => money(v, n, config)} />} />
      <ChartLegend content={<ChartLegendContent />} />
    </>
  );
  const previous = <Line dataKey="previous" type="monotone" stroke="var(--color-previous)" strokeWidth={1.5} strokeDasharray="3 4" dot={{ r: 2.5, fill: "var(--card)" }} connectNulls isAnimationActive={false} />;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-2">{children}<KindPicker value={kind} onChange={setKind} /></div>
      <ChartContainer config={config} className="aspect-auto h-64 w-full px-2 sm:h-80" role="img" aria-label={summary}>
        {kind === "bars" ? (
          <ComposedChart {...common}>
            {axes}
            <Bar dataKey="current" fill="var(--color-current)" radius={[3, 3, 0, 0]} maxBarSize={44} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.label} fill={d.highlight ? "var(--gold)" : "var(--color-current)"} fillOpacity={d.highlight ? 1 : d.faded ? 0.4 : 0.82} />)}
            </Bar>
            {previous}
          </ComposedChart>
        ) : kind === "area" ? (
          <AreaChart {...common}>
            {axes}
            <Area dataKey="current" type="monotone" stroke="var(--color-current)" strokeWidth={2} fill="var(--color-current)" fillOpacity={0.14} connectNulls isAnimationActive={false} />
            {previous}
          </AreaChart>
        ) : (
          <LineChart {...common}>
            {axes}
            <Line dataKey="current" type="monotone" stroke="var(--color-current)" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
            {previous}
          </LineChart>
        )}
      </ChartContainer>
    </div>
  );
}

export type Slice = { key: string; label: string; value: number };
const SLICE_COLORS = ["var(--chart-1)", "var(--gold)", "var(--chart-3)", "var(--chart-5)", "var(--chart-4)"];

/** Μερίδια (π.χ. τρόποι πληρωμής) ως δαχτυλίδι με το σύνολο στο κέντρο και λίστα με ποσά δίπλα: το χρώμα δεν είναι το μόνο σήμα. */
export function ShareChart({ data, totalLabel, summary }: { data: Slice[]; totalLabel: string; summary: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const config = Object.fromEntries(data.map((d, i) => [d.key, { label: d.label, color: SLICE_COLORS[i % SLICE_COLORS.length] }])) satisfies ChartConfig;
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 pb-5">
      <ChartContainer config={config} className="aspect-square h-40 shrink-0" role="img" aria-label={summary}>
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(v, n) => money(v, n, config)} />} />
          <Pie data={data} dataKey="value" nameKey="key" innerRadius={48} outerRadius={72} strokeWidth={2} stroke="var(--card)" isAnimationActive={false}>
            {data.map((d, i) => <Cell key={d.key} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />)}
            <Label content={({ viewBox }) => viewBox && "cx" in viewBox ? (
              <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) - 2} className="fill-foreground text-base font-semibold">{euro(total)}</tspan>
                <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 14} className="fill-muted-foreground text-2xs">{totalLabel}</tspan>
              </text>
            ) : null} />
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="min-w-36 flex-1 space-y-2">
        {data.map((d, i) => (
          <li key={d.key} className="flex items-center gap-2">
            <i aria-hidden className="size-2.5 shrink-0 rounded-xs" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate">{d.label}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            <span className="w-20 text-right font-semibold tabular-nums">{euro(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Κατάταξη (π.χ. πωλήσεις ανά κατηγορία) ως οριζόντιες μπάρες: η πρώτη έχει την έμφαση. */
export function RankChart({ data, summary }: { data: Slice[]; summary: string }) {
  const config = { value: { label: "Πωλήσεις", color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto w-full px-2 pb-3" style={{ height: Math.max(120, data.length * 40 + 24) }} role="img" aria-label={summary}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, left: 8, bottom: 0 }} accessibilityLayer>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={96} />
        <ChartTooltip cursor={{ fill: "var(--secondary)" }} content={<ChartTooltipContent hideLabel formatter={(v, n) => money(v, n, config)} />} />
        <Bar dataKey="value" radius={3} maxBarSize={18} isAnimationActive={false} label={{ position: "right", formatter: (v: unknown) => euro(Number(v)), className: "fill-foreground tabular-nums", fontSize: 11 }}>
          {data.map((d, i) => <Cell key={d.key} fill={i === 0 ? "var(--gold)" : "var(--color-value)"} fillOpacity={i === 0 ? 1 : 0.75} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
