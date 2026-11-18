import { CalendarClock, Eye, Mail, MapPin, PanelRight, Phone, Plus, Power, Star } from "lucide-react";
import Link from "next/link";
import { ActivityForm } from "@/components/crm/activity-form";
import { Drawer } from "@/components/crm/drawer";
import { QuickActions } from "@/components/crm/quick-actions";
import { Timeline } from "@/components/crm/timeline";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { RoleBadges } from "@/components/party-bits";
import { PartyForm } from "@/components/party-form";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, menuItem, Page } from "@/components/ui";
import { ago, channelHref, contactTone, dueText, initials, showPhone, taskState } from "@/lib/crm";
import { activityItem, partyGlance } from "@/lib/crm-data";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { isPartyRole, PARTY_ROLES, type PartyRole } from "@/lib/parties";
import { partyScope } from "@/lib/party-scope";
import { partyRefs } from "@/lib/refs";
import { logActivity, saveParty, toggleParty, touchActivity } from "./actions";

// Η λίστα συναλλασσομένων: της επιχείρησης του χρήστη ή, για το προσωπικό, της πλατφόρμας (ίδια σελίδα, άλλο πεδίο).
export default async function PartiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await partyScope();
  const sp = await searchParams;
  const list = listParams(sp, 25, ["name", "city", "created"]);
  const status = filterParam(sp, "status", ["active", "inactive"]);
  const role = isPartyRole(sp.role) ? sp.role : null;
  const refs = await partyRefs();
  const region = filterParam(sp, "region", refs.regions);
  const like = { contains: list.q, mode: "insensitive" as const };
  const mine = { orgId: scope.orgId };
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
  const glance = await partyGlance(rows.map((r) => r.id));
  // γρήγορη προβολή: ?peek=<id> πάνω στην ίδια λίστα, με τα ίδια φίλτρα
  const here = (peek?: string) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "peek" && k !== "error") u.set(k, v); if (peek) u.set("peek", peek); return `${scope.base}${u.size ? `?${u}` : ""}`; };
  const peek = typeof sp.peek === "string" ? await db.party.findFirst({ where: { id: sp.peek, orgId: scope.orgId }, include: { channels: { orderBy: [{ kind: "desc" }, { isPrimary: "desc" }] }, contacts: { where: { active: true }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }], include: { person: { include: { channels: { orderBy: { isPrimary: "desc" } } } } } }, activities: { orderBy: { at: "desc" }, take: 60, include: { person: { select: { name: true } } } } } }) : null;
  const peekItems = peek?.activities.map(activityItem) ?? [];
  const peekTasks = peekItems.filter((i) => i.task && !i.task.doneAt).sort((a, b) => (a.task!.dueAt?.getTime() ?? Infinity) - (b.task!.dueAt?.getTime() ?? Infinity));
  const channelOf = (channels: { kind: string; value: string }[], kind: string) => channels.find((c) => c.kind === kind)?.value ?? null;
  const tab = (r: PartyRole | null) => { const q = new URLSearchParams(); if (r) q.set("role", r); return `${scope.base}${q.size ? `?${q}` : ""}`; };

  return (
    <Page section={scope.section} title="Συναλλασσόμενοι" description={scope.orgId ? "Όλοι όσοι συναλλάσσεσαι, μία φορά ο καθένας: πελάτες, προμηθευτές, franchisees, συνεργάτες" : "Οι συναλλασσόμενοι της πλατφόρμας: οι συνδρομητές ως πελάτες, οι προμηθευτές και οι συνεργάτες μας"}
      actions={scope.canEdit ? <Modal label={<><Plus /> Νέος συναλλασσόμενος</>} variant="default" title="Νέος συναλλασσόμενος" description="Γράψε το ΑΦΜ και πάτα «Εύρεση στοιχείων»: τα υπόλοιπα έρχονται από το μητρώο"><PartyForm action={saveParty.bind(null, null)} refs={refs} defaultRole={role ?? undefined} /></Modal> : null}>
      <div className="max-w-7xl space-y-4">
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
            listing={{ ...list, total, placeholder: "Επωνυμία, ΑΦΜ, πόλη ή επαφή", filters: [{ key: "region", label: "Περιοχή", value: region, options: refs.regions.map((r): [string, string] => [r, r]) }, { key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργοί"], ["inactive", "Ανενεργοί"]] }] }}
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
                  name: <div className="min-w-0"><Link href={here(c.id)} scroll={false} title="Γρήγορη προβολή" className="font-semibold underline-offset-2 hover:underline">{c.name}</Link><span className="block text-xs text-muted-foreground">{c.vatNumber ? `ΑΦΜ ${c.countryCode === "GR" ? "" : `${c.countryCode} `}${c.vatNumber}` : "χωρίς ΑΦΜ: δεν βγαίνει τιμολόγιο"}{c.vatCheckedAt ? " · επιβεβαιωμένο" : ""}{c.active ? "" : " · ανενεργός"}</span></div>,
                  roles: <RoleBadges roles={c.roles} />,
                  city: c.city || c.region ? <span className="inline-flex items-center gap-1">{c.latitude != null ? <MapPin className="size-3.5 text-muted-foreground" aria-label="Έχει θέση στον χάρτη" /> : null}{[c.city, c.region].filter(Boolean).join(" · ")}{c._count.addresses ? <span className="text-muted-foreground"> · {c._count.addresses} υποκ.</span> : null}</span> : <span className="text-muted-foreground">—</span>,
                  contact: main || c.contactName || phone || email ? <div className="min-w-0">{main?.person.name ?? c.contactName ?? (phone ? showPhone(phone) : email)}{g.contacts.length > 1 ? <span className="text-muted-foreground"> +{g.contacts.length - 1}</span> : null}<span className="block text-xs text-muted-foreground">{[main?.title, main || c.contactName ? (phone ? showPhone(phone) : email) : null].filter(Boolean).join(" · ")}</span></div> : <span className="text-muted-foreground">—</span>,
                  last: g.last ? <Badge tone={tone}>{ago(g.last.at, now)}</Badge> : <span className="text-muted-foreground">Καμία ακόμα</span>,
                  next: g.next ? <div className="min-w-0"><span className="block truncate">{g.next.subject}</span><span className={cn("block text-xs", state === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground")}>{dueText(g.next.dueAt, now)}</span></div> : <span className="text-muted-foreground">—</span>,
                },
                actions: scope.canEdit ? <QuickActions action={logActivity.bind(null, c.id)} name={c.name} phone={phone} email={email} contacts={g.contacts.map((x): [string, string] => [x.personId, x.person.name])} /> : null,
                menu: (
                  <>
                    <Link key="peek" href={here(c.id)} scroll={false} role="menuitem" className={menuItem}><PanelRight /> Γρήγορη προβολή</Link>
                    <Link key="open" href={`${scope.base}/${c.id}`} role="menuitem" className={menuItem}><Eye /> Άνοιγμα καρτέλας</Link>
                    <Link key="contacts" href={`${scope.base}/${c.id}?tab=contacts`} role="menuitem" className={menuItem}><Phone /> Επαφές και τηλέφωνα</Link>
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
    </Page>
  );
}
