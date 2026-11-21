import { Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEVICE_KIND } from "@/lib/devices";
import { MODULES, type ModuleKey } from "@/lib/modules";
import { euro } from "@/lib/money";
import { listParams } from "@/lib/paging";
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
                  <td className="px-3 py-1.5 text-center"><Checkbox name="modules" value={k} aria-label={`${MODULES[k].label}: ανοιχτή στο πακέτο`} defaultChecked={plan ? plan.modules.includes(k) : true} /></td>
                  <td className="px-3 py-1.5 text-center"><Checkbox name="pausedModules" value={k} aria-label={`${MODULES[k].label}: ανοιχτή στην παύση`} defaultChecked={plan?.pausedModules.includes(k) ?? false} /></td>
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
      {/* η φόρμα είναι μακριά: το κουμπί μένει πάντα ορατό στο κάτω μέρος του παραθύρου */}
      <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end border-t border-border/70 bg-card px-5 py-3 sm:col-span-2">
        <Submit className={btn("default")}>{plan ? "Αποθήκευση" : "Δημιουργία πακέτου"}</Submit>
      </div>
    </form>
  );
}

export default async function PlansPage({ searchParams }: PageProps<"/platform/plans">) {
  await requirePlatform("billing.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["name", "store", "customers", "devices", "modules", "pause", "example", "status"]);
  const rows = await db.plan.findMany({ orderBy: [{ isDefault: "desc" }, { active: "desc" }, { name: "asc" }], include: { _count: { select: { subscriptions: true } } } });
  const noPlan = await db.subscription.count({ where: { planId: null } });
  // παράδειγμα για να φαίνεται αμέσως τι σημαίνουν οι τιμές: 1 κατάστημα, 2 ταμεία Android, 1 ψυγείο
  const sample = ["POS_ANDROID", "POS_ANDROID", "FRIDGE"];
  const planRows = rows.map((r) => {
    const plan: Row = { ...toPlanRow(r), description: r.description };
    const monthly = storeMonthly(plan, sample);
    const customers = r._count.subscriptions + (r.isDefault ? noPlan : 0);
    return { ...r, plan, monthly, customers };
  });
  const sorted = [...planRows].sort((a, b) => {
    if (!list.sort) return 0;
    const value = (r: (typeof planRows)[number]) => list.sort === "name" ? r.name
      : list.sort === "store" ? r.plan.storeCents
        : list.sort === "customers" ? r.customers
          : list.sort === "devices" ? Object.values(r.plan.devicePrices).reduce((sum, cents) => sum + cents, 0)
            : list.sort === "modules" ? r.plan.modules.length
              : list.sort === "pause" ? r.plan.pausePercent
                : list.sort === "example" ? r.monthly.fullCents
                  : Number(r.active) * 2 + Number(r.isDefault);
    const av = value(a), bv = value(b);
    const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
    return list.dir === "asc" ? result : -result;
  });

  return (
    <Page section="Πλατφόρμα" title="Πακέτα & τιμές" description="Τι ανοίγει κάθε πακέτο και πόσο κοστίζει κάθε κατάστημα και κάθε συσκευή. Τιμές τον μήνα, προ ΦΠΑ"
      actions={<Modal label={<><Plus /> Νέο πακέτο</>} variant="default" title="Νέο πακέτο"><PlanForm /></Modal>}>
      <div className="max-w-7xl space-y-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Τα πακέτα ενημερώθηκαν. Οι νέες τιμές ισχύουν από την επόμενη χρέωση κάθε πελάτη</p> : null}

        <Card>
          <DataTable
            id="platform-plans"
            listing={{ ...list, total: sorted.length, placeholder: "Πακέτο…", showSearch: false }}
            empty="Κανένα πακέτο συνδρομής"
            columns={[
              { key: "name", label: "Πακέτο", required: true, sortable: true },
              { key: "store", label: "Κατάστημα / μήνα", numeric: true, sortable: true },
              { key: "devices", label: "Συσκευές / μήνα", numeric: true, sortable: true },
              { key: "modules", label: "Ενότητες", numeric: true, sortable: true },
              { key: "customers", label: "Πελάτες", numeric: true, sortable: true },
              { key: "pause", label: "Παύση", numeric: true, sortable: true },
              { key: "example", label: "Παράδειγμα", numeric: true, sortable: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={sorted.slice(list.skip, list.skip + list.take).map((r) => ({
              id: r.id,
              cells: {
                name: <><span className="font-semibold">{r.name}</span><span className="block text-xs font-normal text-muted-foreground">{r.description ?? "Χωρίς περιγραφή"}</span></>,
                store: euro(r.plan.storeCents),
                devices: KINDS.map(([k, v]) => `${v.label}: ${r.plan.devicePrices[k] ? euro(r.plan.devicePrices[k]) : "δωρεάν"}`).join(" · "),
                modules: `${r.plan.modules.length} / ${Object.keys(MODULES).length}`,
                customers: r.customers,
                pause: `${r.plan.pausePercent}% · έως ${r.plan.pauseMaxDaysPerYear} ημέρες`,
                example: euro(r.monthly.fullCents),
                status: <span className="inline-flex flex-wrap gap-1">{r.isDefault ? <Badge tone="success">Προεπιλογή</Badge> : null}{r.active ? <Badge>Ενεργό</Badge> : <Badge tone="warning">Ανενεργό</Badge>}</span>,
              },
              details: {
                label: r.name,
                view: <div className="grid gap-5 lg:grid-cols-2">
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
                    <dt>Κατάστημα</dt><dd className="text-right font-semibold tabular-nums">{euro(r.plan.storeCents)}</dd>
                    {KINDS.map(([k, v]) => <div key={k} className="col-span-2 grid grid-cols-subgrid text-muted-foreground"><dt>{v.label}</dt><dd className="text-right tabular-nums">{r.plan.devicePrices[k] ? euro(r.plan.devicePrices[k]) : "δωρεάν"}</dd></div>)}
                    <dt className="mt-2 border-t border-border/70 pt-2 font-medium">Παράδειγμα: 1 κατάστημα, 2 ταμεία Android, 1 ψυγείο</dt><dd className="mt-2 border-t border-border/70 pt-2 text-right font-semibold tabular-nums">{euro(r.monthly.fullCents)}</dd>
                    <dt className="text-success-ink">Το ίδιο σε παύση</dt><dd className="text-right font-semibold tabular-nums text-success-ink">{euro(pausedMonthly(r.plan, r.monthly.fullCents))}</dd>
                  </dl>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Ενότητες · με περίγραμμα όσες μένουν ανοιχτές στην παύση</p>
                    <p className="flex flex-wrap gap-1">{(Object.keys(MODULES) as ModuleKey[]).filter((k) => r.plan.modules.includes(k)).map((k) => <span key={k} className={`rounded-md px-2 py-0.5 text-2xs font-semibold ${r.plan.pausedModules.includes(k) ? "border border-success/50 bg-success/10 text-success-ink" : "bg-secondary text-muted-foreground"}`}>{MODULES[k].label}</span>)}</p>
                    <p className="text-sm text-muted-foreground">{r.customers} {r.customers === 1 ? "πελάτης" : "πελάτες"} · παύση {r.plan.pausePercent}% έως {r.plan.pauseMaxDaysPerYear} ημέρες τον χρόνο</p>
                  </div>
                </div>,
                edit: <PlanForm plan={r.plan} />,
              },
              menu: <>
                {!r.isDefault && r.active ? <form action={setDefaultPlan.bind(null, r.id)}><Submit className={menuItem}>Ορισμός ως προεπιλογή</Submit></form> : null}
                {!r.isDefault ? <form action={togglePlan.bind(null, r.id)}><Submit className={menuItem}>{r.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form> : null}
                {!r.isDefault && !r.customers ? <form action={deletePlan.bind(null, r.id)}><Submit className={menuItem}>Διαγραφή</Submit></form> : null}
              </>,
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
