// Φόρμα τεχνικής σύστασης είδους (% ανά 100 g) — κοινή για τον κεντρικό κατάλογο (TradeItem)
// και τα ιδιωτικά είδη του συνδρομητή (GenericItem). Server component· τα πεδία και οι ομάδες
// ορίζονται στο lib/composition.ts.
import type { Composition } from "@/lib/generated/prisma/client";
import { ACIDITY_OPTIONS, ALLERGENS, COMPOSITION_GROUPS, PCT_FIELDS, pmToInput } from "@/lib/composition";
import { Submit } from "@/components/submit";
import { btn, Field, Select, TextareaField } from "@/components/ui";

const CHECK = "flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-secondary/60 has-checked:border-primary/50 has-checked:bg-primary/5";

function Check({ name, label, defaultChecked, value }: { name: string; label: string; defaultChecked?: boolean; value?: string }) {
  return (
    <label className={CHECK}>
      <input type="checkbox" name={name} value={value ?? "on"} defaultChecked={defaultChecked} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
}

export function CompositionForm({
  action,
  composition: c,
  hidden,
}: {
  action: (form: FormData) => Promise<void>;
  composition: Composition | null;
  hidden: Record<string, string>;
}) {
  const pct = (key: string) => pmToInput(c?.[PCT_FIELDS[key as keyof typeof PCT_FIELDS] as keyof Composition] as number | null);
  return (
    <form action={action} className="grid gap-6">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {COMPOSITION_GROUPS.map((g) => (
        <fieldset key={g.title} className="grid gap-3">
          <legend className="text-sm font-semibold text-muted-foreground">{g.title}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map((f) =>
              f.key === "glucoseDe" ? (
                <Field key={f.key} label={f.label} name="glucoseDe" inputMode="numeric" defaultValue={c?.glucoseDe != null ? String(c.glucoseDe) : ""} hint={f.hint} />
              ) : (
                <Field key={f.key} label={f.label} name={f.key} inputMode="decimal" defaultValue={pct(f.key)} hint={f.hint} />
              ),
            )}
          </div>
        </fieldset>
      ))}

      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-muted-foreground">Συστατικά</legend>
        <TextareaField label="Συστατικά ετικέτας" name="ingredientsText" rows={3} defaultValue={c?.ingredientsText ?? ""} hint="Όπως αναγράφονται στην ετικέτα του προϊόντος" />
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-muted-foreground">Χαρακτηριστικά</legend>
        <div className="max-w-xs">
          <Select label="Οξύτητα" name="acidityLevel" defaultValue={c?.acidityLevel ?? "none"} options={ACIDITY_OPTIONS} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Check name="containsCocoa" label="Περιέχει κακάο" defaultChecked={c?.containsCocoa ?? false} />
          <Check name="containsStarch" label="Περιέχει άμυλο" defaultChecked={c?.containsStarch ?? false} />
          <Check name="containsAlcohol" label="Περιέχει αλκοόλ" defaultChecked={c?.containsAlcohol ?? false} />
          <Check name="isVegan" label="Vegan" defaultChecked={c?.isVegan ?? false} />
          <Check name="isVegetarian" label="Χορτοφαγικό" defaultChecked={c?.isVegetarian ?? true} />
          <Check name="isSugarFree" label="Χωρίς προσθήκη ζάχαρης" defaultChecked={c?.isSugarFree ?? false} />
          <Check name="isGlutenFree" label="Χωρίς γλουτένη" defaultChecked={c?.isGlutenFree ?? true} />
          <Check name="isLactoseFree" label="Χωρίς λακτόζη" defaultChecked={c?.isLactoseFree ?? true} />
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-muted-foreground">Αλλεργιογόνα (Καν. ΕΕ 1169/2011)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <p className="text-xs font-medium text-muted-foreground">Περιέχει</p>
            {ALLERGENS.map(([key, label]) => (
              <Check key={key} name="allergensContains" value={key} label={label} defaultChecked={c?.allergensContains.includes(key) ?? false} />
            ))}
          </div>
          <div className="grid content-start gap-2">
            <p className="text-xs font-medium text-muted-foreground">Ίχνη</p>
            {ALLERGENS.map(([key, label]) => (
              <Check key={key} name="allergensTraces" value={key} label={label} defaultChecked={c?.allergensTraces.includes(key) ?? false} />
            ))}
          </div>
        </div>
      </fieldset>

      <div className="flex justify-end border-t border-border/70 pt-4">
        <Submit className={btn("default")}>Αποθήκευση σύστασης</Submit>
      </div>
    </form>
  );
}
