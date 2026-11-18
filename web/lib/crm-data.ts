// Τα δεδομένα του CRM από τη βάση: ενέργειες ενός συναλλασσόμενου και ό,τι σχετικό έχει γίνει «μόνο του»
// (αρχεία, και για συνδρομητή της πλατφόρμας: αιτήματα, χρεώσεις, παύσεις). Η συγχώνευση γίνεται στο lib/crm.ts.
import { ACTIVITY_KINDS, type ActivityKind, type TimelineItem } from "./crm";
import { db } from "./db";
import { euro } from "./money";
import { STATUS } from "./support/rules";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });
const TITLE: Record<string, [out: string, into: string]> = { call: ["Κλήση προς αυτόν", "Κλήση από αυτόν"], email: ["Email που στείλαμε", "Email που λάβαμε"] };

type Activity = Awaited<ReturnType<typeof db.partyActivity.findMany>>[number] & { person?: { name: string } | null };
export const activityItem = (a: Activity): TimelineItem => ({
  id: a.id, at: a.at, kind: a.kind, pinned: a.pinned, source: a.source, direction: a.direction, who: a.userName, person: a.person?.name ?? null,
  title: a.subject ?? TITLE[a.kind]?.[a.direction === "in" ? 1 : 0] ?? ACTIVITY_KINDS[a.kind as ActivityKind]?.label ?? "Ενέργεια",
  text: [a.body, a.durationMin ? `Διάρκεια ${a.durationMin}′` : null].filter(Boolean).join("\n") || null,
  task: a.kind === "task" ? { dueAt: a.dueAt, doneAt: a.doneAt } : undefined,
});

/** Όλες οι πηγές του χρονολογίου ενός συναλλασσόμενου, μία λίστα ανά πηγή. */
export async function partyEvents(party: { id: string; orgId: string | null; linkedOrgId: string | null }): Promise<TimelineItem[][]> {
  const linked = party.orgId === null ? party.linkedOrgId : null; // μόνο το προσωπικό της πλατφόρμας βλέπει τα του συνδρομητή
  const [activities, files, tickets, charges, pauses] = await Promise.all([
    db.partyActivity.findMany({ where: { partyId: party.id }, orderBy: { at: "desc" }, take: 300, include: { person: { select: { name: true } } } }),
    db.storedFile.findMany({ where: { orgId: party.orgId, refType: "customer", refId: party.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    linked ? db.ticket.findMany({ where: { orgId: linked }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
    linked ? db.subscriptionCharge.findMany({ where: { subscription: { orgId: linked } }, orderBy: { periodStart: "desc" }, take: 36 }) : [],
    linked ? db.storePause.findMany({ where: { orgId: linked }, orderBy: { startedAt: "desc" }, take: 30, include: { store: { select: { name: true } } } }) : [],
  ]);
  return [
    activities.map(activityItem),
    files.map((f) => ({ id: `file-${f.id}`, at: f.createdAt, kind: "file", auto: true, title: `Ανέβηκε αρχείο: ${f.name}`, href: `/api/files/${f.id}` })),
    tickets.map((t) => ({ id: `ticket-${t.id}`, at: t.createdAt, kind: "ticket", auto: true, title: `Αίτημα #${t.number}: ${t.subject}`, text: `${STATUS[t.status].label} · το άνοιξε ${t.openedByName}`, href: `/platform/support/${t.id}`, tone: STATUS[t.status].tone })),
    charges.map((c) => ({ id: `charge-${c.id}`, at: c.periodStart, kind: "charge", auto: true, title: `Χρέωση συνδρομής ${euro(c.amountCents)}${c.planName ? ` · ${c.planName}` : ""}`, text: c.paidAt ? `Πληρώθηκε ${day.format(c.paidAt)}` : "Απλήρωτη", tone: c.paidAt ? ("success" as const) : ("warning" as const) })),
    pauses.map((p) => ({ id: `pause-${p.id}`, at: p.startedAt, kind: "pause", auto: true, title: `Παύση καταστήματος: ${p.store.name}`, text: p.endedAt ? `Έληξε ${day.format(p.endedAt)}` : "Σε ισχύ", who: p.startedByName })),
  ];
}

/** Για τις γραμμές μιας λίστας: κύρια επαφή, τελευταία επικοινωνία και επόμενη ανοιχτή εργασία ανά συναλλασσόμενο. */
export async function partyGlance(ids: string[]) {
  const [contacts, last, next] = await Promise.all([
    db.partyContact.findMany({ where: { partyId: { in: ids }, active: true }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }], include: { person: { include: { channels: { orderBy: { isPrimary: "desc" } } } } } }),
    db.partyActivity.findMany({ where: { partyId: { in: ids }, kind: { in: ["call", "email", "meeting"] } }, orderBy: { at: "desc" }, distinct: ["partyId"], select: { partyId: true, at: true, kind: true } }),
    db.partyActivity.findMany({ where: { partyId: { in: ids }, kind: "task", doneAt: null }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { at: "asc" }], distinct: ["partyId"], select: { partyId: true, subject: true, dueAt: true } }),
  ]);
  const by = <T extends { partyId: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) m.set(r.partyId, [...(m.get(r.partyId) ?? []), r]); return m; };
  const c = by(contacts), l = by(last), n = by(next);
  return (id: string) => ({ contacts: c.get(id) ?? [], last: l.get(id)?.[0] ?? null, next: n.get(id)?.[0] ?? null });
}
