import { Building2, CircleAlert, CircleCheck, CreditCard, Plus, TabletSmartphone, Users } from "lucide-react";
import Link from "next/link";
import { requirePlatform } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { StatusBadge } from "@/components/status-badge";
import { btn, Card, Field, menuItem, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { DEVICE_KIND } from "@/lib/devices";
import { defaultPlan, toPlanRow } from "@/lib/plan-data";
import { monthlyPreview } from "@/lib/plans";
import { setupSteps } from "@/lib/setup";
import { vivaConfigured, vivaEnv } from "@/lib/viva/cloud-terminal";
import { checkViva, createOrganization } from "./actions";
import { look, statusOptions } from "@/lib/status";
import { Submit } from "@/components/submit";

export default async function PlatformPage({ searchParams }: PageProps<"/platform">) {
  const me = await requirePlatform("orgs.read");
  const q = await searchParams;
  const list = listParams(q, 25, ["org", "until"]);
  const status = filterParam(q, "status", ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"]);
  const orderBy = list.sort === "org" ? { name: list.dir } : list.sort === "until" ? { subscription: { currentPeriodEnd: list.dir } } : { createdAt: "desc" as const };
  const include = { subscription: { include: { plan: true } }, members: { select: { id: true } }, stores: { include: { warehouses: { include: { warehouse: { select: { active: true } } } }, devices: true, pauses: { where: { endedAt: null }, select: { id: true } } } } } as const;
  const where = {
    ...(list.q ? { OR: [{ name: { contains: list.q, mode: "insensitive" as const } }, { vatNumber: { contains: list.q } }, { slug: { contains: list.q.toLowerCase() } }] } : {}),
    ...(status ? { subscription: { status } } : {}),
  };
  // Τα σύνολα της κορυφής αφορούν ΟΛΕΣ τις επιχειρήσεις· ο πίνακας μόνο τη σελίδα/αναζήτηση.
  // shortcut: τα σύνολα φορτώνουν όλες τις επιχειρήσεις· πάνω από μερικές εκατοντάδες, να γίνουν ερώτημα άθροισης.
  const [orgs, pageOrgs, total] = await Promise.all([
    db.organization.findMany({ include }),
    db.organization.findMany({ where, orderBy, skip: list.skip, take: list.take, include }),
    db.organization.count({ where }),
  ]);
  const fallback = await defaultPlan();
  const summarize = (o: (typeof orgs)[number]) => {
    const stores = o.stores.filter((s) => s.active);
    const devices = stores.flatMap((s) => s.devices).filter((d) => d.active && DEVICE_KIND[d.kind].invoices).length;
    const plan = o.subscription?.plan ? toPlanRow(o.subscription.plan) : fallback;
    const steps = setupSteps({ ...o, stores: o.stores.map((s) => ({ ...s, warehouses: s.warehouses.map((l) => l.warehouse) })) });
    return { o, stores: stores.length, devices, plan: plan.name, cents: monthlyPreview(plan, stores.map((s) => ({ id: s.id, name: s.name, deviceKinds: s.devices.filter((d) => d.active).map((d) => d.kind as string), paused: s.pauses.length > 0 }))).totalCents, missing: steps.filter((s) => !s.done).length };
  };
  const all = orgs.map(summarize);
  const rows = pageOrgs.map(summarize);
  const active = all.filter((r) => r.o.subscription?.status === "ACTIVE");
  const tiles = [
    { label: "Μηνιαία έσοδα", value: euro(active.reduce((s, r) => s + r.cents, 0)), hint: `από ${active.length} ενεργές συνδρομές, προ ΦΠΑ` },
    { label: "Επιχειρήσεις", value: String(all.length), hint: `${all.filter((r) => r.o.subscription?.status === "TRIALING").length} σε δοκιμή` },
    { label: "Θέλουν αρχικοποίηση", value: String(all.filter((r) => r.missing).length), hint: "δεν μπορούν ακόμα να εκδώσουν απόδειξη" },
  ];
  const [isv, env] = await Promise.all([vivaConfigured(), vivaEnv()]);

  return (
    <Page section="Πλατφόρμα" title="Συνδρομητές" description="Οι επιχειρήσεις που χρησιμοποιούν το Gelato System και η ετοιμότητά τους" actions={
        me.can("orgs.add") && <Modal label={<><Plus /> Νέα επιχείρηση</>} variant="default" title="Νέα επιχείρηση" description="Δημιουργείται μαζί η έδρα, μια κεντρική αποθήκη, το πρώτο ταμείο (σειρά A1) και δοκιμαστική συνδρομή. Στέλνεται email καλωσορίσματος.">
          <form action={createOrganization} className="grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end">
            <Field label="Επωνυμία" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Gelateria Aurora" />
            <Field label="ΑΦΜ" name="vatNumber" required inputMode="numeric" pattern="\d{9}" maxLength={9} hint="9 ψηφία. Δεν αλλάζει μετά." />
            <Field label="Υποτομέας" name="slug" required pattern="[a-z0-9][a-z0-9-]{1,28}[a-z0-9]" placeholder="aurora" hint="Μικρά λατινικά, αριθμοί, παύλες" />
            <Field label="Email επικοινωνίας" name="contactEmail" type="email" required hint="Καλωσόρισμα και χρεώσεις συνδρομής" />
            <Field label="Όνομα πρώτου καταστήματος" name="storeName" required minLength={2} maxLength={60} placeholder="π.χ. Κατάστημα Πειραιά" />
            <Field label="Διεύθυνση καταστήματος" name="storeAddress" maxLength={120} hint="Τυπώνεται στην απόδειξη" />
            <Field label="Ημέρες δοκιμής" name="trialDays" type="number" min={0} max={90} defaultValue={14} required />
            <Submit className={btn("default")}>Δημιουργία</Submit>
          </form>
        </Modal>
      }>
      {q.error && !q.viva ? <p role="alert" className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν δημιουργήθηκε: {String(q.error)}</p> : null}
      <div className="grid gap-4 md:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.label} className="p-5">
            <p className="text-sm font-medium text-muted-foreground">{t.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{t.value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-4 flex flex-wrap items-center gap-4 p-5">
        {isv ? <CircleCheck className="size-6 shrink-0 text-success" /> : <CircleAlert className="size-6 shrink-0 text-gold" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">Λογαριασμός Viva ISV</h2>
          <p className="text-sm text-muted-foreground">
            {isv
              ? `Τα κλειδιά έχουν οριστεί · περιβάλλον ${env === "production" ? "παραγωγής" : "demo"}. Με αυτά γίνονται οι πληρωμές και η τιμολόγηση όλων των επιχειρήσεων.`
              : "Δεν έχουν οριστεί κλειδιά. Ορίζονται στις Ρυθμίσεις & email › Viva ISV. Μέχρι τότε όλα τα ταμεία είναι σε δοκιμαστική λειτουργία."}
          </p>
          {q.viva === "ok" ? <p className="mt-1 text-sm font-semibold text-success">Η Viva δέχτηκε τα κλειδιά</p> : null}
          {q.viva === "fail" ? <p className="mt-1 text-sm font-semibold text-destructive">Η δοκιμή απέτυχε: {String(q.error ?? "")}</p> : null}
        </div>
        <form action={checkViva}><Submit className={btn("outline")}>Δοκιμή σύνδεσης</Submit></form>
      </Card>

      <Card className="mt-4">
        <DataTable
          id="subscribers"
          listing={{ ...list, total, placeholder: "Επωνυμία, ΑΦΜ ή υποτομέας", filters: [{ key: "status", label: "Συνδρομή", value: status, options: statusOptions("subscription") }] }}
          empty="Καμία επιχείρηση ακόμα. Πάτησε «Νέα επιχείρηση»."
          columns={[
            { key: "org", label: "Επιχείρηση", required: true, sortable: true },
            { key: "status", label: "Συνδρομή" },
            { key: "until", label: "Λήξη", sortable: true },
            { key: "stores", label: "Καταστήματα", numeric: true },
            { key: "devices", label: "Ταμεία", numeric: true },
            { key: "monthly", label: "Ανά μήνα", numeric: true },
            { key: "setup", label: "Αρχικοποίηση" },
          ]}
          rows={rows.map(({ o, stores, devices, cents, missing }) => ({
            id: o.id,
            cells: {
              org: <><Link href={`/platform/${o.id}`} className="font-semibold underline-offset-2 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">{o.name}</Link><span className="block text-xs text-muted-foreground">ΑΦΜ {o.vatNumber}{o.slug ? ` · ${o.slug}` : ""}</span></>,
              status: o.closingAt ? <StatusBadge look={look("danger", "Κλείνει")} /> : o.suspendedAt ? <StatusBadge look={look("danger", "Σε αναστολή")} /> : o.subscription ? <StatusBadge kind="subscription" value={o.subscription.status} /> : "—",
              until: o.subscription?.currentPeriodEnd.toLocaleDateString("el-GR") ?? "—",
              stores,
              devices,
              monthly: euro(cents),
              setup: missing ? <StatusBadge look={look("warning", `Λείπουν ${missing}`)} /> : <StatusBadge look={look("success", "Έτοιμη")} />,
            },
            menu: (
              <>
                <Link href={`/platform/${o.id}`} role="menuitem" className={menuItem}><Building2 /> Καρτέλα επιχείρησης</Link>
                <Link href={`/platform/${o.id}#subscription`} role="menuitem" className={menuItem}><CreditCard /> Συνδρομή και χρεώσεις</Link>
                <Link href={`/platform/${o.id}#devices`} role="menuitem" className={menuItem}><TabletSmartphone /> Ταμεία και σύζευξη</Link>
                <Link href={`/platform/${o.id}#users`} role="menuitem" className={menuItem}><Users /> Χρήστες</Link>
              </>
            ),
          }))}
        />
      </Card>
    </Page>
  );
}
