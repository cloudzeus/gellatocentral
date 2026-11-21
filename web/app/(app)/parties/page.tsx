import { CalendarClock, Eye, Mail, MapPin, PanelRight, Pencil, Phone, Plus, Power, Star, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { ActivityForm } from "@/components/crm/activity-form";
import { Drawer } from "@/components/crm/drawer";
import { QuickActions } from "@/components/crm/quick-actions";
import { Timeline } from "@/components/crm/timeline";
import { DataTable } from "@/components/data-table";
import { Modal, RoutedModal } from "@/components/modal";
import { RoleBadges } from "@/components/party-bits";
import { PartyForm } from "@/components/party-form";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, menuItem, Page, Select } from "@/components/ui";
import { ago, CHANNEL_LABELS, channelHref, contactTone, dueText, initials, showPhone, taskState } from "@/lib/crm";
import { activityItem, partyGlance } from "@/lib/crm-data";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { isPartyRole, PARTY_ROLES, type PartyRole } from "@/lib/parties";
import { partyScope } from "@/lib/party-scope";
import { partyRefs } from "@/lib/refs";
import { deleteChannel, deleteContact, logActivity, primaryChannel, saveChannel, saveContact, saveParty, toggleParty, touchActivity } from "./actions";

// Η λίστα συναλλασσομένων: της επιχείρησης του χρήστη ή, για το προσωπικό, της πλατφόρμας (ίδια σελίδα, άλλο πεδίο).
export default async function PartiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await partyScope();
  const sp = await searchParams;
  const list = listParams(sp, 25, ["name", "city", "created"]);
  const status = filterParam(sp, "status", ["active", "inactive"]);
  const role = isPartyRole(sp.role) ? sp.role : null;
  const refs = await partyRefs();
  const mine = { orgId: scope.orgId };
  // το φίλτρο «Περιοχή» δείχνει ό,τι υπάρχει πραγματικά στο αρχείο (το γράφει πλέον ο Καλλικράτης: νομός ή περιφέρεια)
  const regionsInUse = (await db.party.findMany({ where: { ...mine, region: { not: null } }, distinct: ["region"], select: { region: true }, orderBy: { region: "asc" } })).flatMap((r) => (r.region ? [r.region] : []));
  const region = filterParam(sp, "region", regionsInUse);
  const like = { contains: list.q, mode: "insensitive" as const };
  const where = {
    ...mine,
    ...(role ? { roles: { has: role } } : {}),
    ...(status ? { active: status === "active" } : {}),
    ...(region ? { region } : {}),
    ...(list.q ? { OR: [{ name: like }, { tradeName: like }, { vatNumber: { contains: list.q } }, { email: like }, { phone: { contains: list.q } }, { contactName: like }, { city: like }] } : {}),
  };
  const [rows, total, all, incomplete, ...perRole] = await Promise.all([
    db.party.findMany({ where, orderBy: list.sort === "city" ? { city: list.dir } : list.sort === "created" ? { createdAt: list.dir } : { name: list.sort === "name" ? list.dir : "asc" }, skip: list.skip, take: list.take, include: { _count: { select: { addresses: { where: { kind: "branch" } } } }, linkedOrg: { select: { id: true } } } }),
    db.party.count({ where }),
    db.party.count({ where: mine }),
    db.party.count({ where: { ...mine, active: true, OR: [{ vatNumber: null }, { address: null }] } }),
    ...(Object.keys(PARTY_ROLES) as PartyRole[]).map((r) => db.party.count({ where: { ...mine, roles: { has: r } } })),
  ]);
  const roleKeys = Object.keys(PARTY_ROLES) as PartyRole[];
  const now = new Date();
  const ids = rows.map((r) => r.id);
  // κύρια επαφή (με τα τηλέφωνα/email του προσώπου), τελευταία επικοινωνία και επόμενο βήμα ανά γραμμή
  const glance = await partyGlance(ids);
  // γρήγορη προβολή: ?peek=<id> πάνω στην ίδια λίστα, με τα ίδια φίλτρα — τα παράθυρα της λίστας (peek, contacts)
  // αποδίδονται μόνο όταν ζητηθούν: αλλιώς κάθε φόρτωση θα έστηνε 25 παράθυρα με φόρμες που σπάνια ανοίγουν
  const here = (peek?: string, contacts?: string) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "peek" && k !== "contacts" && k !== "error" && k !== "saved") u.set(k, v); if (peek) u.set("peek", peek); if (contacts) u.set("contacts", contacts); return `${scope.base}${u.size ? `?${u}` : ""}`; };
  const peek = typeof sp.peek === "string" ? await db.party.findFirst({ where: { id: sp.peek, orgId: scope.orgId }, include: { channels: { orderBy: [{ kind: "desc" }, { isPrimary: "desc" }] }, contacts: { where: { active: true }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }], include: { person: { include: { channels: { orderBy: { isPrimary: "desc" } } } } } }, activities: { orderBy: { at: "desc" }, take: 60, include: { person: { select: { name: true } } } } } }) : null;
  const peekItems = peek?.activities.map(activityItem) ?? [];
  const peekTasks = peekItems.filter((i) => i.task && !i.task.doneAt).sort((a, b) => (a.task!.dueAt?.getTime() ?? Infinity) - (b.task!.dueAt?.getTime() ?? Infinity));
  const channelOf = (channels: { kind: string; value: string }[], kind: string) => channels.find((c) => c.kind === kind)?.value ?? null;
  const tab = (r: PartyRole | null) => { const q = new URLSearchParams(); if (r) q.set("role", r); return `${scope.base}${q.size ? `?${q}` : ""}`; };
  // το παράθυρο «Επαφές και τηλέφωνα»: ?contacts=<id>, μόνο όταν δεν είναι ήδη ανοιχτή η γρήγορη προβολή
  const contactsParty = !peek && typeof sp.contacts === "string" ? await db.party.findFirst({ where: { id: sp.contacts, orgId: scope.orgId }, include: { channels: { orderBy: [{ kind: "desc" }, { isPrimary: "desc" }, { id: "asc" }] }, contacts: { where: { active: true }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }], include: { person: { include: { channels: { orderBy: { isPrimary: "desc" } } } } } } } }) : null;

  // ---- Παράθυρο «Επαφές και τηλέφωνα»: ίδιες ενέργειες με την καρτέλα, χωρίς αναχώρηση από τη λίστα ----
  // μετά την αποθήκευση ο server γυρνά εδώ: το back κρατά το ?contacts=, ώστε το παράθυρο να μένει ανοιχτό (π.χ. για πολλά τηλέφωνα σερί)
  const back = contactsParty ? here(undefined, contactsParty.id) : here();
  const INPUT = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11";
  type Channel = { id: string; kind: string; value: string; label: string | null; isPrimary: boolean };
  const chip = (partyId: string, ch: Channel) => (
    <span key={ch.id} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border bg-card py-0.5 pr-1 pl-2 text-sm">
      <a href={channelHref(ch.kind, ch.value)} className="inline-flex min-h-7 min-w-0 items-center gap-1.5 font-medium underline-offset-2 hover:underline pointer-coarse:min-h-11">
        {ch.kind === "email" ? <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="truncate">{ch.kind === "phone" ? showPhone(ch.value) : ch.value}</span>
      </a>
      {ch.label ? <span className="text-xs text-muted-foreground">{ch.label}</span> : null}
      {ch.isPrimary ? <Star className="size-3.5 shrink-0 fill-gold text-gold" aria-label="Κύριο" /> : scope.canEdit ? <form action={primaryChannel.bind(null, partyId, ch.id)}><input type="hidden" name="back" value={back} /><Submit aria-label={`Ορισμός ως κύριου: ${ch.value}`} title="Ορισμός ως κύριου" className={btn("ghost", "sm", "w-7.5 px-0 text-muted-foreground")}><Star /></Submit></form> : null}
      {scope.canEdit ? <form action={deleteChannel.bind(null, partyId, ch.id)}><input type="hidden" name="back" value={back} /><Submit aria-label={`Διαγραφή: ${ch.value}`} title="Διαγραφή" className={btn("ghost", "sm", "w-7.5 px-0 text-muted-foreground")}><Trash2 /></Submit></form> : null}
    </span>
  );
  const channelForm = (partyId: string, personId?: string) => (
    <form action={saveChannel.bind(null, partyId)} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="back" value={back} />
      {personId ? <input type="hidden" name="personId" value={personId} /> : null}
      <Select label="Είδος" name="kind" className={cn(INPUT, "w-32")} options={[["phone", "Τηλέφωνο"], ["email", "Email"]]} />
      <label className="min-w-40 flex-1 space-y-1 text-xs font-medium text-muted-foreground">Αριθμός ή διεύθυνση<input name="value" required maxLength={160} className={INPUT} /></label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground">Ετικέτα<input name="label" list="channel-labels" maxLength={40} placeholder="π.χ. Κινητό" className={cn(INPUT, "w-36")} /></label>
      <Submit className={btn("outline")}><Plus /> Προσθήκη</Submit>
    </form>
  );
  const contactsModal = (c: NonNullable<typeof contactsParty>) => (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold">Τηλέφωνα και email της επιχείρησης</h3>
        <div className="mt-2 flex flex-wrap gap-2">{c.channels.length ? c.channels.map((x) => chip(c.id, x)) : <span className="text-sm text-muted-foreground">Κανένα ακόμα</span>}</div>
        {scope.canEdit ? <div className="mt-3">{channelForm(c.id)}</div> : null}
      </section>
      <section>
        <h3 className="text-sm font-semibold">Επαφές</h3>
        {c.contacts.length ? (
          <ul className="mt-2 space-y-2">
            {c.contacts.map((x) => (
              <li key={x.id} className="rounded-lg border border-border/70 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground" aria-hidden>{initials(x.person.name)}</span>
                  <span className="min-w-0 flex-1"><b className="block truncate">{x.person.name}{x.isPrimary ? <Star className="ml-1 inline size-3.5 fill-gold text-gold" aria-label="Κύρια επαφή" /> : null}</b>{x.title ? <span className="block truncate text-xs text-muted-foreground">{x.title}</span> : null}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">{x.person.channels.length ? x.person.channels.map((ch) => chip(c.id, ch)) : <span className="text-sm text-muted-foreground">Χωρίς τηλέφωνο ή email</span>}</div>
                {scope.canEdit ? (
                  <details className="group mt-2">
                    <summary className={cn(btn("ghost", "sm"), "inline-flex list-none [&::-webkit-details-marker]:hidden")}><Pencil /> <span className="group-open:hidden">Αλλαγή</span><span className="hidden group-open:inline">Κλείσιμο</span></summary>
                    <div className="mt-3 space-y-4 rounded-lg bg-secondary/50 p-4">
                      <form action={saveContact.bind(null, c.id, x.id)} className="grid gap-4 sm:grid-cols-2">
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="addressId" value={x.addressId ?? ""} />
                        <Field label="Ονοματεπώνυμο" name="name" maxLength={120} required defaultValue={x.person.name} />
                        <Field label="Ιδιότητα εδώ" name="title" maxLength={80} defaultValue={x.title ?? ""} placeholder="π.χ. Λογιστήριο" />
                        <div className="sm:col-span-2"><Field label="Σημειώσεις" name="notes" maxLength={300} defaultValue={x.notes ?? ""} /></div>
                        <Submit className={btn("default", "sm", "sm:col-span-2 sm:justify-self-end")}>Αποθήκευση</Submit>
                      </form>
                      <div className="space-y-2 border-t border-border pt-4"><p className="text-sm font-semibold">Νέο τηλέφωνο ή email: {x.person.name}</p>{channelForm(c.id, x.personId)}</div>
                      <div className="border-t border-border pt-4"><form action={deleteContact.bind(null, c.id, x.id)}><input type="hidden" name="back" value={back} /><Submit className={btn("ghost", "sm", "text-destructive")}><Trash2 /> Αφαίρεση από εδώ</Submit></form></div>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted-foreground">Καμία επαφή ακόμα</p>}
        {scope.canEdit ? (
          <form action={saveContact.bind(null, c.id, null)} className="mt-3 grid gap-4 rounded-lg border border-dashed border-border p-4 sm:grid-cols-2">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="addressId" value="" />
            <input type="hidden" name="notes" value="" />
            <p className="text-sm font-semibold sm:col-span-2"><UserPlus className="mr-1 inline size-4" aria-hidden /> Νέα επαφή</p>
            <Field label="Ονοματεπώνυμο" name="name" maxLength={120} required />
            <Field label="Ιδιότητα εδώ" name="title" maxLength={80} placeholder="π.χ. Λογιστήριο" />
            <Field label="Τηλέφωνο" name="phone" type="tel" maxLength={40} />
            <Field label="Email" name="email" type="email" maxLength={160} />
            <Submit className={btn("default", "sm", "sm:col-span-2 sm:justify-self-end")}>Προσθήκη</Submit>
          </form>
        ) : null}
      </section>
    </div>
  );

  return (
    <Page section={scope.section} title="Συναλλασσόμενοι" description={scope.orgId ? "Όλοι όσοι συναλλάσσεσαι, μία φορά ο καθένας: πελάτες, προμηθευτές, franchisees, συνεργάτες" : "Οι συναλλασσόμενοι της πλατφόρμας: οι συνδρομητές ως πελάτες, οι προμηθευτές και οι συνεργάτες μας"}
      actions={scope.can("add") ? <Modal wide label={<><Plus /> Νέος συναλλασσόμενος</>} variant="default" title="Νέος συναλλασσόμενος" description="Γράψε το ΑΦΜ και πάτα «Εύρεση στοιχείων»: τα υπόλοιπα έρχονται από το μητρώο"><PartyForm action={saveParty.bind(null, null)} refs={refs} defaultRole={role ?? undefined} /></Modal> : null}>
      <div className="max-w-7xl space-y-4">
        <datalist id="channel-labels">{CHANNEL_LABELS.map((l) => <option key={l} value={l} />)}</datalist>
        {typeof sp.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {sp.error.slice(0, 200)}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {roleKeys.slice(0, 3).map((r, i) => (
            <Card key={r} className="px-5 py-4">
              <p className="font-medium text-muted-foreground">{PARTY_ROLES[r].plural}</p>
              <p className="mt-1.5 text-3xl leading-tight font-semibold tabular-nums">{perRole[i]}</p>
              <p className="mt-1.5 text-muted-foreground">{PARTY_ROLES[r].hint}</p>
            </Card>
          ))}
          <Card className="px-5 py-4">
            <p className="font-medium text-muted-foreground">Θέλουν συμπλήρωση</p>
            <p className={cn("mt-1.5 text-3xl leading-tight font-semibold tabular-nums", incomplete ? "text-destructive" : "")}>{incomplete}</p>
            <p className="mt-1.5 text-muted-foreground">{incomplete ? "Ενεργοί χωρίς ΑΦΜ ή χωρίς διεύθυνση: δεν βγαίνει τιμολόγιο" : "Όλοι οι ενεργοί έχουν ΑΦΜ και διεύθυνση"}</p>
          </Card>
        </div>
        <Card>
          <nav aria-label="Ρόλος" className="flex flex-wrap gap-1 border-b border-border/70 px-3 py-2.5">
            {[null, ...roleKeys].map((r, i) => (
              <Link key={r ?? "all"} href={tab(r)} aria-current={role === r ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", role === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
                {r ? PARTY_ROLES[r].plural : "Όλοι"} <span className="tabular-nums opacity-70">{r ? perRole[i - 1] : all}</span>
              </Link>
            ))}
          </nav>
          <DataTable
            id="parties"
            listing={{ ...list, total, placeholder: "Επωνυμία, ΑΦΜ, πόλη ή επαφή", filters: [{ key: "region", label: "Περιοχή", value: region, options: regionsInUse.map((r): [string, string] => [r, r]) }, { key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργοί"], ["inactive", "Ανενεργοί"]] }] }}
            empty={role ? `Κανένας με τον ρόλο «${PARTY_ROLES[role].label}» ακόμα` : "Κανένας συναλλασσόμενος ακόμα. Πάτησε «Νέος συναλλασσόμενος» για την πρώτη καρτέλα"}
            columns={[
              { key: "name", label: "Συναλλασσόμενος", required: true, sortable: true },
              { key: "roles", label: "Ρόλοι" },
              { key: "city", label: "Έδρα · περιοχή", sortable: true },
              { key: "contact", label: "Κύρια επαφή" },
              { key: "last", label: "Τελευταία επικοινωνία" },
              { key: "next", label: "Επόμενο βήμα" },
            ]}
            rows={rows.map((c) => {
              const g = glance(c.id);
              const main = g.contacts[0];
              const phone = c.phone ?? (main ? channelOf(main.person.channels, "phone") : null), email = c.email ?? (main ? channelOf(main.person.channels, "email") : null);
              const tone = contactTone(g.last?.at ?? null, now);
              const state = g.next ? taskState({ dueAt: g.next.dueAt, doneAt: null }, now) : null;
              return {
                id: c.id,
                cells: {
                  name: <div className="min-w-0"><Link href={here(c.id)} scroll={false} prefetch={false} title="Γρήγορη προβολή" className="font-semibold underline-offset-2 hover:underline">{c.name}</Link><span className="block text-xs text-muted-foreground">{c.vatNumber ? `ΑΦΜ ${c.countryCode === "GR" ? "" : `${c.countryCode} `}${c.vatNumber}` : "χωρίς ΑΦΜ: δεν βγαίνει τιμολόγιο"}{c.vatCheckedAt ? " · επιβεβαιωμένο" : ""}{c.active ? "" : " · ανενεργός"}</span></div>,
                  roles: <RoleBadges roles={c.roles} />,
                  city: c.city || c.region ? <span className="inline-flex items-center gap-1">{c.latitude != null ? <MapPin className="size-3.5 text-muted-foreground" aria-label="Έχει θέση στον χάρτη" /> : null}{[c.city, c.region].filter(Boolean).join(" · ")}{c._count.addresses ? <span className="text-muted-foreground"> · {c._count.addresses} υποκ.</span> : null}</span> : <span className="text-muted-foreground">—</span>,
                  contact: main || c.contactName || phone || email ? <div className="min-w-0">{main?.person.name ?? c.contactName ?? (phone ? showPhone(phone) : email)}{g.contacts.length > 1 ? <span className="text-muted-foreground"> +{g.contacts.length - 1}</span> : null}<span className="block text-xs text-muted-foreground">{[main?.title, main || c.contactName ? (phone ? showPhone(phone) : email) : null].filter(Boolean).join(" · ")}</span></div> : <span className="text-muted-foreground">—</span>,
                  last: g.last ? <Badge tone={tone}>{ago(g.last.at, now)}</Badge> : <span className="text-muted-foreground">Καμία ακόμα</span>,
                  next: g.next ? <div className="min-w-0"><span className="block truncate">{g.next.subject}</span><span className={cn("block text-xs", state === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground")}>{dueText(g.next.dueAt, now)}</span></div> : <span className="text-muted-foreground">—</span>,
                },
                menu: (
                  <>
                    {scope.canEdit ? <QuickActions key="log" menuItems action={logActivity.bind(null, c.id)} name={c.name} phone={phone} email={email} contacts={g.contacts.map((x): [string, string] => [x.personId, x.person.name])} /> : null}
                    <Link key="peek" href={here(c.id)} scroll={false} prefetch={false} role="menuitem" className={menuItem}><PanelRight /> Γρήγορη προβολή</Link>
                    <Link key="open" href={`${scope.base}/${c.id}`} role="menuitem" className={menuItem}><Eye /> Άνοιγμα καρτέλας</Link>
                    {/* prefetch={false}: αλλιώς ο router θα προ-φόρτωνε 25 εκδόσεις της σελίδας (μία ανά παράθυρο) */}
                    <Link key="contacts" href={here(undefined, c.id)} scroll={false} prefetch={false} role="menuitem" className={menuItem}><Phone /> Επαφές και τηλέφωνα</Link>
                    {c.linkedOrg ? <Link key="org" href={`/platform/${c.linkedOrg.id}`} role="menuitem" className={menuItem}><Eye /> Σελίδα συνδρομητή</Link> : null}
                    {scope.canEdit ? <form key="toggle" action={toggleParty.bind(null, c.id)}><Submit role="menuitem" className={menuItem}><Power /> {c.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form> : null}
                  </>
                ),
              };
            })}
          />
        </Card>
      </div>
      {peek ? (
        <Drawer key={peek.id} title={peek.name} closeHref={here()}>
          <div className="space-y-5 p-5">
            <div>
              <h2 className="text-xl leading-tight">{peek.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{[peek.tradeName, peek.city, peek.vatNumber ? `ΑΦΜ ${peek.vatNumber}` : null].filter(Boolean).join(" · ")}</p>
              <div className="mt-2"><RoleBadges roles={peek.roles} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {scope.canEdit ? <QuickActions action={logActivity.bind(null, peek.id)} name={peek.name} phone={peek.phone ?? (peek.contacts[0] ? channelOf(peek.contacts[0].person.channels, "phone") : null)} email={peek.email ?? (peek.contacts[0] ? channelOf(peek.contacts[0].person.channels, "email") : null)} contacts={peek.contacts.map((x): [string, string] => [x.personId, x.person.name])} labels className="w-full" /> : null}
              <Link href={`${scope.base}/${peek.id}`} className={btn("outline", "default", "w-full")}><Eye /> Άνοιγμα καρτέλας</Link>
            </div>
            <section>
              <h3 className="text-sm font-semibold">Τηλέφωνα και email</h3>
              {peek.channels.length ? (
                <ul className="mt-2 space-y-1.5">
                  {peek.channels.map((c) => <li key={c.id}><a href={channelHref(c.kind, c.value)} className="inline-flex min-h-7 items-center gap-2 font-medium underline-offset-2 hover:underline pointer-coarse:min-h-11">{c.kind === "email" ? <Mail className="size-4 text-muted-foreground" aria-hidden /> : <Phone className="size-4 text-muted-foreground" aria-hidden />}{c.kind === "phone" ? showPhone(c.value) : c.value}{c.label ? <span className="text-xs font-normal text-muted-foreground">{c.label}</span> : null}{c.isPrimary ? <Star className="size-3.5 fill-gold text-gold" aria-label="Κύριο" /> : null}</a></li>)}
                </ul>
              ) : <p className="mt-1 text-sm text-muted-foreground">Δεν έχουν καταχωρηθεί</p>}
            </section>
            <section>
              <h3 className="text-sm font-semibold">Επαφές</h3>
              {peek.contacts.length ? (
                <ul className="mt-2 space-y-2">
                  {peek.contacts.slice(0, 5).map((c) => {
                    const tel = channelOf(c.person.channels, "phone"), mail = channelOf(c.person.channels, "email");
                    return (
                      <li key={c.id} className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground" aria-hidden>{initials(c.person.name)}</span>
                        <span className="min-w-0 flex-1"><b className="block truncate">{c.person.name}</b><span className="block truncate text-xs text-muted-foreground">{[c.title, tel ? showPhone(tel) : mail].filter(Boolean).join(" · ") || "Χωρίς στοιχεία"}</span></span>
                        {tel ? <a href={channelHref("phone", tel)} aria-label={`Κλήση: ${c.person.name}`} className={btn("ghost", "sm")}><Phone /></a> : null}
                        {mail ? <a href={channelHref("email", mail)} aria-label={`Email: ${c.person.name}`} className={btn("ghost", "sm")}><Mail /></a> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="mt-1 text-sm text-muted-foreground">Καμία επαφή ακόμα</p>}
            </section>
            <section>
              <h3 className="text-sm font-semibold">Επόμενο βήμα</h3>
              {peekTasks[0] ? (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <CalendarClock className="size-4 shrink-0 text-gold-ink" aria-hidden />
                  <span className="min-w-0 flex-1"><b className="block truncate">{peekTasks[0].title}</b><span className={cn("text-xs", taskState(peekTasks[0].task!, now) === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground")}>{dueText(peekTasks[0].task!.dueAt, now)}{peekTasks.length > 1 ? ` · και ${peekTasks.length - 1} ακόμα` : ""}</span></span>
                  {scope.canEdit ? <form action={touchActivity.bind(null, peek.id, peekTasks[0].id, "done")}><Submit className={btn("outline", "sm")}>Έγινε</Submit></form> : null}
                </div>
              ) : <p className="mt-1 text-sm text-muted-foreground">Καμία ανοιχτή εργασία</p>}
            </section>
            {scope.canEdit ? <section><h3 className="mb-2 text-sm font-semibold">Γρήγορη καταγραφή</h3><ActivityForm action={logActivity.bind(null, peek.id)} contacts={peek.contacts.map((x): [string, string] => [x.personId, x.person.name])} /></section> : null}
            <section>
              <h3 className="text-sm font-semibold">Τελευταίες ενέργειες</h3>
              <div className="-mx-5 mt-1"><Timeline items={peekItems.slice(0, 6)} now={now} compact empty="Τίποτα ακόμα" /></div>
            </section>
          </div>
        </Drawer>
      ) : null}
      {contactsParty ? (
        <RoutedModal key={contactsParty.id} title="Επαφές και τηλέφωνα" description={contactsParty.name} closeHref={here()}>
          {contactsModal(contactsParty)}
        </RoutedModal>
      ) : null}
    </Page>
  );
}
