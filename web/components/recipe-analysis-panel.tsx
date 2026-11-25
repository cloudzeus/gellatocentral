// Πάνελ τεχνικής ανάλυσης συνταγής: βασικές τιμές και μπάρες ισορροπίας ως προς τους στόχους
// του τύπου συνταγής. Καθαρό component χωρίς server API — το ίδιο αποτυπώνει την αποθηκευμένη
// ανάλυση (server) και το ζωντανό preview στον επεξεργαστή γραμμών (client).
import { Badge, cn } from "@/components/ui";
import { euro } from "@/lib/money";
import {
  METRIC_LABEL,
  RECIPE_TYPE_LABEL,
  balanceBar,
  stabilizerDoseCheck,
  targetFor,
  type RecipeAnalysis,
} from "@/lib/recipe-analysis";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

const BAR_METRICS = ["totalSolids", "fat", "msnf", "sugars", "pac", "pod", "lactoseWaterRatio", "stabilizerGPerKg"] as const;
const STATUS_TONE = { ok: "var(--success)", low: "var(--gold)", high: "var(--destructive)", none: "var(--muted-foreground)" } as const;

const fmt = (v: number, digits = 1) => v.toLocaleString("el-GR", { maximumFractionDigits: digits });

function Bar({ metric, value, recipeType }: { metric: string; value: number; recipeType: string }) {
  const bar = balanceBar(metric, value, targetFor(recipeType, metric));
  return (
    <div className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2 text-xs">
      <span className="truncate text-muted-foreground">{METRIC_LABEL[metric] ?? metric}</span>
      <span className="relative h-3.5 overflow-hidden rounded-full bg-secondary">
        {bar.rangeLeft != null && bar.rangeWidth != null ? (
          <span className="absolute inset-y-0 rounded-full bg-success/25" style={{ left: `${bar.rangeLeft}%`, width: `${bar.rangeWidth}%` }} />
        ) : null}
        <span className="absolute inset-y-0 w-1 rounded-full" style={{ left: `calc(${bar.marker}% - 2px)`, background: STATUS_TONE[bar.status] }} />
      </span>
      <span className="text-right font-medium tabular-nums">{fmt(value)}</span>
    </div>
  );
}

export function RecipeAnalysisPanel({ analysis: a, recipeType, className }: { analysis: RecipeAnalysis; recipeType: string; className?: string }) {
  const dose = stabilizerDoseCheck(a, recipeType);
  const stats: [string, string][] = [
    ["Κόστος / kg", a.costPerKgHundredths > 0 ? euro(a.costPerKgHundredths / 100) : "—"],
    ["Κόστος δόσης", a.costBatchHundredths > 0 ? euro(a.costBatchHundredths / 100) : "—"],
    ["Σημείο πήξης", `${fmt(a.freezingPoint)} °C`],
    ["Θερμοκρασία σερβ.", `${fmt(a.servingTemp)} °C`],
    ["Πάγος στους −12 °C", `${fmt(a.frozenAtMinus12, 0)}%`],
    ["Πάγος στους −18 °C", `${fmt(a.frozenAtMinus18, 0)}%`],
    ["AFP factor", `${fmt(a.afpFactor)} — ${a.afpReason}`],
    ["Γεύση γάλακτος", fmt(a.milkFlavour)],
  ];
  return (
    <div className={cn("grid gap-4", className)}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {stats.map(([label, v]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-1.5">
        {BAR_METRICS.map((m) => (
          <Bar key={m} metric={m} value={a[m]} recipeType={recipeType} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="neutral">{RECIPE_TYPE_LABEL[recipeType] ?? recipeType}</Badge>
        {dose ? (
          <StatusBadge look={look(dose.status === "ok" ? "success" : "warning", `Σταθεροποιητής ${fmt(a.stabilizerDosePct, 2)}% · συνιστώμενο ${fmt(dose.recommendedPct, 2)}%${dose.status !== "ok" ? ` (${dose.deltaGrams > 0 ? "+" : ""}${fmt(dose.deltaGrams, 0)} g)` : ""}`)} />
        ) : null}
        {a.afpBorderline ? <StatusBadge look={look("warning", "Οριακός AFP")} /> : null}
      </div>
    </div>
  );
}
