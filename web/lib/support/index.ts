// Support desk: άνοιγμα αιτήματος, μηνύματα, καταστάσεις, πρόσβαση. Κοινό για τον πελάτη και την υποστήριξη.
import type { getUser } from "../auth";
import { db } from "../db";
import { appUrl, platformSettings, sendMail } from "../mail/send";
import { templates } from "../mail/templates";
import { orgPermissionsOf, platformCan } from "../permissions";
import { afterMessage, type Category, priorityFor, type Status, type Urgency } from "./rules";

type User = NonNullable<Awaited<ReturnType<typeof getUser>>>;
export class SupportError extends Error {}

export const isSupport = (user: User) => platformCan(user, "support.tickets");
/** Η επιχείρηση του χρήστη και αν βλέπει όλα τα αιτήματά της (αλλιώς μόνο τα δικά του). */
export function memberScope(user: User) {
  const m = user.memberships[0];
  return m ? { orgId: m.orgId, all: orgPermissionsOf(m.role).includes("tickets.manage") } : null;
}
/** Η υποστήριξη βλέπει όλα· ο χρήστης πελάτη μόνο της επιχείρησής του, και χωρίς το δικαίωμα μόνο όσα άνοιξε ο ίδιος. */
export function canView(user: User, ticket: { orgId: string; openedById: string | null }) {
  if (isSupport(user)) return true;
  const s = memberScope(user);
  return !!s && s.orgId === ticket.orgId && (s.all || ticket.openedById === user.id);
}

export async function openTicket(t: { user: User; orgId: string; subject: string; category: Category; urgency: Urgency; deviceId: string | null; body: string }) {
  const device = t.deviceId ? await db.device.findFirst({ where: { id: t.deviceId, store: { orgId: t.orgId } } }) : null;
  const ticket = await db.ticket.create({
    data: {
      orgId: t.orgId, subject: t.subject, category: t.category, priority: priorityFor(t.category, t.urgency), deviceId: device?.id ?? null,
      openedById: t.user.id, openedByName: t.user.name,
      messages: { create: { authorKind: "customer", authorId: t.user.id, authorName: t.user.name, body: t.body } },
    },
    include: { org: true },
  });
  const brand = await platformSettings();
  // η υποστήριξη μαθαίνει για το νέο αίτημα στο email της πλατφόρμας (αν έχει οριστεί)
  if (brand.supportEmail) await sendMail({ to: brand.supportEmail, template: "ticket", mail: templates.ticket(brand, { name: "ομάδα", number: ticket.number, subject: ticket.subject, intro: `Νέο αίτημα από ${ticket.org.name}`, text: t.body, url: `${await appUrl()}/platform/support/${ticket.id}` }) });
  return ticket;
}

/** Προσθέτει μήνυμα και μετακινεί το αίτημα στη σωστή κατάσταση. Η πρώτη δημόσια απάντηση της υποστήριξης σταματά το ρολόι. */
export async function addMessage(m: { ticketId: string; user: User; body: string; internal: boolean }) {
  const ticket = await db.ticket.findUnique({ where: { id: m.ticketId }, include: { org: true } });
  if (!ticket || !canView(m.user, ticket)) throw new SupportError("Το αίτημα δεν βρέθηκε");
  const by = isSupport(m.user) ? "support" : "customer";
  const internal = by === "support" && m.internal; // ο πελάτης δεν γράφει εσωτερικές σημειώσεις
  if (ticket.status === "CLOSED" && by === "customer") throw new SupportError("Το αίτημα έχει κλείσει. Άνοιξε νέο αίτημα");
  const status: Status = afterMessage(ticket.status, by, internal);
  await db.$transaction([
    db.ticketMessage.create({ data: { ticketId: ticket.id, authorKind: by, authorId: m.user.id, authorName: m.user.name, body: m.body, internal } }),
    db.ticket.update({
      where: { id: ticket.id },
      data: {
        status,
        ...(by === "support" && !internal && !ticket.firstResponseAt ? { firstResponseAt: new Date() } : {}),
        ...(by === "support" && !ticket.assigneeId ? { assigneeId: m.user.id, assigneeName: m.user.name } : {}),
        ...(status === "OPEN" ? { resolvedAt: null } : {}),
      },
    }),
  ]);
  if (by === "support" && !internal && ticket.openedById) {
    const opener = await db.user.findUnique({ where: { id: ticket.openedById } });
    if (opener) await sendMail({ to: opener.email, org: ticket.org, template: "ticket", mail: templates.ticket(await platformSettings(), { name: opener.name, number: ticket.number, subject: ticket.subject, intro: "Η υποστήριξη απάντησε στο αίτημά σου", text: m.body, url: `${await appUrl(ticket.org)}/support/${ticket.id}` }) });
  }
}

/** «Λύθηκε» από οποιαδήποτε πλευρά. Ο πελάτης μπορεί να το ξανανοίξει απαντώντας. */
export async function resolveTicket(ticketId: string, user: User) {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || !canView(user, ticket)) throw new SupportError("Το αίτημα δεν βρέθηκε");
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") return;
  await db.$transaction([
    db.ticket.update({ where: { id: ticketId }, data: { status: "RESOLVED", resolvedAt: new Date() } }),
    db.ticketMessage.create({ data: { ticketId, authorKind: "system", authorName: "Σύστημα", body: `Σημειώθηκε ως λυμένο από ${isSupport(user) ? "την υποστήριξη" : user.name}` } }),
  ]);
}
