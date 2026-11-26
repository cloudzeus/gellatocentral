"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Box, Check, ChefHat, CircleAlert, Factory, IceCreamBowl, LayoutGrid, Minus, Package, Plus, Printer, Refrigerator, Smartphone, Snowflake, Store, TabletSmartphone, Trash2, Warehouse, Wind, type LucideIcon } from "lucide-react";
import { Submit } from "@/components/submit";
import { btn, Card } from "@/components/ui";
import { expand, KIND_ORDER, LIMITS, type Plan, planProblems, SPACE, SPACE_ORDER, type SpaceKind, type StoreKind, TEMPLATES } from "@/lib/store-setup";
import { createStore } from "./actions";

const KIND_ICON: Record<StoreKind, LucideIcon> = { SHOP_TABLES: Store, WORKSHOP: Factory, VENDING: Box, VENDING_STOCK: Warehouse };
const SPACE_ICON: Record<SpaceKind, LucideIcon> = { showcase: IceCreamBowl, freezer: Snowflake, fridge: Refrigerator, chamber: Warehouse, blast: Wind, vending: Box, dry: Package };
// χρώμα = θερμοκρασία: κατάψυξη μπλε, ψύξη πράσινο, ξηρό καφέ — ίδιο στη λίστα και στην προεπισκόπηση
const tempTone = (t: [number, number] | null) => (!t ? "border-l-amber-700/60" : t[1] <= -10 ? "border-l-sky-600" : "border-l-emerald-600");
const field = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11";
const deg = (n: number) => (n > 0 ? `+${n}` : String(n).replace("-", "−"));
const temp = (t: [number, number] | null) => (t ? `${deg(t[0])} / ${deg(t[1])} °C` : "χωρίς αισθητήρα");

