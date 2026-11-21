import { Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { activateUsagePrices, hideUsagePrices, saveUsagePrice, toggleUsagePrice } from "./actions";

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

// Pay-as-you-go τιμολογιακή πολιτική και συγκεντρωτική κατανάλωση τρέχοντος μήνα.
export default async function UsagePage({ searchParams }: PageProps<"/platform/usage">) {
  await requirePlatform("billing.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["service", "label", "unit", "markup", "status", "subscriber", "uses", "cost", "charge"]);
  const status = filterParam(q, "status", ["active", "hidden"]);
  const where = {
    ...(status ? { active: status === "active" } : {}),
    ...(list.q ? { OR: [{ service: { contains: list.q, mode: "insensitive" as const } }, { label: { contains: list.q, mode: "insensitive" as const } }] } : {}),
  };
  const direction = list.sort ? list.dir : "asc";
  const orderBy = list.sort === "service" ? { service: direction }
    : list.sort === "label" ? { label: direction }
      : list.sort === "unit" ? { unitLabel: direction }
        : list.sort === "markup" ? { markupPercent: direction }
          : list.sort === "status" ? { active: direction }
            : { service: "asc" as const };
  const [services, serviceTotal, active, usage, orgs] = await Promise.all([
    db.usagePrice.findMany({ where, orderBy, skip: list.skip, take: list.take }),
    db.usagePrice.count({ where }),
    db.usagePrice.count({ where: { active: true } }),
    db.usageEvent.groupBy({ by: ["orgId", "service"], where: { createdAt: { gte: monthStart() } }, _sum: { units: true, chargeCents: true, costUsd: true }, _count: { _all: true }, orderBy: { _sum: { chargeCents: "desc" } } }),
    db.organization.findMany({ select: { id: true, name: true } }),
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const labelOf = new Map(services.map((s) => [s.service, s.label]));

  const serviceForm = (s?: (typeof services)[number]) => (
    <form key={s?.service ?? "new"} action={saveUsagePrice} className="grid gap-4 [&>button]:justify-self-end">
      {s ? <input type="hidden" name="service" value={s.service} /> : null}
      <Field label="Κλειδί υπηρεσίας" name={s ? "serviceShown" : "service"} required maxLength={30} defaultValue={s?.service} disabled={Boolean(s)}
        hint={s ? "Δεν αλλάζει: με αυτό γράφονται τα UsageEvent" : "2–30 μικρά λατινικά, αριθμοί ή παύλες, π.χ. ocr"} />
      <Field label="Ονομασία" name="label" required maxLength={60} defaultValue={s?.label} hint="Πώς φαίνεται στον συνδρομητή, π.χ. «Ανάγνωση τιμολογίου (OCR)»" />
      <Field label="Μονάδα χρέωσης" name="unitLabel" required maxLength={40} defaultValue={s?.unitLabel} hint="π.χ. «ανά έγγραφο»" />
      <Field label="Markup επί του κόστους (%)" name="markupPercent" required inputMode="numeric" defaultValue={String(s?.markupPercent ?? 30)} hint="Η χρέωση = κόστος παρόχου × ισοτιμία USD→EUR × (1 + markup)" />
      <label className="flex items-center gap-2 text-sm font-medium"><Checkbox name="active" defaultChecked={s?.active ?? true} /> Ενεργή — οι συνδρομητές μπορούν να τη χρησιμοποιούν</label>
      <FormPending label="Αποθήκευση υπηρεσίας…" />
      <Submit pendingText="Αποθήκευση…" className={btn("default")}>{s ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  const usageRows = usage.map((u) => ({
    id: `${u.orgId}-${u.service}`,
    subscriber: orgName.get(u.orgId) ?? u.orgId,
    service: labelOf.get(u.service) ?? u.service,
    uses: u._sum.units ?? 0,
    cost: u._sum.costUsd ?? 0,
    charge: u._sum.chargeCents ?? 0,
  })).filter((u) => !list.q || `${u.subscriber} ${u.service}`.toLocaleLowerCase("el").includes(list.q.toLocaleLowerCase("el")));
  const usageKey = list.sort === "subscriber" ? "subscriber" : list.sort === "service" ? "service" : list.sort === "uses" ? "uses" : list.sort === "cost" ? "cost" : "charge";
  usageRows.sort((a, b) => {
    const av = a[usageKey], bv = b[usageKey];
    const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
    return list.dir === "asc" ? result : -result;
  });
  const usagePage = usageRows.slice(list.skip, list.skip + list.take);

  return (
    <Page section="Πλατφόρμα" title="Υπηρεσίες pay-as-you-go" description="Χρέωση ανά χρήση και πραγματική κατανάλωση τρέχοντος μήνα. Το markup ορίζεται κεντρικά από την πλατφόρμα">
      <div className="grid max-w-7xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Οι υπηρεσίες ενημερώθηκαν</p> : null}
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Υπηρεσίες</h2><p className="text-sm text-muted-foreground">{active} ενεργές από {serviceTotal} που ταιριάζουν</p></div>
            <Modal label={<><Plus /> Νέα υπηρεσία</>} size="sm" title="Νέα pay-as-you-go υπηρεσία">{serviceForm()}</Modal>
          </div>
          <DataTable
            id="usage-services"
            bulkActions={[
              { value: "activate", label: "Άνοιγμα επιλεγμένων", run: activateUsagePrices },
              { value: "hide", label: "Κλείσιμο επιλεγμένων", confirm: "Να σταματήσουν νέες χρήσεις στις επιλεγμένες υπηρεσίες;", run: hideUsagePrices },
            ]}
            listing={{ ...list, total: serviceTotal, placeholder: "Κλειδί ή υπηρεσία…", filters: [{ key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργές"], ["hidden", "Κλειστές"]] }] }}
            empty="Καμία υπηρεσία ακόμα. Πρόσθεσε την πρώτη με «Νέα υπηρεσία»"
            columns={[
              { key: "service", label: "Κλειδί", required: true, sortable: true },
              { key: "label", label: "Ονομασία", sortable: true },
              { key: "unit", label: "Χρέωση", sortable: true },
              { key: "markup", label: "Markup", numeric: true, sortable: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={services.map((s) => ({
              id: s.service,
              cells: {
                service: <span className="font-mono text-xs">{s.service}</span>,
                label: <span className="font-semibold">{s.label}</span>,
                unit: s.unitLabel,
                markup: `${s.markupPercent}%`,
                status: s.active ? <Badge tone="success">Ενεργή</Badge> : <Badge>Κλειστή</Badge>,
              },
              details: {
                label: s.label,
                view: <dl className="grid gap-4 sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Κλειδί</dt><dd className="font-mono text-xs">{s.service}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Μονάδα</dt><dd className="font-medium">{s.unitLabel}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Markup</dt><dd className="font-medium tabular-nums">{s.markupPercent}%</dd></div>
                </dl>,
                edit: serviceForm(s),
              },
              menu: <form action={toggleUsagePrice.bind(null, s.service)}><Submit className={menuItem}>{s.active ? "Κλείσιμο" : "Άνοιγμα"}</Submit></form>,
            }))}
          />
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Κατανάλωση τρέχοντος μήνα</h2>
            <p className="text-sm text-muted-foreground">Ανά συνδρομητή και υπηρεσία — η χρέωση μπαίνει στον επόμενο λογαριασμό συνδρομής</p>
          </div>
          <DataTable
            id="usage-current-month"
            listing={{ ...list, total: usageRows.length, placeholder: "Συνδρομητής ή υπηρεσία…", showSearch: false }}
            empty="Καμία χρήση αυτόν τον μήνα"
            columns={[
              { key: "subscriber", label: "Συνδρομητής", required: true, sortable: true },
              { key: "service", label: "Υπηρεσία", sortable: true },
              { key: "uses", label: "Χρήσεις", numeric: true, sortable: true },
              { key: "cost", label: "Κόστος (USD)", numeric: true, sortable: true },
              { key: "charge", label: "Χρέωση", numeric: true, sortable: true },
            ]}
            rows={usagePage.map((u) => ({
              id: u.id,
              cells: {
                subscriber: <span className="font-semibold">{u.subscriber}</span>,
                service: u.service,
                uses: u.uses,
                cost: `${u.cost.toFixed(4)} $`,
                charge: <span className="font-semibold">{euro(u.charge)}</span>,
              },
              details: {
                label: `${u.subscriber} · ${u.service}`,
                view: <dl className="grid gap-4 sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Χρήσεις</dt><dd className="font-medium tabular-nums">{u.uses}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Κόστος παρόχου</dt><dd className="font-medium tabular-nums">{u.cost.toFixed(4)} $</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Χρέωση</dt><dd className="font-medium tabular-nums">{euro(u.charge)}</dd></div>
                </dl>,
              },
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
