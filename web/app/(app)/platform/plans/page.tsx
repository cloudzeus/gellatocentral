import { Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEVICE_KIND } from "@/lib/devices";
import { MODULES, type ModuleKey } from "@/lib/modules";
import { euro } from "@/lib/money";
import { toPlanRow } from "@/lib/plan-data";
import { MIN_PAUSE_DAYS, pausedMonthly, storeMonthly } from "@/lib/plans";
import { deletePlan, savePlan, setDefaultPlan, togglePlan } from "../actions";

const KINDS = Object.entries(DEVICE_KIND) as [keyof typeof DEVICE_KIND, (typeof DEVICE_KIND)[keyof typeof DEVICE_KIND]][];
const eur = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
type Row = ReturnType<typeof toPlanRow> & { description: string | null };

/** Η φόρμα ενός πακέτου: τιμές, ενότητες (στο πακέτο και στην παύση) και κανόνες παύσης. */
function PlanForm({ plan }: { plan?: Row }) {
  return (
    <form action={savePlan} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="planId" value={plan?.id ?? ""} />
      <Field label="Όνομα" name="name" required minLength={2} maxLength={60} defaultValue={plan?.name} placeholder="π.χ. Εργαστήριο" />
      <Field label="Τιμή ανά κατάστημα (€ τον μήνα)" name="storeCents" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" defaultValue={eur(plan?.storeCents ?? 0)} />
      <div className="sm:col-span-2"><Field label="Περιγραφή" name="description" maxLength={200} defaultValue={plan?.description ?? ""} placeholder="Για ποιον είναι το πακέτο" /></div>

      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-semibold">Ενότητες</legend>
        <div className="mt-2 overflow-x-auto rounded-lg border border-border/70">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-semibold">Ενότητα</th><th className="px-3 py-2 text-center font-semibold">Ανοιχτή στο πακέτο</th><th className="px-3 py-2 text-center font-semibold">Ανοιχτή στην παύση</th></tr></thead>
            <tbody>
              {(Object.keys(MODULES) as ModuleKey[]).map((k) => (
                <tr key={k} className="border-t border-border/70">
                  <td className="px-3 py-1.5"><span className="font-medium">{MODULES[k].label}</span><span className="block text-xs text-muted-foreground">{MODULES[k].hint}</span></td>
                  <td className="px-3 py-1.5 text-center"><input type="checkbox" name="modules" value={k} aria-label={`${MODULES[k].label}: ανοιχτή στο πακέτο`} defaultChecked={plan ? plan.modules.includes(k) : true} className="size-4 accent-[var(--primary)]" /></td>
                  <td className="px-3 py-1.5 text-center"><input type="checkbox" name="pausedModules" value={k} aria-label={`${MODULES[k].label}: ανοιχτή στην παύση`} defaultChecked={plan?.pausedModules.includes(k) ?? false} className="size-4 accent-[var(--primary)]" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Συνδρομή, χρήστες, GDPR, βοήθεια και υποστήριξη είναι πάντα ανοιχτά. Ενότητα κλειστή στο πακέτο δεν ανοίγει στην παύση</p>
      </fieldset>

      <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="text-sm font-semibold">Τιμή ανά συσκευή (€ τον μήνα)</legend>
        {KINDS.map(([k, v]) => <Field key={k} label={v.label} name={`device_${k}`} required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" defaultValue={eur(plan?.devicePrices[k] ?? 0)} />)}
      </fieldset>

      <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="text-sm font-semibold">Εποχιακή παύση καταστήματος</legend>
        <Field label="Στην παύση πληρώνει (% της τιμής)" name="pausePercent" type="number" required min={0} max={100} defaultValue={plan?.pausePercent ?? 30} />
        <Field label="Έως (ημέρες τον χρόνο)" name="pauseMaxDaysPerYear" type="number" required min={0} max={365} defaultValue={plan?.pauseMaxDaysPerYear ?? 240} hint="0 = το πακέτο δεν επιτρέπει παύση" />
        <p className="text-xs text-muted-foreground sm:col-span-2">Η έκπτωση δίνεται μόνο αν η παύση κρατήσει τουλάχιστον {MIN_PAUSE_DAYS} ημέρες, και μετρά ανά ημέρα</p>
      </fieldset>
      <Submit className={`${btn("default")} sm:col-span-2 sm:justify-self-end`}>{plan ? "Αποθήκευση" : "Δημιουργία πακέτου"}</Submit>
    </form>
  );
}

export default async function PlansPage({ searchParams }: PageProps<"/platform/plans">) {
  await requirePlatform("billing.manage");
  const q = await searchParams;
  const rows = await db.plan.findMany({ orderBy: [{ isDefault: "desc" }, { active: "desc" }, { name: "asc" }], include: { _count: { select: { subscriptions: true } } } });
  const noPlan = await db.subscription.count({ where: { planId: null } });
  // παράδειγμα για να φαίνεται αμέσως τι σημαίνουν οι τιμές: 1 κατάστημα, 2 ταμεία Android, 1 ψυγείο
  const sample = ["POS_ANDROID", "POS_ANDROID", "FRIDGE"];

  return (
    <Page section="Πλατφόρμα" title="Πακέτα & τιμές" description="Τι ανοίγει κάθε πακέτο και πόσο κοστίζει κάθε κατάστημα και κάθε συσκευή. Τιμές τον μήνα, προ ΦΠΑ"
      actions={<Modal label={<><Plus /> Νέο πακέτο</>} variant="default" title="Νέο πακέτο"><PlanForm /></Modal>}>
      <div className="max-w-7xl space-y-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Τα πακέτα ενημερώθηκαν. Οι νέες τιμές ισχύουν από την επόμενη χρέωση κάθε πελάτη</p> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((r) => {
            const plan: Row = { ...toPlanRow(r), description: r.description };
            const m = storeMonthly(plan, sample);
            const customers = r._count.subscriptions + (r.isDefault ? noPlan : 0);
            return (
              <Card key={r.id} className={r.active ? "" : "opacity-70"}>
                <div className="flex flex-wrap items-start gap-3 border-b border-border/70 px-5 py-4">
                  <div className="min-w-0 basis-48 flex-1">
                    <h2 className="text-lg">{r.name} {r.isDefault ? <Badge tone="success">Προεπιλογή</Badge> : null} {r.active ? null : <Badge>Ανενεργό</Badge>}</h2>
                    <p className="text-sm text-muted-foreground">{r.description ?? "Χωρίς περιγραφή"} · {customers} {customers === 1 ? "πελάτης" : "πελάτες"}</p>
                  </div>
                  <Modal label="Αλλαγή" title={`Πακέτο «${r.name}»`} description={`${customers} πελάτες. Οι αλλαγές ισχύουν από την επόμενη χρέωσή τους`}><PlanForm plan={plan} /></Modal>
                </div>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-5 py-4 text-sm">
                  <dt>Κατάστημα</dt><dd className="text-right font-semibold tabular-nums">{euro(plan.storeCents)}</dd>
                  {KINDS.map(([k, v]) => <div key={k} className="col-span-2 grid grid-cols-subgrid text-muted-foreground"><dt>{v.label}</dt><dd className="text-right tabular-nums">{plan.devicePrices[k] ? euro(plan.devicePrices[k]) : "δωρεάν"}</dd></div>)}
                  <dt className="mt-2 border-t border-border/70 pt-2 font-medium">Παράδειγμα: 1 κατάστημα, 2 ταμεία Android, 1 ψυγείο</dt><dd className="mt-2 border-t border-border/70 pt-2 text-right font-semibold tabular-nums">{euro(m.fullCents)}</dd>
                  <dt className="text-success-ink">Το ίδιο σε παύση ({plan.pausePercent}%, έως {plan.pauseMaxDaysPerYear} ημέρες τον χρόνο)</dt><dd className="text-right font-semibold tabular-nums text-success-ink">{euro(pausedMonthly(plan, m.fullCents))}</dd>
                </dl>
                <div className="space-y-2 border-t border-border/70 px-5 py-4">
                  <p className="text-xs font-semibold text-muted-foreground">Ενότητες ({plan.modules.length} από {Object.keys(MODULES).length}) · με περίγραμμα όσες μένουν ανοιχτές στην παύση</p>
                  <p className="flex flex-wrap gap-1">{(Object.keys(MODULES) as ModuleKey[]).filter((k) => plan.modules.includes(k)).map((k) => <span key={k} className={`rounded-md px-2 py-0.5 text-2xs font-semibold ${plan.pausedModules.includes(k) ? "border border-success/50 bg-success/10 text-success-ink" : "bg-secondary text-muted-foreground"}`}>{MODULES[k].label}</span>)}</p>
                </div>
                {r.isDefault ? null : (
                <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 px-5 py-3">
                  {r.isDefault || !r.active ? null : <form action={setDefaultPlan.bind(null, r.id)}><Submit className={btn("ghost", "sm")}>Ορισμός ως προεπιλογή</Submit></form>}
                  {r.isDefault ? null : <form action={togglePlan.bind(null, r.id)}><Submit className={btn("ghost", "sm")}>{r.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form>}
                  {r.isDefault || customers ? null : <form action={deletePlan.bind(null, r.id)}><Submit className={btn("ghost", "sm")}>Διαγραφή</Submit></form>}
                </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </Page>
  );
}
