import type { Composition } from "@/lib/generated/prisma/client";
import { Badge } from "@/components/ui";
import { ACIDITY_OPTIONS, ALLERGEN_LABEL, COMPOSITION_GROUPS, compositionFromRow, PCT_FIELDS } from "@/lib/composition";
import { materialLactose, materialPac, materialPod, materialTotalSolids } from "@/lib/recipe-analysis";

const number = (value: number) => value.toLocaleString("el-GR", { maximumFractionDigits: 3 });

/** Αναγνώσιμη σύσταση μέσα στο accordion της λίστας, με τα ίδια πεδία και μονάδες της φόρμας. */
export function CompositionDetails({ composition: c }: { composition: Composition }) {
  const summary = compositionFromRow(c as unknown as Record<string, unknown>);
  const computed: [string, number, string][] = [
    ["Ολικά στερεά", materialTotalSolids(summary), "%"],
    ["Νερό", 100 - materialTotalSolids(summary), "%"],
    ["Σάκχαρα", (summary.sucrosePct ?? 0) + (summary.dextrosePct ?? 0) + (summary.glucoseSyrupPct ?? 0) + (summary.invertSugarPct ?? 0) + (summary.fructosePct ?? 0), "%"],
    ["Λακτόζη", materialLactose(summary), "%"],
    ["PAC", materialPac(summary), ""],
    ["POD", materialPod(summary), ""],
  ];
  const groups = COMPOSITION_GROUPS.map((group) => ({
    title: group.title,
    values: group.fields.flatMap((field) => {
      const raw = field.key === "glucoseDe" ? c.glucoseDe : c[PCT_FIELDS[field.key]];
      if (raw == null) return [];
      const unit = field.key === "alcoholPct" ? "% vol" : field.key === "pacOverride" || field.key === "podOverride" || field.key === "glucoseDe" ? "" : "%";
      return [{ label: field.label.replace(/ %(?: vol)?$/, ""), value: number(field.key === "glucoseDe" ? raw : raw / 1000), unit }];
    }),
  })).filter((group) => group.values.length);
  const acidity = ACIDITY_OPTIONS.find(([value]) => value === c.acidityLevel)?.[1];
  const traits = [
    c.isVegan ? "Vegan" : null,
    c.isVegetarian ? "Χορτοφαγικό" : null,
    c.isSugarFree ? "Χωρίς προσθήκη ζάχαρης" : null,
    c.isGlutenFree ? "Χωρίς γλουτένη" : null,
    c.isLactoseFree ? "Χωρίς λακτόζη" : null,
    c.containsAlcohol ? "Περιέχει αλκοόλ" : null,
    c.containsCocoa ? "Περιέχει κακάο" : null,
    c.containsStarch ? "Περιέχει άμυλο" : null,
    acidity && c.acidityLevel !== "none" ? `Οξύτητα: ${acidity}` : null,
  ].filter((trait): trait is string => !!trait);

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold">Υπολογισμένες τιμές</h3>
          <p className="text-xs text-muted-foreground">Από την καταχωρημένη σύσταση, ανά 100 g</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {computed.map(([label, value, unit]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{number(value)}{unit}</dd>
            </div>
          ))}
        </dl>
      </section>

      {groups.length ? groups.map((group) => (
        <section key={group.title} className="grid gap-3 border-t border-border/70 pt-4">
          <h3 className="text-sm font-semibold">{group.title}</h3>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {group.values.map((field) => (
              <div key={field.label}>
                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                <dd className="font-medium tabular-nums">{field.value}{field.unit}</dd>
              </div>
            ))}
          </dl>
        </section>
      )) : (
        <p className="border-t border-border/70 pt-4 text-sm text-muted-foreground">Δεν έχουν καταχωρηθεί αναλυτικά ποσοστά.</p>
      )}

      {c.ingredientsText ? (
        <section className="grid gap-2 border-t border-border/70 pt-4">
          <h3 className="text-sm font-semibold">Συστατικά ετικέτας</h3>
          <p className="max-w-[75ch] text-sm leading-relaxed whitespace-pre-wrap break-words">{c.ingredientsText}</p>
        </section>
      ) : null}

      {c.allergensContains.length || c.allergensTraces.length ? (
        <section className="grid gap-3 border-t border-border/70 pt-4">
          <h3 className="text-sm font-semibold">Αλλεργιογόνα</h3>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="mb-2 text-xs text-muted-foreground">Περιέχει</dt>
              <dd className="flex flex-wrap gap-1.5">{c.allergensContains.length ? c.allergensContains.map((key) => <Badge key={key} tone="danger">{ALLERGEN_LABEL[key] ?? key}</Badge>) : <span className="text-sm text-muted-foreground">Κανένα δηλωμένο</span>}</dd>
            </div>
            <div>
              <dt className="mb-2 text-xs text-muted-foreground">Ίχνη</dt>
              <dd className="flex flex-wrap gap-1.5">{c.allergensTraces.length ? c.allergensTraces.map((key) => <Badge key={key} tone="warning">{ALLERGEN_LABEL[key] ?? key}</Badge>) : <span className="text-sm text-muted-foreground">Κανένα δηλωμένο</span>}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {traits.length ? (
        <section className="grid gap-2 border-t border-border/70 pt-4">
          <h3 className="text-sm font-semibold">Διατροφικά & λοιπά χαρακτηριστικά</h3>
          <div className="flex flex-wrap gap-1.5">{traits.map((trait) => <Badge key={trait}>{trait}</Badge>)}</div>
        </section>
      ) : null}
    </div>
  );
}