function Steps({ at }: { at: 1 | 2 }) {
  const items = ["Τι σημείο είναι", "Εξοπλισμός", "Ετοιμότητα"];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {items.map((label, i) => (
        <li key={label} className={`flex items-center gap-2 rounded-full border px-3 py-1 ${i + 1 === at ? "border-primary font-semibold" : "border-transparent text-muted-foreground"}`}>
          <span className={`grid size-5 place-items-center rounded-full text-xs ${i + 1 < at ? "bg-emerald-600 text-white" : i + 1 === at ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{i + 1 < at ? <Check className="size-3" /> : i + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

function Stepper({ value, onChange, max, label }: { value: number; onChange: (n: number) => void; max: number; label: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className={btn("outline", "sm", "w-9 px-0 has-[>svg]:px-0")} aria-label={`Λιγότερα: ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)}><Minus /></button>
      <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{value}</span>
      <button type="button" className={btn("outline", "sm", "w-9 px-0 has-[>svg]:px-0")} aria-label={`Περισσότερα: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus /></button>
    </div>
  );
}

function Row({ icon: Icon, title, hint, badge, children }: { icon: LucideIcon; title: string; hint: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-40 flex-1"><p className="font-medium">{title}</p><p className="text-xs text-muted-foreground">{hint}</p></div>
      {badge}
      {children}
    </li>
  );
}

const Group = ({ icon: Icon, title, note }: { icon: LucideIcon; title: string; note: string }) => (
  <li className="flex items-center gap-2 bg-muted/50 px-4 py-2 text-sm font-semibold"><Icon className="size-4" aria-hidden />{title}<span className="font-normal text-muted-foreground">· {note}</span></li>
);

export function SetupWizard({ issuers }: { issuers: { id: string; label: string }[] }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<StoreKind>("SHOP_TABLES");
  const [plan, setPlan] = useState<Plan>(structuredClone(TEMPLATES.SHOP_TABLES.plan));
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [issuer, setIssuer] = useState("");
  const pick = (k: StoreKind) => { setKind(k); setPlan(structuredClone(TEMPLATES[k].plan)); };
  const set = (patch: Partial<Plan>) => setPlan((p) => ({ ...p, ...patch }));
  const setZone = (i: number, patch: Partial<Plan["zones"][number]>) => set({ zones: plan.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });
  const e = expand(plan);
  const problems = planProblems(plan);
  const devices = e.tills.length;
  const seats = e.tables.reduce((s, t) => s + t.seats, 0);

  if (step === 1) {
    return (
      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-60 flex-1"><h2 className="text-xl font-semibold">Νέο σημείο</h2><p className="text-sm text-muted-foreground">Διάλεξε τι μοιάζει περισσότερο. Όλα αλλάζουν στο επόμενο βήμα</p></div>
          <Steps at={1} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Πρότυπο σημείου">
          {KIND_ORDER.map((k) => {
            const t = TEMPLATES[k];
            const Icon = KIND_ICON[k];
            const on = k === kind;
            return (
              <button key={k} type="button" role="radio" aria-checked={on} onClick={() => pick(k)} className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors hover:bg-muted/40 ${on ? "border-2 border-primary" : "border-border"}`}>
                <span className="flex items-center gap-2 font-semibold"><Icon className="size-5" aria-hidden />{t.label}</span>
                {on ? <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700"><Check className="size-3" />Επιλεγμένο</span> : null}
                <ul className="space-y-1 text-sm text-muted-foreground">{t.lines.map((l) => <li key={l}>· {l}</li>)}</ul>
                <span className="mt-auto border-t border-border/70 pt-2 text-xs text-muted-foreground">{t.example}</span>
              </button>
            );
          })}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm font-medium">Όνομα σημείου<input value={name} onChange={(ev) => setName(ev.target.value)} required minLength={2} maxLength={60} placeholder="π.χ. Δορυλαίου" className={field} /><span className="block text-xs font-normal text-muted-foreground">Έτσι το βλέπουν οι υπάλληλοι στο ταμείο</span></label>
          <label className="space-y-1 text-sm font-medium">Διεύθυνση<input value={address} onChange={(ev) => setAddress(ev.target.value)} maxLength={120} placeholder="π.χ. Δορυλαίου 2, Αθήνα" className={field} /></label>
          <label className="space-y-1 text-sm font-medium">Εκδότης αποδείξεων<select value={issuer} onChange={(ev) => setIssuer(ev.target.value)} className={field}>{issuers.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select><span className="block text-xs font-normal text-muted-foreground">Άλλαξέ το αν το σημείο έχει δικό του ΑΦΜ</span></label>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto text-sm text-muted-foreground">Το πρότυπο ορίζει τι θα φτιαχτεί. Τίποτα δεν αποθηκεύεται πριν το πατήσεις στο επόμενο βήμα</p>
          <button type="button" className={btn("default")} disabled={name.trim().length < 2} onClick={() => setStep(2)}>Συνέχεια στον εξοπλισμό <ArrowRight /></button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-60 flex-1"><h2 className="text-xl font-semibold">{name.trim()} · Εξοπλισμός</h2><p className="text-sm text-muted-foreground">Κάθε ψυγείο είναι και αποθήκη: έχει δικό του απόθεμα και όρια θερμοκρασίας για το HACCP</p></div>
        <Steps at={2} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border">
          <Group icon={Snowflake} title="Ψυγεία και χώροι" note={`${e.spaces.length} αποθήκες`} />
          {SPACE_ORDER.map((k) => (
            <Row key={k} icon={SPACE_ICON[k]} title={SPACE[k].label} hint={SPACE[k].hint} badge={<span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{temp(SPACE[k].temp)}</span>}>
              <Stepper label={SPACE[k].label} value={plan.spaces[k]} max={LIMITS.space} onChange={(n) => set({ spaces: { ...plan.spaces, [k]: n } })} />
            </Row>
          ))}
          <Group icon={TabletSmartphone} title="Ταμεία και εκτυπωτές" note={`${devices} ταμεία, ${e.printers.length} εκτυπωτές`} />
          <Row icon={TabletSmartphone} title="Κεντρικό ταμείο" hint={`Android με Viva POS · πουλά από: ${e.sellFrom ?? "—"}`}><Stepper label="Κεντρικά ταμεία" value={plan.tills} max={LIMITS.devices} onChange={(n) => set({ tills: n })} /></Row>
          <Row icon={Smartphone} title="Φορητό ταμείο" hint="Παραγγελία και πληρωμή στο τραπέζι"><Stepper label="Φορητά ταμεία" value={plan.handhelds} max={LIMITS.devices} onChange={(n) => set({ handhelds: n })} /></Row>
          <Row icon={Printer} title="Εκτυπωτής αποδείξεων" hint="Θερμικός 80 mm, δίπλα στο ταμείο"><Stepper label="Εκτυπωτές αποδείξεων" value={plan.receiptPrinters} max={LIMITS.printers} onChange={(n) => set({ receiptPrinters: n })} /></Row>
          <Row icon={ChefHat} title="Εκτυπωτής παραγγελιών" hint="Στον πάγκο: τυπώνει ό,τι στέλνεται από τα τραπέζια"><Stepper label="Εκτυπωτές παραγγελιών" value={plan.orderPrinters} max={LIMITS.printers} onChange={(n) => set({ orderPrinters: n })} /></Row>
          <Group icon={LayoutGrid} title="Τραπέζια" note={`${e.tables.length} τραπέζια, ${seats} θέσεις`} />
          {plan.zones.map((z, i) => (
            <li key={i} className="grid grid-cols-[1fr_4.5rem_auto] items-end gap-2 px-4 py-3 sm:grid-cols-[1fr_4.5rem_auto_auto_auto]">
              <label className="space-y-1 text-xs text-muted-foreground">Ζώνη<input value={z.name} onChange={(ev) => setZone(i, { name: ev.target.value })} maxLength={30} className={field} /></label>
              <label className="space-y-1 text-xs text-muted-foreground">Πρόθεμα<input value={z.prefix} onChange={(ev) => setZone(i, { prefix: ev.target.value.toUpperCase() })} maxLength={3} placeholder="—" className={field} /></label>
              <button type="button" className={btn("ghost", "sm", "w-9 px-0 has-[>svg]:px-0")} aria-label={`Αφαίρεση ζώνης ${z.name}`} onClick={() => set({ zones: plan.zones.filter((_, j) => j !== i) })}><Trash2 /></button>
              <div className="space-y-1 text-xs text-muted-foreground">Τραπέζια<Stepper label={`Τραπέζια ${z.name}`} value={z.count} max={LIMITS.tablesPerZone} onChange={(n) => setZone(i, { count: n })} /></div>
              <div className="space-y-1 text-xs text-muted-foreground">Θέσεις<Stepper label={`Θέσεις ανά τραπέζι ${z.name}`} value={z.seats} max={LIMITS.seats} onChange={(n) => setZone(i, { seats: n })} /></div>
            </li>
          ))}
          <Row icon={Plus} title="Νέα ζώνη" hint="π.χ. Πεζοδρόμιο, Ταράτσα, Αυλή">
            <button type="button" className={btn("outline", "sm")} disabled={plan.zones.length >= LIMITS.zones} onClick={() => set({ zones: [...plan.zones, { name: plan.zones.length ? "Πεζοδρόμιο" : "Σάλα", prefix: plan.zones.length ? "Ε" : "", count: 4, seats: 2 }] })}>Προσθήκη</button>
          </Row>
        </ul>

        <section className="space-y-4 self-start rounded-xl border border-border bg-muted/30 p-4" aria-label="Τι θα φτιαχτεί">
          <div className="flex flex-wrap items-baseline gap-2"><h3 className="flex-1 text-lg font-semibold">Τι θα φτιαχτεί</h3><span className="text-xs text-muted-foreground">{e.spaces.length} αποθήκες · {devices} ταμεία · {e.printers.length} εκτυπωτές · {e.tables.length} τραπέζια</span></div>
          {e.spaces.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {e.spaces.map((s) => <div key={s.name} className={`rounded-lg border border-l-4 border-border bg-card px-2.5 py-1.5 ${tempTone(s.temp)}`}><p className="truncate text-sm font-medium" title={s.name}>{s.name}</p><p className="text-xs text-muted-foreground tabular-nums">{s.temp ? temp(s.temp) : "—"}</p></div>)}
            </div>
          ) : null}
          {e.tills.length || e.printers.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {e.tills.map((t) => <div key={t.name} className="rounded-lg bg-primary px-2.5 py-1.5 text-primary-foreground"><p className="truncate text-sm font-medium">{t.name}</p><p className="text-xs opacity-80">{t.handheld ? "στα τραπέζια" : `πουλά από: ${e.sellFrom ?? "—"}`}</p></div>)}
              {e.printers.map((p) => <div key={p.name} className="rounded-lg border border-border bg-card px-2.5 py-1.5"><p className="truncate text-sm font-medium" title={p.name}>{p.name}</p><p className="text-xs text-muted-foreground">{p.role === "RECEIPTS" ? "USB στο ταμείο" : "στο δίκτυο"}</p></div>)}
            </div>
          ) : null}
          {plan.zones.map((z) => (
            <div key={z.name + z.prefix}>
              <p className="mb-1 flex justify-between text-sm"><span className="font-medium">{z.name || "Χωρίς όνομα"}</span><span className="text-muted-foreground tabular-nums">{z.count} × {z.seats} θέσεις</span></p>
              <div className="flex flex-wrap gap-1.5">{e.tables.filter((t) => t.zone === z.name.trim()).map((t) => <span key={t.position} className="grid h-9 min-w-9 place-items-center rounded-md border border-border bg-card px-1.5 text-sm tabular-nums">{t.name}</span>)}</div>
            </div>
          ))}
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-sky-600" />κατάψυξη</span><span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-emerald-600" />ψύξη</span><span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-amber-700/60" />ξηρό</span><span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-primary" />ταμείο</span></p>
          <p className="border-l-2 border-amber-500 pl-3 text-xs text-muted-foreground">Τα όρια θερμοκρασίας μπαίνουν από το είδος του ψυγείου. Αλλάζουν μετά από τη σελίδα κάθε συσκευής</p>
        </section>
      </div>

      {problems.length ? (
        <ul role="alert" className="space-y-1 rounded-lg border border-red-600/30 bg-red-600/5 p-3 text-sm text-red-800 dark:text-red-300">
          {problems.map((p) => <li key={p} className="flex gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{p}</li>)}
        </ul>
      ) : null}
      <form action={createStore} className="flex flex-wrap items-center justify-between gap-3">
        <input type="hidden" name="name" value={name} /><input type="hidden" name="address" value={address} /><input type="hidden" name="legalEntityId" value={issuer} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="plan" value={JSON.stringify(plan)} />
        <button type="button" className={btn("ghost")} onClick={() => setStep(1)}><ArrowLeft /> Πίσω</button>
        <Submit className={btn("default")} disabled={problems.length > 0}>Δημιουργία και έλεγχος <ArrowRight /></Submit>
      </form>
    </Card>
  );
}
