import { CircleCheck, CircleDashed, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Modal } from "@/components/modal";
import { requirePlatform } from "@/lib/auth";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { DEVICE_KIND, FOR, KIND_OPTIONS, readingStatus } from "@/lib/devices";
import { mailDomain, platformSettings } from "@/lib/mail/send";
import { euro } from "@/lib/money";
import { isBillable, monthlyCharge, PRICE_PER_DEVICE, PRICE_PER_STORE } from "@/lib/pricing";
import { setupSteps } from "@/lib/setup";
import { addDevice, addPrinter, addStore, addUser, addWarehouse, issueCharge, issuePairCode, markChargePaid, removeMember, revokeDevice, saveOrgProfile, saveSubscription, saveViva, toggleActive, updateDevice } from "../actions";
import { STATUS } from "../status";

const day = (d: Date) => d.toLocaleDateString("el-GR");
const CONNECTION = { NETWORK: "Δίκτυο", BLUETOOTH: "Bluetooth", USB: "USB" } as const;
const add = <><Plus /> Προσθήκη</>;
const edit = <><Pencil /> Αλλαγή</>;
/** Φόρμα μέσα σε παράθυρο: δύο στήλες, κουμπί αποθήκευσης κάτω δεξιά. */
const form = "grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end";

/** Ενότητα με τίτλο, εξήγηση και μία ενέργεια (παράθυρο φόρμας) πάνω δεξιά. */
function Section({ id, title, hint, saved, action, children }: { id: string; title: string; hint: string; saved: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-28">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">{title} {saved ? <span role="status" className="ml-2 text-sm font-bold text-success">Αποθηκεύτηκε</span> : null}</h2>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Row({ title, meta, active, toggle, children }: { title: string; meta: string; active: boolean; toggle: () => Promise<void>; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className={active ? "font-bold" : "font-bold text-muted-foreground line-through"}>{title}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </div>
      {children}
      <form action={toggle}><button className={btn("ghost", "sm")}>{active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</button></form>
    </li>
  );
}

/** Τιμές μόνο για ανάγνωση· αλλάζουν από το παράθυρο της ενότητας. */
function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
          <dd className="truncate font-bold">{value || <span className="font-normal text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="px-5 py-6 text-sm text-muted-foreground">{children}</p>;

export default async function OrganizationPage({ params, searchParams }: PageProps<"/platform/[orgId]">) {
  const me = await requirePlatform("orgs.view");
  const { orgId } = await params;
  const q = await searchParams;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: {
      subscription: { include: { charges: { orderBy: { periodStart: "desc" }, take: 12 } } },
      members: { orderBy: { user: { name: "asc" } }, include: { user: true, store: true, role: true } },
      roles: { orderBy: { name: "asc" } },
      stores: { orderBy: { name: "asc" }, include: { warehouses: { orderBy: { name: "asc" }, include: { device: true } }, devices: { orderBy: { createdAt: "asc" }, include: { printer: true, warehouse: true, linkedDevice: true, readings: { orderBy: { at: "desc" }, take: 1 } } }, printers: { orderBy: { name: "asc" } } } },
    },
  });
  if (!org) notFound();

  const settings = await platformSettings();
  const sub = org.subscription;
  const steps = setupSteps(org);
  const doneCount = steps.filter((s) => s.done).length;
  const stores = org.stores.filter((s) => s.active);
  const devices = stores.flatMap((s) => s.devices).filter((d) => d.active && isBillable(d.kind)).length;
  const charge = monthlyCharge(stores.length, devices);
  const storeOptions = stores.map((s): [string, string] => [s.id, s.name]);
  const printerOptions: [string, string][] = [["", "Κανένας"], ...org.stores.flatMap((s) => s.printers.filter((p) => p.active).map((p): [string, string] => [p.id, `${p.name} · ${s.name}`]))];
  const tillOptions: [string, string][] = [["", "Καμία — ζυγαριά εργαστηρίου"], ...org.stores.flatMap((s) => s.devices.filter((d) => d.active && DEVICE_KIND[d.kind].invoices).map((d): [string, string] => [d.id, `${d.name} · ${s.name}`]))];
  const hidden = <input type="hidden" name="orgId" value={org.id} />;
  const saved = (s: string) => q.saved === s;
  const save = <button className={btn("default")}>Αποθήκευση</button>;

  return (
    <Page section="Πλατφόρμα › Συνδρομητές" title={org.name} description={`ΑΦΜ ${org.vatNumber}`} actions={<Link href="/platform" className={btn("outline")}>Όλοι οι συνδρομητές</Link>}>
      <div className="mx-auto max-w-5xl space-y-4">
        {q.error ? <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">Δεν αποθηκεύτηκε: {String(q.error)}</p> : null}

        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg">{doneCount === steps.length ? "Έτοιμη να εκδώσει αποδείξεις" : "Τι λείπει για να εκδώσει αποδείξεις"}</h2>
            <p className="text-sm font-bold tabular-nums text-muted-foreground">{doneCount} από {steps.length}</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
            <div className="h-full rounded-full bg-success" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((s) => (
              <li key={s.label}>
                <a href={`#${s.fix}`} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-secondary">
                  {s.done ? <CircleCheck className="size-5 shrink-0 text-success" /> : <CircleDashed className="size-5 shrink-0 text-gold" />}
                  <span className={s.done ? "text-muted-foreground" : ""}>{s.label}</span>
                  {s.done ? null : <span className="ml-auto text-xs font-bold text-primary">Ρύθμιση</span>}
                </a>
              </li>
            ))}
          </ul>
        </Card>

        <Section
          id="profile" title="Στοιχεία & email" hint="Η διεύθυνση της επιχείρησης και ο αποστολέας των email της" saved={saved("profile")}
          action={me.can("setup.manage") && <Modal label={edit} title="Στοιχεία & email">
            <form key={[org.name, org.slug, org.contactEmail, org.emailFromName].join()} action={saveOrgProfile} className={form}>
              {hidden}
              <Field label="Επωνυμία" name="name" required minLength={2} maxLength={60} defaultValue={org.name} />
              <Field label="Υποτομέας" name="slug" required pattern="[a-z0-9][a-z0-9-]{1,28}[a-z0-9]" defaultValue={org.slug ?? ""} placeholder="aurora" hint="Μικρά λατινικά, αριθμοί, παύλες" />
              <Field label="Email επικοινωνίας" name="contactEmail" type="email" required defaultValue={org.contactEmail ?? ""} hint="Απαντήσεις πελατών και μηνύματα συνδρομής" />
              <Field label="Όνομα αποστολέα" name="emailFromName" maxLength={60} defaultValue={org.emailFromName ?? ""} placeholder={org.name} hint={`Φαίνεται ως «… μέσω ${settings.brandName}»`} />
              {save}
            </form>
          </Modal>}
        >
          <Facts items={[
            ["Διεύθυνση εφαρμογής", org.slug && settings.baseDomain ? `${org.slug}.${settings.baseDomain}` : org.slug],
            ["Αποστολέας email", org.slug ? `${org.slug}@${mailDomain() ?? "τομέας-email"}` : null],
            ["Email επικοινωνίας", org.contactEmail],
            ["Όνομα αποστολέα", org.emailFromName ?? org.name],
          ]} />
        </Section>

        <Section
          id="subscription" title="Συνδρομή" hint={`${stores.length} × ${euro(PRICE_PER_STORE)} κατάστημα + ${devices} × ${euro(PRICE_PER_DEVICE)} ταμείο = ${euro(charge.totalCents)} τον μήνα, προ ΦΠΑ`} saved={saved("subscription")}
          action={me.can("billing.manage") && <Modal label={edit} title="Συνδρομή" description="Χειροκίνητη αλλαγή. Η εξόφληση μιας χρέωσης την παρατείνει αυτόματα.">
            <form key={`${sub?.status}-${sub?.currentPeriodEnd.toISOString()}`} action={saveSubscription} className={form}>
              {hidden}
              <Select label="Κατάσταση" name="status" defaultValue={sub?.status ?? "TRIALING"} options={Object.entries(STATUS).map(([k, v]) => [k, v.text])} />
              <Field label="Ισχύει μέχρι" name="currentPeriodEnd" type="date" required defaultValue={(sub?.currentPeriodEnd ?? new Date()).toISOString().slice(0, 10)} />
              {save}
            </form>
          </Modal>}
        >
          <Facts items={[
            ["Κατάσταση", sub ? <Badge tone={STATUS[sub.status].tone}>{STATUS[sub.status].text}</Badge> : null],
            ["Ισχύει μέχρι", sub ? day(sub.currentPeriodEnd) : null],
            ["Ανά μήνα", euro(charge.totalCents)],
          ]} />
          <div className="border-t border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <p className="text-sm font-bold">Χρεώσεις</p>
              <form action={issueCharge.bind(null, org.id)}><button className={btn("outline", "sm")}>Έκδοση χρέωσης επόμενου μήνα ({euro(charge.totalCents)})</button></form>
            </div>
            {sub?.charges.length ? (
              <ul className="divide-y divide-border/70 border-t border-border/70">
                {sub.charges.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1 tabular-nums">{day(c.periodStart)} – {day(c.periodEnd)} <span className="text-muted-foreground">· {c.stores} καταστ., {c.devices} ταμεία</span></span>
                    <b className="tabular-nums">{euro(c.amountCents)}</b>
                    {c.paidAt ? <Badge tone="success">Πληρώθηκε {day(c.paidAt)}</Badge> : (
                      <form action={markChargePaid.bind(null, c.id)}><button className={btn("success", "sm")}>Πληρώθηκε</button></form>
                    )}
                  </li>
                ))}
              </ul>
            ) : <Empty>Καμία χρέωση ακόμα. Η έκδοση «φωτογραφίζει» τα σημερινά καταστήματα και ταμεία· όταν σημειωθεί πληρωμένη, η συνδρομή παρατείνεται.</Empty>}
          </div>
        </Section>

        <Section
          id="viva" title="Viva" hint="Ο έμπορος πρέπει να έχει συνδεθεί με τον λογαριασμό ISV και να έχει ενεργό το Viva Fiscal" saved={saved("viva")}
          action={me.can("setup.manage") && <Modal label={edit} title="Σύνδεση με Viva">
            <form key={org.vivaMerchantId} action={saveViva} className="grid gap-4 [&>button]:justify-self-end">
              {hidden}
              <Field label="Κωδικός εμπόρου (Merchant ID)" name="vivaMerchantId" defaultValue={org.vivaMerchantId ?? ""} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" hint="Από το Viva: Ρυθμίσεις › Πρόσβαση API. Χωρίς αυτόν τα ταμεία μένουν σε δοκιμαστική λειτουργία." />
              {save}
            </form>
          </Modal>}
        >
          <Facts items={[["Κωδικός εμπόρου", org.vivaMerchantId], ["Λειτουργία ταμείων", org.vivaMerchantId ? "Κανονική" : "Δοκιμαστική"]]} />
        </Section>

        <Section
          id="stores" title="Υποκαταστήματα" hint={`Κάθε ενεργό κατάστημα χρεώνεται ${euro(PRICE_PER_STORE)} τον μήνα`} saved={saved("stores")}
          action={me.can("setup.manage") && <Modal label={add} title="Νέο υποκατάστημα" description={`Προσθέτει ${euro(PRICE_PER_STORE)} τον μήνα στη συνδρομή`}>
            <form action={addStore} className={form}>{hidden}
              <Field label="Όνομα" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Κατάστημα Τήνου" />
              <Field label="Διεύθυνση" name="address" maxLength={120} hint="Τυπώνεται στην απόδειξη" />
              <Field label="Πηγή πληρωμών Viva" name="vivaSourceCode" maxLength={20} placeholder="προαιρετικό" />
              <button className={btn("default")}>Προσθήκη καταστήματος</button>
            </form>
          </Modal>}
        >
          <ul className="divide-y divide-border/70">
            {org.stores.map((s) => <Row key={s.id} title={s.name} meta={[s.address ?? "Χωρίς διεύθυνση", s.vivaSourceCode && `πηγή Viva ${s.vivaSourceCode}`].filter(Boolean).join(" · ")} active={s.active} toggle={toggleActive.bind(null, org.id, "stores", s.id)} />)}
          </ul>
        </Section>

        <Section
          id="warehouses" title="Αποθήκες" hint="Οι χώροι όπου τηρείται απόθεμα σε κάθε κατάστημα" saved={saved("warehouses")}
          action={me.can("setup.manage") && <Modal label={add} title="Νέα αποθήκη">
            <form action={addWarehouse} className={form}>{hidden}
              <Field label="Όνομα" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Κατάψυξη" />
              <Select label="Κατάστημα" name="storeId" options={storeOptions} />
              <button className={btn("default")}>Προσθήκη αποθήκης</button>
            </form>
          </Modal>}
        >
          {org.stores.some((s) => s.warehouses.length) ? (
            <ul className="divide-y divide-border/70">
              {org.stores.flatMap((s) => s.warehouses.map((w) => <Row key={w.id} title={w.name} meta={w.device ? `${s.name} · είναι η συσκευή «${w.device.name}»` : s.name} active={w.active} toggle={toggleActive.bind(null, org.id, "warehouses", w.id)} />))}
            </ul>
          ) : <Empty>Καμία αποθήκη ακόμα.</Empty>}
        </Section>

        <Section
          id="printers" title="Εκτυπωτές" hint="Θερμικοί εκτυπωτές αποδείξεων. Δένονται με ταμείο στην επόμενη ενότητα." saved={saved("printers")}
          action={me.can("setup.manage") && <Modal label={add} title="Νέος εκτυπωτής">
            <form action={addPrinter} className={form}>{hidden}
              <Field label="Όνομα" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Εκτυπωτής πάγκου" />
              <Select label="Κατάστημα" name="storeId" options={storeOptions} />
              <Select label="Σύνδεση" name="connection" options={Object.entries(CONNECTION)} />
              <Field label="Διεύθυνση" name="address" maxLength={40} placeholder="192.168.1.50:9100" hint="IP για δίκτυο, MAC για Bluetooth, κενό για USB" />
              <Select label="Πλάτος χαρτιού" name="paperWidth" defaultValue="80" options={[["80", "80 mm"], ["58", "58 mm"]]} />
              <button className={btn("default")}>Προσθήκη εκτυπωτή</button>
            </form>
          </Modal>}
        >
          {org.stores.some((s) => s.printers.length) ? (
            <ul className="divide-y divide-border/70">
              {org.stores.flatMap((s) => s.printers.map((p) => <Row key={p.id} title={p.name} meta={`${s.name} · ${CONNECTION[p.connection]}${p.address ? ` ${p.address}` : ""} · ${p.paperWidth} mm`} active={p.active} toggle={toggleActive.bind(null, org.id, "printers", p.id)} />))}
            </ul>
          ) : <Empty>Κανένας εκτυπωτής ακόμα.</Empty>}
        </Section>

        <Section
          id="devices" title="Συσκευές" hint={`Ταμεία, οθόνες κουζίνας, ψυγεία, αυτόματοι πωλητές και ζυγαριές. Χρεώνονται μόνο τα ταμεία: ${euro(PRICE_PER_DEVICE)} τον μήνα το καθένα.`} saved={saved("devices")}
          action={me.can("setup.manage") && <Modal label={add} title="Νέα συσκευή" description="Διάλεξε είδος· η φόρμα δείχνει μόνο όσα χρειάζεται">
            <form action={addDevice} data-by-kind className={form}>{hidden}
              <Select label="Είδος" name="kind" options={KIND_OPTIONS} />
              <Field label="Όνομα" name="name" required minLength={2} maxLength={40} placeholder="π.χ. Ταμείο 2 ή Καταψύκτης εργαστηρίου" />
              <Select label="Κατάστημα" name="storeId" options={storeOptions} />
              <div data-for={FOR.invoicing}><Field label="Σειρά αποδείξεων" name="series" pattern="[A-Za-z0-9]{1,6}" placeholder="π.χ. A2" hint={`Μοναδική, δεν αλλάζει μετά. Το ταμείο προσθέτει ${euro(PRICE_PER_DEVICE)} τον μήνα.`} /></div>
              <div data-for={FOR.invoicing}><Field label="Τερματικό Viva (Terminal ID)" name="vivaTerminalId" maxLength={20} placeholder="π.χ. 16000010" /></div>
              <div data-for={`${FOR.invoicing} KITCHEN_DISPLAY`}><Select label="Εκτυπωτής" name="printerId" options={printerOptions} /></div>
              <div data-for={FOR.storage}><Field label="Κάτω όριο θερμοκρασίας (°C)" name="tempMin" inputMode="decimal" placeholder="π.χ. -25" /></div>
              <div data-for={FOR.storage}><Field label="Πάνω όριο θερμοκρασίας (°C)" name="tempMax" inputMode="decimal" placeholder="π.χ. -15" hint="Πάνω από αυτό η μέτρηση φαίνεται κόκκινη" /></div>
              <div data-for={FOR.storage} className="text-sm text-muted-foreground sm:col-span-2">Δημιουργείται και αποθηκευτικός χώρος με το ίδιο όνομα, για να τηρείται απόθεμα μέσα στη συσκευή.</div>
              <div data-for={FOR.scale}><Select label="Δεμένη με ταμείο" name="linkedDeviceId" options={tillOptions} /></div>
              <div data-for={FOR.network}><Field label="MAC συσκευής" name="macAddress" maxLength={17} placeholder="AA:BB:CC:DD:EE:FF" hint="Για την καταγραφή του υλικού" /></div>
              <div data-for={FOR.network}><Field label="Διεύθυνση Tailscale" name="tailscaleIp" maxLength={15} placeholder="100.x.y.z" hint="Αν οριστεί, η συσκευή γίνεται δεκτή μόνο από αυτήν" /></div>
              <button className={btn("default")}>Προσθήκη συσκευής</button>
            </form>
          </Modal>}
        >
          <ul className="divide-y divide-border/70">
            {org.stores.flatMap((s) => s.devices.map((d) => {
              const kind = DEVICE_KIND[d.kind];
              const status = kind.measures ? readingStatus(d, d.readings[0]) : null;
              return (
                <Row
                  key={d.id} title={d.name} active={d.active} toggle={toggleActive.bind(null, org.id, "devices", d.id)}
                  meta={[
                    s.name, kind.label,
                    ...(kind.invoices ? [`σειρά ${d.series}`, `επόμενη απόδειξη #${d.nextAa}`, d.vivaTerminalId ? `τερματικό ${d.vivaTerminalId}` : "χωρίς τερματικό Viva"] : ["δεν χρεώνεται"]),
                    d.printer && `εκτυπωτής ${d.printer.name}`,
                    kind.storage && (d.warehouse ? `αποθηκευτικός χώρος «${d.warehouse.name}»` : "χωρίς αποθηκευτικό χώρο"),
                    kind.storage && (d.tempMin !== null || d.tempMax !== null) && `όρια ${d.tempMin ?? "…"} έως ${d.tempMax ?? "…"} °C`,
                    d.kind === "SCALE" && (d.linkedDevice ? `ζυγίζει για το ${d.linkedDevice.name}` : "ζυγαριά εργαστηρίου"),
                    d.macAddress && `MAC ${d.macAddress}`, d.tailscaleIp && `Tailscale ${d.tailscaleIp}`,
                    d.lastSeenAt && `τελευταία επαφή ${d.lastSeenAt.toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" })}`,
                  ].filter(Boolean).join(" · ")}
                >
                  {status ? <Badge tone={status.tone}>{status.text}</Badge> : null}
                  {me.can("setup.manage") ? (
                    <Modal label={<><Pencil /> Ρύθμιση</>} size="sm" title={`Ρύθμιση: ${d.name}`} description={kind.invoices ? `Σειρά ${d.series} · η σειρά δεν αλλάζει, για να μη σπάσει η αρίθμηση` : kind.label}>
                      <form key={[d.vivaTerminalId, d.printerId, d.macAddress, d.tailscaleIp, d.tempMin, d.tempMax, d.linkedDeviceId].join()} action={updateDevice} className={form}>
                        {hidden}<input type="hidden" name="deviceId" value={d.id} />
                        {kind.invoices ? <Field label="Τερματικό Viva (Terminal ID)" name="vivaTerminalId" defaultValue={d.vivaTerminalId ?? ""} maxLength={20} /> : null}
                        {kind.invoices || d.kind === "KITCHEN_DISPLAY" ? <Select label="Εκτυπωτής" name="printerId" defaultValue={d.printerId ?? ""} options={printerOptions} /> : null}
                        {kind.storage ? <Field label="Κάτω όριο θερμοκρασίας (°C)" name="tempMin" inputMode="decimal" defaultValue={d.tempMin ?? ""} /> : null}
                        {kind.storage ? <Field label="Πάνω όριο θερμοκρασίας (°C)" name="tempMax" inputMode="decimal" defaultValue={d.tempMax ?? ""} /> : null}
                        {d.kind === "SCALE" ? <Select label="Δεμένη με ταμείο" name="linkedDeviceId" defaultValue={d.linkedDeviceId ?? ""} options={tillOptions} /> : null}
                        {d.kind === "POS_WEB" ? null : <Field label="MAC συσκευής" name="macAddress" defaultValue={d.macAddress ?? ""} maxLength={17} placeholder="AA:BB:CC:DD:EE:FF" />}
                        {d.kind === "POS_WEB" ? null : <Field label="Διεύθυνση Tailscale" name="tailscaleIp" defaultValue={d.tailscaleIp ?? ""} maxLength={15} placeholder="100.x.y.z" hint="Αν οριστεί, η συσκευή γίνεται δεκτή μόνο από αυτήν" />}
                        {save}
                      </form>
                    </Modal>
                  ) : null}
                  {d.kind === "POS_WEB" ? null : (
                    <div className="order-last flex basis-full flex-wrap items-center gap-3 rounded-xl bg-secondary px-4 py-3 text-sm">
                      {d.pairCode && d.pairCodeExpiresAt && d.pairCodeExpiresAt > new Date() ? (
                        <span className="min-w-0 flex-1">Κωδικός σύζευξης: <b className="font-mono text-lg tracking-widest">{d.pairCode}</b> <span className="text-muted-foreground">· ισχύει ως τις {d.pairCodeExpiresAt.toLocaleTimeString("el-GR", { timeStyle: "short" })}, για μία χρήση</span></span>
                      ) : (
                        <span className="min-w-0 flex-1">{d.pairedAt ? <Badge tone="success">Πιστοποιημένη από {day(d.pairedAt)}</Badge> : <Badge tone="warning">Δεν έχει πιστοποιηθεί</Badge>}{kind.measures ? <span className="ml-2 text-muted-foreground">Μετά τη σύζευξη στέλνει μετρήσεις στο /api/devices/readings</span> : null}</span>
                      )}
                      {me.can("setup.manage") ? <form action={issuePairCode.bind(null, org.id, d.id)}><button className={btn("outline", "sm")}>{d.pairedAt ? "Νέα σύζευξη" : "Κωδικός σύζευξης"}</button></form> : null}
                      {d.pairedAt && me.can("setup.manage") ? <form action={revokeDevice.bind(null, org.id, d.id)}><button className={btn("destructive", "sm")}>Ανάκληση</button></form> : null}
                    </div>
                  )}
                </Row>
              );
            }))}
          </ul>
        </Section>

        <Section
          id="users" title="Χρήστες & ρόλοι" hint="Επιχειρηματίας: όλα · Manager: όλα εκτός συνδρομής και χρηστών · Υπάλληλος: ταμείο και αποδείξεις. Ο συνδρομητής ορίζει και δικούς του ρόλους." saved={saved("users")}
          action={me.can("users.manage") && <Modal label={add} title="Νέος χρήστης" description="Χωρίς αρχικό κωδικό, ο χρήστης παίρνει email πρόσκλησης και τον ορίζει μόνος του">
            <form action={addUser} className={form}>{hidden}
              <Field label="Ονοματεπώνυμο" name="name" required minLength={2} maxLength={60} />
              <Field label="Email" name="email" type="email" required autoComplete="off" />
              <Select label="Ρόλος" name="roleId" options={org.roles.map((r) => [r.id, r.name])} />
              <Select label="Κατάστημα" name="storeId" options={[["", "Όλα τα καταστήματα"], ...storeOptions]} />
              <Field label="Αρχικός κωδικός (προαιρετικό)" name="password" type="password" autoComplete="new-password" hint="Τουλάχιστον 10 χαρακτήρες, αν τον ορίσεις εσύ" />
              <button className={btn("default")}>Προσθήκη χρήστη</button>
            </form>
          </Modal>}
        >
          {org.members.length ? (
            <ul className="divide-y divide-border/70">
              {org.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{m.user.name}</p>
                    <p className="text-xs text-muted-foreground">{m.user.email} · {m.store?.name ?? "Όλα τα καταστήματα"}</p>
                  </div>
                  <Badge tone={m.role.locked ? "success" : "neutral"}>{m.role.name}</Badge>
                  <form action={removeMember.bind(null, org.id, m.id)}><button className={btn("ghost", "sm")}>Αφαίρεση πρόσβασης</button></form>
                </li>
              ))}
            </ul>
          ) : <Empty>Κανένας χρήστης ακόμα. Χωρίς χρήστη η επιχείρηση δεν μπορεί να συνδεθεί.</Empty>}
        </Section>
      </div>
    </Page>
  );
}
