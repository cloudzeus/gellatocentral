import { showRemoteId } from "@/lib/remote";
import { AddressField } from "@/components/address-field";
import { DataTable } from "@/components/data-table";
import { Files } from "@/components/files";
import { GeoCascade } from "@/components/geo-fields";
import { ProcessFlow } from "@/components/process-flow";
import { MonitorUp, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Modal } from "@/components/modal";
import { requirePlatform } from "@/lib/auth";
import { DetailGrid, Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { DEVICE_KIND, FOR, KIND_OPTIONS, readingStatus } from "@/lib/devices";
import { mailDomain, platformSettings } from "@/lib/mail/send";
import { euro } from "@/lib/money";
import { listParams } from "@/lib/paging";
import { logAccess } from "@/lib/access-log";
import { RoleBadges } from "@/components/party-bits";
import { closingChecks } from "@/lib/org-close";
import { canDelete, CLOSING_DAYS, orgState } from "@/lib/org-state";
import { billableStores, nextCharge, planOf } from "@/lib/plan-data";
import { daysBetween, MIN_PAUSE_DAYS, monthlyPreview } from "@/lib/plans";
import { setupSteps } from "@/lib/setup";
import { addDevice, addPrinter, addStore, addUser, addWarehouse, issueCharge, issuePairCode, markChargePaid, removeMember, resetMemberPassword, revokeDevice, saveOrgProfile, setRemoteId, startRemote, startTenantAccess, saveSubscription, saveViva, toggleActive, updateDevice, cancelClosing, deleteOrg, resumeOrg, startClosing, suspendOrg } from "../actions";
import { STATUS } from "../status";
import { Submit } from "@/components/submit";

const day = (d: Date) => d.toLocaleDateString("el-GR");
const CONNECTION = { NETWORK: "Δίκτυο", BLUETOOTH: "Bluetooth", USB: "USB" } as const;
const add = <><Plus /> Προσθήκη</>;
const edit = <><Pencil /> Αλλαγή</>;
/** Φόρμα μέσα σε παράθυρο: δύο στήλες, κουμπί αποθήκευσης κάτω δεξιά. */
const LIFE = { ok: "Λειτουργεί κανονικά", grace: "Περίοδος χάριτος", unpaid: "Ληξιπρόθεσμη: περιορισμένη", suspended: "Σε αναστολή", closing: "Κλείνει" } as const;
const form = "grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end";

/** Ενότητα με τίτλο, εξήγηση και μία ενέργεια (παράθυρο φόρμας) πάνω δεξιά. */
function Section({ id, title, hint, saved, action, children }: { id: string; title: string; hint: string; saved: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-28">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">{title} {saved ? <span role="status" className="ml-2 text-sm font-semibold text-success">Αποθηκεύτηκε</span> : null}</h2>
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
        <p className={active ? "font-semibold" : "font-semibold text-muted-foreground line-through"}>{title}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </div>
      {children}
      <form action={toggle}><Submit className={btn("ghost", "sm")}>{active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form>
    </li>
  );
}

/** Τιμές μόνο για ανάγνωση· αλλάζουν από το παράθυρο της ενότητας. */
function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="truncate font-semibold">{value || <span className="font-normal text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="px-5 py-6 text-sm text-muted-foreground">{children}</p>;

export default async function OrganizationPage({ params, searchParams }: PageProps<"/platform/[orgId]">) {
  const me = await requirePlatform("orgs.read");
  const { orgId } = await params;
  const q = await searchParams;
  const list = listParams(q, 50, ["store", "status", "devices", "full", "pause", "charge", "name", "roles", "location", "contact", "addresses"]);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: {
      subscription: { include: { charges: { orderBy: { periodStart: "desc" }, take: 12 } } },
      members: { orderBy: { user: { name: "asc" } }, include: { user: true, stores: { include: { store: true } }, role: true } },
      roles: { orderBy: { name: "asc" } },
      stores: { orderBy: { name: "asc" }, include: { devices: { orderBy: { createdAt: "asc" }, include: { printer: true, warehouse: true, defaultWarehouse: true, linkedDevice: true, readings: { orderBy: { at: "desc" }, take: 1 } } }, printers: { orderBy: { name: "asc" } } } },
      warehouses: { orderBy: { name: "asc" }, include: { device: true, stores: { include: { store: true }, orderBy: [{ isDefault: "desc" }, { priority: "asc" }] } } },
    },
  });
  if (!org) notFound();

  const settings = await platformSettings();
  const sub = org.subscription;
  const steps = setupSteps({ ...org, stores: org.stores.map((s) => ({ ...s, warehouses: org.warehouses.filter((w) => w.stores.some((l) => l.storeId === s.id)) })) });
  const doneCount = steps.filter((s) => s.done).length;
  const stores = org.stores.filter((s) => s.active);
  const [plan, plans, bstores, next] = await Promise.all([planOf(org.id), db.plan.findMany({ orderBy: { name: "asc" } }), billableStores(org.id), nextCharge(org.id)]);
  const monthly = monthlyPreview(plan, bstores.map((s) => ({ ...s, paused: !!s.paused })));
  const life = orgState(org, new Date());
  const deletable = canDelete(org, new Date());
  const checks = await closingChecks(org.id);
  const chargeRows = (next?.calc.lines ?? []).map((l) => ({ ...l, paused: bstores.find((s) => s.id === l.storeId)?.paused }));
  const sortedCharges = [...chargeRows].sort((a, b) => {
    if (!list.sort || !["store", "status", "devices", "full", "pause", "charge"].includes(list.sort)) return 0;
    const value = (l: (typeof chargeRows)[number]) => list.sort === "store" ? l.name
      : list.sort === "status" ? l.paused ? 1 : 0
        : list.sort === "devices" ? l.devicesCents
          : list.sort === "full" ? l.fullCents
            : list.sort === "pause" ? l.discountCents
              : l.cents;
    const av = value(a), bv = value(b);
    const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
    return list.dir === "asc" ? result : -result;
  });
  // Συναλλασσόμενοι του συνδρομητή: μόνο με το δικαίωμα, μόνο όταν ζητηθούν (?parties=1), και κάθε άνοιγμα καταγράφεται
  const showParties = me.can("parties.read") && q.parties === "1";
  const partyWhere = {
    orgId: org.id,
    ...(list.q ? { OR: [
      { name: { contains: list.q, mode: "insensitive" as const } },
      { vatNumber: { contains: list.q, mode: "insensitive" as const } },
      { email: { contains: list.q, mode: "insensitive" as const } },
      { phone: { contains: list.q, mode: "insensitive" as const } },
    ] } : {}),
  };
  const partyOrder = list.sort === "location" ? { city: list.dir }
    : list.sort === "contact" ? { phone: list.dir }
      : list.sort === "addresses" ? { addresses: { _count: list.dir } }
        : { name: list.sort ? list.dir : "asc" as const };
  const [partyTotal, filteredParties, theirParties] = await Promise.all([
    me.can("parties.read") ? db.party.count({ where: { orgId: org.id } }) : Promise.resolve(0),
    showParties ? db.party.count({ where: partyWhere }) : Promise.resolve(0),
    showParties ? db.party.findMany({ where: partyWhere, orderBy: partyOrder, skip: list.skip, take: list.take, include: { _count: { select: { addresses: true } } } }) : Promise.resolve([]),
  ]);
  if (showParties) await logAccess({ orgId: org.id, actorName: `${me.name} (πλατφόρμα)`, action: "parties.viewed", target: org.name, detail: `${theirParties.length} από ${filteredParties} συναλλασσόμενοι` });
  const pauses = bstores.flatMap((s) => s.pauses.map((p) => ({ ...p, store: s.name }))).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, 8);
  const storeOptions = stores.map((s): [string, string] => [s.id, s.name]);
  const printerOptions: [string, string][] = [["", "Κανένας"], ...org.stores.flatMap((s) => s.printers.filter((p) => p.active).map((p): [string, string] => [p.id, `${p.name} · ${s.name}`]))];
  const tillOptions: [string, string][] = [["", "Καμία — ζυγαριά εργαστηρίου"], ...org.stores.flatMap((s) => s.devices.filter((d) => d.active && DEVICE_KIND[d.kind].invoices).map((d): [string, string] => [d.id, `${d.name} · ${s.name}`]))];
  const hidden = <input type="hidden" name="orgId" value={org.id} />;
  const saved = (s: string) => q.saved === s;
  const mailFrom = await mailDomain();
  const save = <Submit className={btn("default")}>Αποθήκευση</Submit>;

  return (
    <Page section="Πλατφόρμα › Συνδρομητές" title={org.name} description={`ΑΦΜ ${org.vatNumber}`} actions={<Link href="/platform" className={btn("outline")}>Όλοι οι συνδρομητές</Link>}>
      <div className="max-w-7xl space-y-4">
        {q.error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {String(q.error)}</p> : null}

        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg">{doneCount === steps.length ? "Έτοιμη να εκδώσει αποδείξεις" : "Τι λείπει για να εκδώσει αποδείξεις"}</h2>
            <p className="text-sm font-semibold tabular-nums text-muted-foreground">{doneCount} από {steps.length}</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
            <div className="h-full rounded-full bg-success" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          {/* η πορεία ως διάγραμμα: το πρώτο βήμα που λείπει είναι το «τώρα» */}
          <div className="mt-4">
            <ProcessFlow label="Αρχικοποίηση" steps={steps.map((st, i) => ({ id: st.fix, label: st.label, state: st.done ? "done" : i === steps.findIndex((x) => !x.done) ? "current" : "todo", href: `#${st.fix}`, action: st.done ? undefined : "Ρύθμιση" }))} />
          </div>
        </Card>

        <Section
          id="profile" title="Στοιχεία & email" hint="Η διεύθυνση της επιχείρησης και ο αποστολέας των email της" saved={saved("profile")}
          action={me.can("setup.edit") && <Modal label={edit} title="Στοιχεία & email">
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
            ["Αποστολέας email", org.slug ? `${org.slug}@${mailFrom ?? "τομέας-email"}` : null],
            ["Email επικοινωνίας", org.contactEmail],
            ["Όνομα αποστολέα", org.emailFromName ?? org.name],
          ]} />
        </Section>

        <Card id="files" className="scroll-mt-28">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Αρχεία</h2>
            <p className="text-sm text-muted-foreground">Αποθηκεύονται στον φάκελο του πελάτη στο Bunny: orgs/{org.id}/</p>
          </div>
          <div className="grid gap-6 p-5 lg:grid-cols-2">
            <div className="space-y-2"><h3 className="text-base font-semibold">Λογότυπο</h3><Files orgId={org.id} category="logo" empty="Δεν έχει ανέβει λογότυπο" /></div>
            <div className="space-y-2"><h3 className="text-base font-semibold">Έγγραφα</h3><Files orgId={org.id} category="document" empty="Κανένα έγγραφο ακόμα (συμβάσεις, δικαιολογητικά)" /></div>
          </div>
        </Card>

        <Section
          id="subscription" title="Συνδρομή" hint={`Πακέτο «${plan.name}» · ${euro(monthly.totalCents)} τον μήνα προ ΦΠΑ${monthly.fullCents > monthly.totalCents ? ` (χωρίς παύση ${euro(monthly.fullCents)})` : ""}`} saved={saved("subscription")}
          action={me.can("billing.edit") && <Modal label={edit} title="Συνδρομή" description="Χειροκίνητη αλλαγή. Η εξόφληση μιας χρέωσης την παρατείνει αυτόματα.">
            <form key={`${sub?.status}-${sub?.currentPeriodEnd.toISOString()}-${sub?.planId}`} action={saveSubscription} className={form}>
              {hidden}
              <Select label="Πακέτο" name="planId" defaultValue={sub?.planId ?? ""} options={[["", "Προεπιλεγμένο"], ...plans.filter((p) => p.active || p.id === sub?.planId).map((p): [string, string] => [p.id, `${p.name} · ${euro(p.storeCents)} το κατάστημα`])]} />
              <Select label="Κατάσταση" name="status" defaultValue={sub?.status ?? "TRIALING"} options={Object.entries(STATUS).map(([k, v]) => [k, v.text])} />
              <Field label="Ισχύει μέχρι" name="currentPeriodEnd" type="date" required defaultValue={(sub?.currentPeriodEnd ?? new Date()).toISOString().slice(0, 10)} />
              {save}
            </form>
          </Modal>}
        >
          <Facts items={[
            ["Κατάσταση", sub ? <Badge tone={STATUS[sub.status].tone}>{STATUS[sub.status].text}</Badge> : null],
            ["Ισχύει μέχρι", sub ? day(sub.currentPeriodEnd) : null],
            ["Πακέτο", <Link key="p" href="/platform/plans" className="font-semibold underline">{plan.name}</Link>],
            ["Ανά μήνα", euro(monthly.totalCents)],
          ]} />
          {next ? (
            <div className="border-t border-border/70">
              <p className="px-5 pt-3 text-sm font-semibold">Επόμενη χρέωση: {day(next.periodStart)} – {day(next.periodEnd)} <span className="font-normal text-muted-foreground">· όπως θα εκδοθεί σήμερα</span></p>
              <DataTable
                id={`org-${org.id}-next-charge`}
                listing={{ ...list, total: sortedCharges.length, placeholder: "Κατάστημα…", showSearch: false }}
                empty="Κανένα χρεώσιμο κατάστημα"
                columns={[
                  { key: "store", label: "Κατάστημα", required: true, sortable: true },
                  { key: "status", label: "Κατάσταση", sortable: true },
                  { key: "devices", label: "Συσκευές", numeric: true, sortable: true },
                  { key: "full", label: "Πλήρης τιμή", numeric: true, sortable: true },
                  { key: "pause", label: "Παύση", numeric: true, sortable: true },
                  { key: "charge", label: "Χρέωση", numeric: true, sortable: true },
                ]}
                rows={sortedCharges.slice(list.skip, list.skip + list.take).map((l) => ({
                  id: l.storeId,
                  cells: {
                    store: <span className="font-semibold">{l.name}</span>,
                    status: l.paused ? <Badge tone="warning">Σε παύση από {day(l.paused.startedAt)}</Badge> : <Badge tone="success">Σε λειτουργία</Badge>,
                    devices: `${l.devices} · ${euro(l.devicesCents)}`,
                    full: euro(l.fullCents),
                    pause: l.pauseDays ? `${l.pauseDays} ημέρες · ${l.discountCents > 0 ? "−" : "+"}${euro(Math.abs(l.discountCents))}` : "—",
                    charge: euro(l.cents),
                  },
                  details: {
                    label: l.name,
                    view: (
                      <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-primary px-4 py-3 text-primary-foreground">
                          <div>
                            <p className="text-sm font-semibold">Ανάλυση χρέωσης</p>
                            <p className="text-xs">{day(next.periodStart)} – {day(next.periodEnd)} · προ ΦΠΑ</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium">Τελική χρέωση</p>
                            <p className="text-2xl font-semibold leading-tight tabular-nums">{euro(l.cents)}</p>
                          </div>
                        </div>
                        <div className="grid gap-5 p-4 md:grid-cols-2">
                          <dl className="divide-y divide-border/60 text-sm">
                            <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0">
                              <dt className="text-muted-foreground">Τιμή καταστήματος</dt>
                              <dd className="font-medium tabular-nums">{euro(l.storeCents)}</dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4 py-2">
                              <dt className="text-muted-foreground">Συσκευές <span className="text-foreground">({l.devices})</span></dt>
                              <dd className="font-medium tabular-nums">+ {euro(l.devicesCents)}</dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4 py-2 last:pb-0">
                              <dt className="font-semibold">Πλήρης μηνιαία τιμή</dt>
                              <dd className="font-semibold tabular-nums">{euro(l.fullCents)}</dd>
                            </div>
                          </dl>
                          <div className={l.pauseDays ? l.discountCents > 0 ? "rounded-lg bg-success/10 p-3" : "rounded-lg bg-gold/15 p-3" : "rounded-lg bg-secondary/60 p-3"}>
                            <p className="text-xs font-semibold text-foreground/70">Τακτοποίηση παύσης</p>
                            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                              <p className="text-sm font-semibold">{l.pauseDays > 0 ? `${l.pauseDays} ημέρες έκπτωσης` : l.pauseDays < 0 ? `${Math.abs(l.pauseDays)} ημέρες ανάκτησης έκπτωσης` : l.paused ? `Σε παύση από ${day(l.paused.startedAt)}` : "Καμία τακτοποίηση"}</p>
                              {l.pauseDays ? <p className={l.discountCents > 0 ? "text-lg font-semibold tabular-nums text-success-ink" : "text-lg font-semibold tabular-nums text-gold-ink"}>{l.discountCents > 0 ? "−" : "+"}{euro(Math.abs(l.discountCents))}</p> : null}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-foreground/75">{l.pauseDays > 0 ? "Η αναλογική έκπτωση αφαιρείται από την πλήρη μηνιαία τιμή." : l.pauseDays < 0 ? "Ανακτούνται ημέρες έκπτωσης που είχαν δοθεί νωρίτερα." : l.paused ? "Η τρέχουσα παύση δεν προσθέτει νέα αναλογία σε αυτή τη χρέωση." : "Η χρέωση ισούται με την πλήρη μηνιαία τιμή."}</p>
                          </div>
                        </div>
                      </div>
                    ),
                  },
                }))}
              />
              <dl className="grid gap-2 border-t border-border/70 bg-secondary/50 px-5 py-3 text-sm sm:grid-cols-[1fr_auto]">
                {next.calc.usedCreditCents ? <><dt>Πιστωτικό υπόλοιπο από προηγούμενη χρέωση</dt><dd className="text-right tabular-nums">−{euro(next.calc.usedCreditCents)}</dd></> : null}
                <dt className="font-medium">Σύνολο προ ΦΠΑ</dt><dd className="text-right font-semibold tabular-nums">{euro(next.calc.totalCents)}</dd>
                {next.calc.carryCents ? <><dt className="text-muted-foreground">Η έκπτωση ξεπερνά τη χρέωση του μήνα: μένει πιστωτικό για την επόμενη</dt><dd className="text-right tabular-nums text-success-ink">{euro(next.calc.carryCents)}</dd></> : null}
              </dl>
            </div>
          ) : null}
          {pauses.length ? (
            <div className="border-t border-border/70">
              <p className="px-5 pt-3 text-sm font-semibold">Εποχιακές παύσεις</p>
              <ul className="divide-y divide-border/70">
                {pauses.map((p) => { const days = daysBetween(p.startedAt, p.endedAt ?? new Date()); return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">{p.store} · {day(p.startedAt)} {p.endedAt ? `έως ${day(p.endedAt)}` : ", συνεχίζεται"} <span className="text-muted-foreground">· {days} ημέρες · {p.startedByName}{p.settledThrough ? ` · έκπτωση δοσμένη ως ${day(p.settledThrough)}` : ""}</span></span>
                    {days >= MIN_PAUSE_DAYS ? <Badge tone="success">Μετρά ως παύση</Badge> : p.endedAt ? <Badge>Κάτω από {MIN_PAUSE_DAYS} ημέρες: χρεώθηκε κανονικά</Badge> : <Badge tone="warning">Θέλει {MIN_PAUSE_DAYS - days} ημέρες ακόμα</Badge>}
                  </li>
                ); })}
              </ul>
            </div>
          ) : null}
          <div className="border-t border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <p className="text-sm font-semibold">Χρεώσεις</p>
              <form action={issueCharge.bind(null, org.id)}><Submit className={btn("outline", "sm")}>Έκδοση χρέωσης επόμενου μήνα ({euro(next?.calc.totalCents ?? monthly.totalCents)})</Submit></form>
            </div>
            {sub?.charges.length ? (
              <ul className="divide-y divide-border/70 border-t border-border/70">
                {sub.charges.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1 tabular-nums">{day(c.periodStart)} – {day(c.periodEnd)} <span className="text-muted-foreground">· {c.stores} καταστ., {c.devices} συσκευές{c.planName ? ` · ${c.planName}` : ""}</span></span>
                    <b className="tabular-nums">{euro(c.amountCents)}</b>
                    {c.paidAt ? <Badge tone="success">Πληρώθηκε {day(c.paidAt)}</Badge> : (
                      <form action={markChargePaid.bind(null, c.id)}><Submit className={btn("success", "sm")}>Πληρώθηκε</Submit></form>
                    )}
                  </li>
                ))}
              </ul>
            ) : <Empty>Καμία χρέωση ακόμα. Η έκδοση «φωτογραφίζει» τα σημερινά καταστήματα και συσκευές με τις τιμές του πακέτου· όταν σημειωθεί πληρωμένη, η συνδρομή παρατείνεται.</Empty>}
          </div>
        </Section>

        <Section
          id="viva" title="Viva" hint="Ο έμπορος πρέπει να έχει συνδεθεί με τον λογαριασμό ISV και να έχει ενεργό το Viva Fiscal" saved={saved("viva")}
          action={me.can("setup.edit") && <Modal label={edit} title="Σύνδεση με Viva">
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
          id="stores" title="Υποκαταστήματα" hint={`Κάθε ενεργό κατάστημα χρεώνεται ${euro(plan.storeCents)} τον μήνα (πακέτο «${plan.name}»)`} saved={saved("stores")}
          action={me.can("setup.edit") && <Modal label={add} title="Νέο υποκατάστημα" description={`Προσθέτει ${euro(plan.storeCents)} τον μήνα στη συνδρομή`}>
            <form action={addStore} className={form}>{hidden}
              <Field label="Όνομα" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Κατάστημα Τήνου" />
              <Field label="Πηγή πληρωμών Viva" name="vivaSourceCode" maxLength={20} placeholder="προαιρετικό" />
              <AddressField label="Διεύθυνση" name="address" maxLength={120} hint="Τυπώνεται στην απόδειξη· με επιλογή από τις προτάσεις γεμίζουν τα υπόλοιπα" />
              <Field label="Τ.Κ." name="postalCode" maxLength={10} />
              {/* οι συντεταγμένες γεμίζουν από την επιλογή διεύθυνσης, χωρίς να φαίνονται στη φόρμα */}
              <input type="hidden" name="latitude" /><input type="hidden" name="longitude" />
              {/* Καλλικράτης + πόλη/περιοχή από τις κοινές λίστες, αλληλοεξαρτώμενα */}
              <GeoCascade country="GR" />
              <Submit className={btn("default")}>Προσθήκη καταστήματος</Submit>
            </form>
          </Modal>}
        >
          <ul className="divide-y divide-border/70">
            {org.stores.map((s) => <Row key={s.id} title={s.name} meta={[s.address ?? "Χωρίς διεύθυνση", s.vivaSourceCode && `πηγή Viva ${s.vivaSourceCode}`].filter(Boolean).join(" · ")} active={s.active} toggle={toggleActive.bind(null, org.id, "stores", s.id)} />)}
          </ul>
        </Section>

        <Section
          id="warehouses" title="Αποθήκες" hint="Ανεξάρτητοι χώροι απόθεματος της επιχείρησης. Μία κεντρική αποθήκη μπορεί να εξυπηρετεί πολλά καταστήματα· τη σύνδεση και την προεπιλογή ανά κατάστημα τις διαχειρίζεται ο πελάτης στις Αποθήκες" saved={saved("warehouses")}
          action={me.can("setup.edit") && <Modal label={add} title="Νέα αποθήκη">
            <form action={addWarehouse} className={form}>{hidden}
              <Field label="Όνομα" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Κατάψυξη" />
              <Field label="Κωδικός" name="code" maxLength={20} placeholder="π.χ. CENTRAL" hint="Προαιρετικός· κεφαλαία λατινικά, αριθμοί, παύλες" />
              <Select label="Σύνδεση με κατάστημα" name="storeId" options={[["", "Χωρίς — θα δεθεί αργότερα"], ...storeOptions]} />
              <Submit className={btn("default")}>Προσθήκη αποθήκης</Submit>
            </form>
          </Modal>}
        >
          {org.warehouses.length ? (
            <ul className="divide-y divide-border/70">
              {org.warehouses.map((w) => <Row key={w.id} title={w.code ? `${w.name} (${w.code})` : w.name} meta={[
                w.stores.length ? w.stores.map((l) => `${l.store.name}${l.isDefault ? " · προεπιλογή" : ""}`).join(", ") : "χωρίς σύνδεση με κατάστημα",
                w.device && `είναι η συσκευή «${w.device.name}»`,
              ].filter(Boolean).join(" · ")} active={w.active} toggle={toggleActive.bind(null, org.id, "warehouses", w.id)} />)}
            </ul>
          ) : <Empty>Καμία αποθήκη ακόμα</Empty>}
        </Section>

        <Section
          id="printers" title="Εκτυπωτές" hint="Θερμικοί εκτυπωτές αποδείξεων. Δένονται με ταμείο στην επόμενη ενότητα." saved={saved("printers")}
          action={me.can("setup.edit") && <Modal label={add} title="Νέος εκτυπωτής">
            <form action={addPrinter} className={form}>{hidden}
              <Field label="Όνομα" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Εκτυπωτής πάγκου" />
              <Select label="Κατάστημα" name="storeId" options={storeOptions} />
              <Select label="Σύνδεση" name="connection" options={Object.entries(CONNECTION)} />
              <Field label="Διεύθυνση" name="address" maxLength={40} placeholder="192.168.1.50:9100" hint="IP για δίκτυο, MAC για Bluetooth, κενό για USB" />
              <Select label="Πλάτος χαρτιού" name="paperWidth" defaultValue="80" options={[["80", "80 mm"], ["58", "58 mm"]]} />
              <Submit className={btn("default")}>Προσθήκη εκτυπωτή</Submit>
            </form>
          </Modal>}
        >
          {org.stores.some((s) => s.printers.length) ? (
            <ul className="divide-y divide-border/70">
              {org.stores.flatMap((s) => s.printers.map((p) => <Row key={p.id} title={p.name} meta={`${s.name} · ${CONNECTION[p.connection]}${p.address ? ` ${p.address}` : ""} · ${p.paperWidth} mm`} active={p.active} toggle={toggleActive.bind(null, org.id, "printers", p.id)} />))}
            </ul>
          ) : <Empty>Κανένας εκτυπωτής ακόμα</Empty>}
        </Section>

        <Section
          id="devices" title="Συσκευές" hint={`Ταμεία, οθόνες κουζίνας, ψυγεία, αυτόματοι πωλητές και ζυγαριές. Κάθε ενεργή συσκευή χρεώνεται με την τιμή του είδους της στο πακέτο «${plan.name}»`} saved={saved("devices")}
          action={me.can("setup.edit") && <Modal label={add} title="Νέα συσκευή" description="Διάλεξε είδος· η φόρμα δείχνει μόνο όσα χρειάζεται">
            <form action={addDevice} data-by-kind className={form}>{hidden}
              <Select label="Είδος" name="kind" options={KIND_OPTIONS} />
              <Field label="Όνομα" name="name" required minLength={2} maxLength={40} placeholder="π.χ. Ταμείο 2 ή Καταψύκτης εργαστηρίου" />
              <Select label="Κατάστημα" name="storeId" options={storeOptions} />
              <div data-for={FOR.invoicing}><Field label="Σειρά αποδείξεων" name="series" pattern="[A-Za-z0-9]{1,6}" placeholder="π.χ. A2" hint={`Μοναδική, δεν αλλάζει μετά. Το ταμείο χρεώνεται με την τιμή του πακέτου`} /></div>
              <div data-for={FOR.invoicing}><Field label="Τερματικό Viva (Terminal ID)" name="vivaTerminalId" maxLength={20} placeholder="π.χ. 16000010" /></div>
              <div data-for={`${FOR.invoicing} KITCHEN_DISPLAY`}><Select label="Εκτυπωτής" name="printerId" options={printerOptions} /></div>
              <div data-for={FOR.storage}><Field label="Κάτω όριο θερμοκρασίας (°C)" name="tempMin" inputMode="decimal" placeholder="π.χ. -25" /></div>
              <div data-for={FOR.storage}><Field label="Πάνω όριο θερμοκρασίας (°C)" name="tempMax" inputMode="decimal" placeholder="π.χ. -15" hint="Πάνω από αυτό η μέτρηση φαίνεται κόκκινη" /></div>
              <div data-for={FOR.storage} className="text-sm text-muted-foreground sm:col-span-2">Δημιουργείται και αποθηκευτικός χώρος με το ίδιο όνομα, για να τηρείται απόθεμα μέσα στη συσκευή.</div>
              <div data-for={FOR.scale}><Select label="Δεμένη με ταμείο" name="linkedDeviceId" options={tillOptions} /></div>
              <div data-for={FOR.network}><Field label="MAC συσκευής" name="macAddress" maxLength={17} placeholder="AA:BB:CC:DD:EE:FF" hint="Για την καταγραφή του υλικού" /></div>
              <div data-for={FOR.network}><Field label="Διεύθυνση Tailscale" name="tailscaleIp" maxLength={15} placeholder="100.x.y.z" hint="Αν οριστεί, η συσκευή γίνεται δεκτή μόνο από αυτήν" /></div>
              <Submit className={btn("default")}>Προσθήκη συσκευής</Submit>
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
                    kind.invoices && (d.defaultWarehouse ? `αποθήκη ${d.defaultWarehouse.name}` : "αποθήκη του καταστήματος"),
                    d.printer && `εκτυπωτής ${d.printer.name}`,
                    kind.storage && (d.warehouse ? `αποθηκευτικός χώρος «${d.warehouse.name}»` : "χωρίς αποθηκευτικό χώρο"),
                    kind.storage && (d.tempMin !== null || d.tempMax !== null) && `όρια ${d.tempMin ?? "…"} έως ${d.tempMax ?? "…"} °C`,
                    d.kind === "SCALE" && (d.linkedDevice ? `ζυγίζει για το ${d.linkedDevice.name}` : "ζυγαριά εργαστηρίου"),
                    d.macAddress && `MAC ${d.macAddress}`, d.tailscaleIp && `Tailscale ${d.tailscaleIp}`,
                    d.lastSeenAt && `τελευταία επαφή ${d.lastSeenAt.toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" })}`,
                  ].filter(Boolean).join(" · ")}
                >
                  {status ? <Badge tone={status.tone}>{status.text}</Badge> : null}
                  {me.can("setup.edit") ? (
                    <Modal label={<><Pencil /> Ρύθμιση</>} size="sm" title={`Ρύθμιση: ${d.name}`} description={kind.invoices ? `Σειρά ${d.series} · η σειρά δεν αλλάζει, για να μη σπάσει η αρίθμηση` : kind.label}>
                      <form key={[d.vivaTerminalId, d.printerId, d.macAddress, d.tailscaleIp, d.tempMin, d.tempMax, d.linkedDeviceId, d.defaultWarehouseId].join()} action={updateDevice} className={form}>
                        {hidden}<input type="hidden" name="deviceId" value={d.id} />
                        {kind.invoices ? <Field label="Τερματικό Viva (Terminal ID)" name="vivaTerminalId" defaultValue={d.vivaTerminalId ?? ""} maxLength={20} /> : null}
                        {kind.invoices ? <Select label="Προεπιλεγμένη αποθήκη" name="defaultWarehouseId" defaultValue={d.defaultWarehouseId ?? ""} options={[["", "Της προεπιλογής του καταστήματος"], ...org.warehouses.filter((w) => w.stores.some((l) => l.storeId === s.id)).map((w): [string, string] => [w.id, w.name])]} /> : null}
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
                    <div className="order-last flex basis-full flex-wrap items-center gap-3 rounded-lg bg-secondary px-4 py-3 text-sm">
                      {d.pairCode && d.pairCodeExpiresAt && d.pairCodeExpiresAt > new Date() ? (
                        <span className="min-w-0 flex-1">Κωδικός σύζευξης: <b className="font-mono text-lg tracking-widest">{d.pairCode}</b> <span className="text-muted-foreground">· ισχύει ως τις {d.pairCodeExpiresAt.toLocaleTimeString("el-GR", { timeStyle: "short" })}, για μία χρήση</span></span>
                      ) : (
                        <span className="min-w-0 flex-1">{d.pairedAt ? <Badge tone="success">Πιστοποιημένη από {day(d.pairedAt)}</Badge> : <Badge tone="warning">Δεν έχει πιστοποιηθεί</Badge>}{kind.measures ? <span className="ml-2 text-muted-foreground">Μετά τη σύζευξη στέλνει μετρήσεις στο /api/devices/readings</span> : null}</span>
                      )}
                      {d.remoteId && me.can("support.remote") ? (
                        <Modal label={<><MonitorUp /> Σύνδεση</>} size="sm" variant="default" title={`Απομακρυσμένη σύνδεση: ${d.name}`} description={`RustDesk ${showRemoteId(d.remoteId)}. Η σύνδεση καταγράφεται και ο πελάτης τη βλέπει στις Συσκευές του`}>
                          <form action={startRemote.bind(null, org.id, d.id)} className="grid gap-4 [&>button]:justify-self-end">
                            <Field label="Λόγος σύνδεσης" name="reason" required minLength={5} maxLength={300} placeholder="π.χ. δεν τυπώνει αποδείξεις" hint="Τον διαβάζει ο πελάτης στο ιστορικό συνδέσεων" />
                            <Submit className={btn("default")}>Καταγραφή και συνέχεια</Submit>
                          </form>
                        </Modal>
                      ) : null}
                      {me.can("setup.edit") ? (
                        <Modal label={d.remoteId ? "RustDesk" : "Ορισμός RustDesk"} size="sm" variant="ghost" title={`Αριθμός RustDesk: ${d.name}`} description="Ο αριθμός που δείχνει το πρόγραμμα RustDesk στη συσκευή του πελάτη">
                          <form key={d.remoteId ?? ""} action={setRemoteId.bind(null, org.id, d.id)} className="grid gap-4 [&>button]:justify-self-end">
                            <Field label="Αριθμός RustDesk" name="remoteId" maxLength={40} defaultValue={d.remoteId ? showRemoteId(d.remoteId) : ""} placeholder="123 456 789" hint="Κενό για να αφαιρεθεί" />
                            <Submit className={btn("default")}>Αποθήκευση</Submit>
                          </form>
                        </Modal>
                      ) : null}
                      {me.can("setup.edit") ? <form action={issuePairCode.bind(null, org.id, d.id)}><Submit className={btn("outline", "sm")}>{d.pairedAt ? "Νέα σύζευξη" : "Κωδικός σύζευξης"}</Submit></form> : null}
                      {d.pairedAt && me.can("setup.edit") ? <form action={revokeDevice.bind(null, org.id, d.id)}><Submit className={btn("destructive", "sm")}>Ανάκληση</Submit></form> : null}
                    </div>
                  )}
                </Row>
              );
            }))}
          </ul>
        </Section>

        <Section
          id="users" title="Χρήστες & ρόλοι" hint="Επιχειρηματίας: όλα · Manager: όλα εκτός συνδρομής και χρηστών · Υπάλληλος: ταμείο και αποδείξεις. Ο συνδρομητής ορίζει και δικούς του ρόλους." saved={saved("users")}
          action={me.can("users.add") && <Modal label={add} title="Νέος χρήστης" description="Χωρίς αρχικό κωδικό, ο χρήστης παίρνει email πρόσκλησης και τον ορίζει μόνος του">
            <form action={addUser} className={form}>{hidden}
              <Field label="Ονοματεπώνυμο" name="name" required minLength={2} maxLength={60} />
              <Field label="Email" name="email" type="email" required autoComplete="off" />
              <Select label="Ρόλος" name="roleId" options={org.roles.map((r) => [r.id, r.name])} />
              <Select label="Κατάστημα" name="storeId" options={[["", "Όλα τα καταστήματα"], ...storeOptions]} />
              <Field label="Αρχικός κωδικός (προαιρετικό)" name="password" type="password" autoComplete="new-password" hint="Τουλάχιστον 10 χαρακτήρες, αν τον ορίσεις εσύ" />
              <Submit className={btn("default")}>Προσθήκη χρήστη</Submit>
            </form>
          </Modal>}
        >
          {org.members.length ? (
            <ul className="divide-y divide-border/70">
              {org.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{m.user.name}</p>
                    <p className="text-xs text-muted-foreground">{m.user.email} · {m.stores.length ? m.stores.map((s) => s.store.name).join(", ") : "Όλα τα καταστήματα"}</p>
                  </div>
                  <Badge tone={m.role.locked ? "success" : "neutral"}>{m.role.name}</Badge>
                  {!m.user.disabledAt && !m.user.platformRole && me.can("users.edit") ? (
                    <Modal label="Νέος κωδικός" size="sm" title={`Νέος κωδικός: ${m.user.name}`} description="Οι ανοιχτές συνεδρίες και οι παλιοί σύνδεσμοι επαναφοράς θα ακυρωθούν.">
                      <form action={resetMemberPassword.bind(null, org.id, m.id)} className={form}>
                        <Field label="Νέος κωδικός" name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" />
                        <Field label="Επανάληψη κωδικού" name="confirmation" type="password" required minLength={10} maxLength={200} autoComplete="new-password" />
                        <Submit className={btn("default")}>Αλλαγή κωδικού</Submit>
                      </form>
                    </Modal>
                  ) : null}
                  {!m.user.disabledAt && !m.user.platformRole && me.can("support.tenant") ? (
                    <Modal label="Είσοδος" size="sm" variant="default" title={`Είσοδος ως ${m.user.name}`} description={`Πρόσβαση στο ${org.name} με τα δικαιώματα αυτού του χρήστη, για έως 2 ώρες. Η έναρξη και η λήξη καταγράφονται.`}>
                      <form action={startTenantAccess.bind(null, org.id, m.id)} className="grid gap-4 [&>button]:justify-self-end">
                        <Field label="Λόγος εισόδου" name="reason" required minLength={5} maxLength={300} autoComplete="off" placeholder="π.χ. Έλεγχος απογραφών μετά από αίτημα πελάτη" hint="Καταγράφεται στο ιστορικό πρόσβασης της επιχείρησης" />
                        <Submit className={btn("default")}>Έναρξη ελεγχόμενης εισόδου</Submit>
                      </form>
                    </Modal>
                  ) : null}
                  <form action={removeMember.bind(null, org.id, m.id)}><Submit className={btn("ghost", "sm")}>Αφαίρεση πρόσβασης</Submit></form>
                </li>
              ))}
            </ul>
          ) : <Empty>Κανένας χρήστης ακόμα. Χωρίς χρήστη η επιχείρηση δεν μπορεί να συνδεθεί.</Empty>}
        </Section>

        {me.can("parties.read") ? (
          <Section id="parties" title="Συναλλασσόμενοι του συνδρομητή" saved={false} hint={`${partyTotal} στο αρχείο του: πελάτες, προμηθευτές, franchisees, συνεργάτες. Μόνο ανάγνωση· κάθε άνοιγμα καταγράφεται με το όνομά σου`}
            action={showParties ? <Link href={`/platform/${org.id}#parties`} className={btn("outline", "sm")}>Απόκρυψη</Link> : partyTotal ? <Link href={`/platform/${org.id}?parties=1#parties`} className={btn("outline", "sm")}>Εμφάνιση</Link> : null}>
            {showParties ? (
              <DataTable
                id={`org-${org.id}-parties`}
                listing={{ ...list, total: filteredParties, placeholder: "Επωνυμία, ΑΦΜ ή επικοινωνία…", params: { parties: "1" } }}
                empty="Κανένας συναλλασσόμενος"
                columns={[
                  { key: "name", label: "Συναλλασσόμενος", required: true, sortable: true },
                  { key: "roles", label: "Ρόλοι", sortable: true },
                  { key: "location", label: "Έδρα · περιοχή", sortable: true },
                  { key: "contact", label: "Επικοινωνία", sortable: true },
                  { key: "addresses", label: "Διευθύνσεις", numeric: true, sortable: true },
                ]}
                rows={theirParties.map((p) => ({
                  id: p.id,
                  cells: {
                    name: <><span className="font-semibold">{p.name}</span><span className="block text-xs text-muted-foreground">{p.vatNumber ? `ΑΦΜ ${p.vatNumber}` : "χωρίς ΑΦΜ"}{p.active ? "" : " · ανενεργός"}</span></>,
                    roles: <RoleBadges roles={p.roles} />,
                    location: [p.city, p.region].filter(Boolean).join(" · ") || "—",
                    contact: p.phone ?? p.email ?? "—",
                    addresses: p._count.addresses || "—",
                  },
                  details: {
                    label: p.name,
                    view: <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-xs text-muted-foreground">ΑΦΜ</dt><dd className="font-medium">{p.vatNumber ?? "—"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Έδρα · περιοχή</dt><dd className="font-medium">{[p.city, p.region].filter(Boolean).join(" · ") || "—"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Email</dt><dd className="font-medium">{p.email ?? "—"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Τηλέφωνο</dt><dd className="font-medium">{p.phone ?? "—"}</dd></div>
                    </DetailGrid>,
                  },
                }))}
              />
            ) : <Empty>{partyTotal ? "Πάτησε «Εμφάνιση» για να τους δεις. Το άνοιγμα γράφεται στο ιστορικό του συνδρομητή" : "Ο συνδρομητής δεν έχει καταχωρίσει συναλλασσόμενους ακόμα"}</Empty>}
          </Section>
        ) : null}

        <Section
          id="lifecycle" title="Αναστολή και κλείσιμο" saved={saved("lifecycle")}
          hint={life.kind === "closing" ? `Κλείνει: η οριστική διαγραφή επιτρέπεται από ${org.deleteAfter ? day(org.deleteAfter) : "—"}` : life.kind === "suspended" ? `Σε αναστολή από ${day(org.suspendedAt!)}` : life.kind === "unpaid" ? "Περιορισμένη λειτουργία: η συνδρομή έχει λήξει" : life.kind === "grace" ? `Η συνδρομή έληξε: κλειδώνει σε ${life.daysLeft} ημέρες` : "Η επιχείρηση λειτουργεί κανονικά"}
        >
          <Facts items={[
            ["Κατάσταση", <Badge key="s" tone={life.kind === "ok" ? "success" : life.kind === "grace" ? "warning" : "danger"}>{LIFE[life.kind]}</Badge>],
            ["Λόγος αναστολής", org.suspendedReason],
            ["Διαγραφή επιτρέπεται από", org.deleteAfter ? day(org.deleteAfter) : null],
          ]} />
          <div className="grid gap-3 border-t border-border/70 p-5 text-sm md:grid-cols-3">
            <div className="space-y-2">
              <p className="font-semibold">Αναστολή</p>
              <p className="text-muted-foreground">Κλείνει αμέσως το ταμείο και τις ενότητες. Μένουν οι αποδείξεις, η συνδρομή και η υποστήριξη. Τίποτα δεν σβήνεται και αναιρείται με ένα κλικ</p>
              {!me.can("billing.edit") ? null : org.suspendedAt ? (
                <form action={resumeOrg.bind(null, org.id)}><Submit className={btn("default")}>Άρση αναστολής</Submit></form>
              ) : org.closingAt ? null : (
                <Modal label="Αναστολή" size="sm" title={`Αναστολή: ${org.name}`} description="Οι χρήστες βλέπουν τον λόγο σε κάθε σελίδα">
                  <form action={suspendOrg} className="grid gap-4 [&>button]:justify-self-end">{hidden}
                    <Field label="Λόγος (τον βλέπει ο πελάτης)" name="reason" required minLength={5} maxLength={300} placeholder="π.χ. Εκκρεμεί η ανανέωση της σύμβασης" />
                    <Submit className={btn("destructive")}>Αναστολή τώρα</Submit>
                  </form>
                </Modal>
              )}
            </div>
            <div className="space-y-2">
              <p className="font-semibold">Κλείσιμο</p>
              <p className="text-muted-foreground">Ο πελάτης φεύγει. Η εφαρμογή περιορίζεται, η συνδρομή ακυρώνεται και κρατάμε όλα τα στοιχεία {CLOSING_DAYS} ημέρες για να τα κατεβάσει. Το ίδιο ξεκινά αυτόματα όταν η συνδρομή γίνει «Ακυρωμένη». Αναιρείται μέχρι τη διαγραφή</p>
              <p className="text-xs text-muted-foreground">Θύμισε στον πελάτη: η σύμβασή του με το Viva Fiscal και η δήλωση παρόχου στην ΑΑΔΕ είναι δικές του και δεν κλείνουν από εδώ. Το αρχείο των αποδείξεων το οφείλει ο ίδιος στην εφορία</p>
              {!me.can("orgs.add") ? null : org.closingAt ? (
                <form action={cancelClosing.bind(null, org.id)}><Submit className={btn("outline")}>Ακύρωση κλεισίματος</Submit></form>
              ) : (
                <Modal label="Έναρξη κλεισίματος" size="sm" title={`Κλείσιμο: ${org.name}`} description={`Το ταμείο κλείνει αμέσως. Η διαγραφή επιτρέπεται μετά από ${CLOSING_DAYS} ημέρες και γίνεται χειροκίνητα`}>
                  <form action={startClosing} className="grid gap-4 [&>button]:justify-self-end">{hidden}
                    <Field label={`Για επιβεβαίωση γράψε το ΑΦΜ (${org.vatNumber})`} name="confirm" required autoComplete="off" inputMode="numeric" />
                    <Submit className={btn("destructive")}>Έναρξη κλεισίματος</Submit>
                  </form>
                </Modal>
              )}
              {me.can("gdpr.read") ? <p className="flex flex-wrap gap-1"><a href={`/api/org-export?org=${org.id}`} download className={btn("ghost", "sm")}>Όλα τα δεδομένα (JSON)</a><a href={`/api/org-export?org=${org.id}&format=receipts`} download className={btn("ghost", "sm")}>Αρχείο αποδείξεων (CSV)</a></p> : null}
            </div>
            <div className="space-y-2">
              <p className="font-semibold">Οριστική διαγραφή</p>
              <p className="text-muted-foreground">Σβήνει καταστήματα, αποδείξεις, πελάτες, χρήστες και τα αρχεία στο Bunny. <b className="text-foreground">Δεν αναιρείται.</b></p>
              <ul className="space-y-1">
                <li className={checks.stuck ? "font-medium text-destructive" : "text-muted-foreground"}>{checks.stuck ? `✕ ${checks.stuck} αποδείξεις δεν έχουν διαβιβαστεί στο myDATA` : `✓ Καμία απόδειξη σε εκκρεμότητα (${checks.receipts} συνολικά)`}</li>
                <li className={checks.receipts && !checks.exportedAt ? "font-medium text-destructive" : "text-muted-foreground"}>{checks.exportedAt ? `✓ Αντίγραφο δεδομένων: ${checks.exportedBy}, ${day(checks.exportedAt)}` : checks.receipts ? "✕ Δεν έχει κατέβει αντίγραφο των δεδομένων" : "✓ Δεν υπάρχουν αποδείξεις για αντίγραφο"}</li>
              </ul>
              {!me.can("settings.edit") ? <p className="text-xs text-muted-foreground">Μόνο Super Admin</p> : !org.closingAt ? <p className="text-xs text-muted-foreground">Ξεκίνα πρώτα το κλείσιμο</p> : !deletable ? <p className="text-xs text-muted-foreground">Διαθέσιμη από {day(org.deleteAfter!)}</p> : (
                <Modal label="Οριστική διαγραφή" size="sm" title={`Διαγραφή: ${org.name}`} description="Όλα τα δεδομένα και τα αρχεία της επιχείρησης σβήνονται. Δεν υπάρχει επαναφορά">
                  <form action={deleteOrg} className="grid gap-4 [&>button]:justify-self-end">{hidden}
                    <Field label={`Για επιβεβαίωση γράψε το ΑΦΜ (${org.vatNumber})`} name="confirm" required autoComplete="off" inputMode="numeric" />
                    <Submit className={btn("destructive")}>Διαγραφή για πάντα</Submit>
                  </form>
                </Modal>
              )}
            </div>
          </div>
        </Section>
      </div>
    </Page>
  );
}
