// GDPR για όλη την εφαρμογή: συναινέσεις, αιτήματα διαγραφής (δικαίωμα στη λήθη), αντίγραφο δεδομένων και ημερολόγιο.
// Δύο επίπεδα με τον ίδιο κώδικα: scope = null → η πλατφόρμα για τα δικά της υποκείμενα· scope = orgId → ο πελάτης για τα δικά του.
import { headers } from "next/headers";
import type { getUser } from "../auth";
import { db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { platformSettings, sendMail } from "../mail/send";
import { templates } from "../mail/templates";
import { ALL_PERMISSIONS, platformCan } from "../permissions";
import { deleteFile } from "../storage";
import { dueDate, ERASED_NAME, type EventType, hasConsent, type Purpose, PURPOSES, subjectHash, type SubjectType } from "./rules";

type User = NonNullable<Awaited<ReturnType<typeof getUser>>>;
type Actor = { id: string; name: string } | null;
export class GdprError extends Error {}

/** Σε ποιο επίπεδο ανήκει ένας χρήστης ως υποκείμενο: στην επιχείρησή του, αλλιώς στην πλατφόρμα. */
export const scopeOf = (user: { memberships: { orgId: string }[] }) => user.memberships[0]?.orgId ?? null;

/** Μπορεί ο χρήστης να διαχειριστεί το GDPR αυτού του επιπέδου; Ο πελάτης μόνο το δικό του. */
export function canManageGdpr(user: User, scope: string | null) {
  if (scope === null) return platformCan(user.platformRole, "gdpr.manage");
  const m = user.memberships.find((x) => x.orgId === scope);
  return !!m && (m.role.locked ? ALL_PERMISSIONS : m.role.permissions).includes("gdpr.manage");
}

export const logEvent = (e: { orgId: string | null; type: EventType; actor: Actor; subjectType?: SubjectType; subjectId?: string | null; subjectLabel?: string | null; detail?: Prisma.InputJsonValue }, tx: Prisma.TransactionClient = db) =>
  tx.gdprEvent.create({ data: { orgId: e.orgId, type: e.type, actorId: e.actor?.id ?? null, actorLabel: e.actor?.name ?? "Σύστημα", subjectType: e.subjectType ?? null, subjectId: e.subjectId ?? null, subjectLabel: e.subjectLabel ?? null, detail: e.detail } });

/** Από πού ήρθε το αίτημα. Η διεύθυνση γράφεται μόνο πίσω από έμπιστο proxy (αλλιώς πλαστογραφείται). */
async function origin() {
  const h = await headers();
  return { ip: process.env.TRUST_PROXY === "1" ? (h.get("x-forwarded-for")?.split(",")[0].trim() ?? null) : null, userAgent: h.get("user-agent")?.slice(0, 200) ?? null };
}

// ---- Συναινέσεις ----

/** Η έκδοση που ισχύει σήμερα για έναν σκοπό, ή null αν ο σκοπός δεν είναι ενεργός (π.χ. δεν έχουν οριστεί νομικά κείμενα). */
export async function activeVersion(purpose: Purpose) {
  if (purpose !== "legal") return PURPOSES[purpose].version;
  const s = await platformSettings();
  return s.legalVersion && s.termsUrl && s.privacyUrl ? s.legalVersion : null;
}

/** Καταγράφει ότι δόθηκε ή ανακλήθηκε συναίνεση (νέα γραμμή κάθε φορά) και το γράφει στο ημερολόγιο. */
export async function recordConsent(c: { orgId: string | null; subjectType: SubjectType; subjectId: string; subjectLabel: string; purpose: Purpose; granted: boolean; source: "activation" | "self" | "admin"; actor: Actor }) {
  const version = await activeVersion(c.purpose);
  if (!version) throw new GdprError("Ο σκοπός αυτός δεν είναι ενεργός");
  if (!c.granted && PURPOSES[c.purpose].required) throw new GdprError("Η αποδοχή των όρων δεν ανακαλείται· ζήτησε διαγραφή του λογαριασμού");
  const from = c.source === "admin" ? { ip: null, userAgent: null } : await origin();
  await db.$transaction(async (tx) => {
    await tx.consent.create({ data: { orgId: c.orgId, subjectType: c.subjectType, subjectId: c.subjectId, purpose: c.purpose, version, granted: c.granted, source: c.source, ...from } });
    await logEvent({ orgId: c.orgId, type: c.granted ? "CONSENT_GRANTED" : "CONSENT_WITHDRAWN", actor: c.actor, subjectType: c.subjectType, subjectId: c.subjectId, subjectLabel: c.subjectLabel, detail: { purpose: c.purpose, version, source: c.source } }, tx);
  });
}

export const consentsOf = (subjectType: SubjectType, subjectId: string) => db.consent.findMany({ where: { subjectType, subjectId }, orderBy: { at: "asc" } });

/** Πρέπει ο χρήστης να αποδεχτεί (ξανά) τα νομικά κείμενα πριν συνεχίσει; */
export async function needsLegalConsent(userId: string) {
  const version = await activeVersion("legal");
  return !!version && !hasConsent(await consentsOf("user", userId), "legal", version);
}

// ---- Δικαίωμα στη λήθη ----

/** Ανοίγει αίτημα διαγραφής. Ένα ανοιχτό αίτημα ανά υποκείμενο. */
export async function requestErasure(r: { orgId: string | null; subjectType: SubjectType; subjectId: string | null; name: string; email?: string | null; reason?: string | null; actor: Actor }) {
  const hash = subjectHash(r.email || r.name);
  const open = await db.erasureRequest.findFirst({ where: { orgId: r.orgId, subjectHash: hash, status: "PENDING" } });
  if (open) throw new GdprError("Υπάρχει ήδη ανοιχτό αίτημα διαγραφής για αυτό το πρόσωπο");
  const now = new Date();
  const label = [r.name, r.email].filter(Boolean).join(" · ");
  return db.$transaction(async (tx) => {
    const req = await tx.erasureRequest.create({ data: { orgId: r.orgId, subjectType: r.subjectType, subjectId: r.subjectId, subjectLabel: label, subjectHash: hash, reason: r.reason || null, requestedById: r.actor?.id ?? null, requestedAt: now, dueAt: dueDate(now) } });
    await logEvent({ orgId: r.orgId, type: "ERASURE_REQUESTED", actor: r.actor, subjectType: r.subjectType, subjectId: r.subjectId, subjectLabel: label, detail: { requestId: req.id, bySubject: r.actor?.id === r.subjectId } }, tx);
    return req;
  });
}

export async function rejectErasure(id: string, note: string, actor: Actor) {
  const req = await db.erasureRequest.findUnique({ where: { id } });
  if (!req || req.status !== "PENDING") throw new GdprError("Το αίτημα δεν είναι πια ανοιχτό");
  await db.$transaction(async (tx) => {
    await tx.erasureRequest.update({ where: { id }, data: { status: "REJECTED", decidedById: actor?.id ?? null, decidedAt: new Date(), decisionNote: note } });
    await logEvent({ orgId: req.orgId, type: "ERASURE_REJECTED", actor, subjectType: req.subjectType as SubjectType, subjectId: req.subjectId, subjectLabel: req.subjectLabel, detail: { requestId: id, note } }, tx);
  });
  await notify(req, "rejected", note);
}

/** Γράφει στο υποκείμενο το αποτέλεσμα (αν είναι χρήστης με email). Πριν από τη διαγραφή, όσο το email υπάρχει ακόμα. */
async function notify(req: { subjectType: string; subjectId: string | null }, outcome: "completed" | "rejected", note?: string) {
  if (req.subjectType !== "user" || !req.subjectId) return;
  const user = await db.user.findUnique({ where: { id: req.subjectId } });
  if (user) await sendMail({ to: user.email, template: "gdpr", mail: templates.gdpr(await platformSettings(), { name: user.name, outcome, note }) });
}

/**
 * Εκτελεί τη διαγραφή. Ό,τι αφορά το υποκείμενο σβήνεται ή ανωνυμοποιείται· μένουν μόνο όσα επιβάλλει ο νόμος
 * (παραστατικά, που δεν περιέχουν προσωπικά στοιχεία του) και η απόδειξη ότι το αίτημα εκτελέστηκε (αποτύπωμα, αριθμοί).
 */
export async function completeErasure(id: string, actor: Actor) {
  const req = await db.erasureRequest.findUnique({ where: { id } });
  if (!req || req.status !== "PENDING") throw new GdprError("Το αίτημα δεν είναι πια ανοιχτό");
  const subject = { subjectType: req.subjectType, subjectId: req.subjectId ?? "" };
  const user = req.subjectType === "user" && req.subjectId ? await db.user.findUnique({ where: { id: req.subjectId }, include: { memberships: { include: { role: true } } } }) : null;

  if (user) {
    // Δεν μένει επιχείρηση χωρίς ιδιοκτήτη, ούτε πλατφόρμα χωρίς διαχειριστή
    for (const m of user.memberships.filter((x) => x.role.locked)) {
      const others = await db.membership.count({ where: { orgId: m.orgId, role: { locked: true }, userId: { not: user.id } } });
      const anyone = await db.membership.count({ where: { orgId: m.orgId, userId: { not: user.id } } });
      if (others === 0 && anyone > 0) throw new GdprError("Είναι ο μόνος ιδιοκτήτης επιχείρησης με άλλους χρήστες. Όρισε πρώτα άλλον ιδιοκτήτη");
    }
    if (user.platformRole === "SUPER_ADMIN" && (await db.user.count({ where: { platformRole: "SUPER_ADMIN", id: { not: user.id } } })) === 0) throw new GdprError("Είναι ο μόνος Super Admin της πλατφόρμας");
    await notify(req, "completed");
  }
  const customer = req.subjectType === "customer" && req.subjectId ? await db.customer.findFirst({ where: { id: req.subjectId, orgId: req.orgId ?? "" } }) : null;

  // Αρχεία του υποκειμένου στο Bunny (φάκελος του πελάτη): πρώτα αυτά, γιατί δεν μπαίνουν σε συναλλαγή της βάσης
  const files = req.subjectId ? await db.storedFile.findMany({ where: { orgId: req.orgId, refType: req.subjectType, refId: req.subjectId } }) : [];
  for (const f of files) await deleteFile(f);

  const summary = await db.$transaction(async (tx) => {
    const counts: Record<string, number> = { files: files.length };
    if (req.subjectId) {
      counts.consents = (await tx.consent.updateMany({ where: subject, data: { ip: null, userAgent: null } })).count;
      await tx.gdprEvent.updateMany({ where: subject, data: { subjectLabel: null } });
      await tx.erasureRequest.updateMany({ where: { ...subject, id: { not: id } }, data: { subjectLabel: null } });
    }
    if (user) {
      counts.emails = (await tx.emailLog.updateMany({ where: { to: user.email }, data: { to: "[διαγράφηκε]" } })).count;
      counts.uploads = (await tx.storedFile.updateMany({ where: { uploadedById: user.id }, data: { uploadedById: null } })).count;
      await tx.gdprEvent.updateMany({ where: { actorId: user.id }, data: { actorLabel: ERASED_NAME } });
      counts.tickets = (await tx.ticket.updateMany({ where: { openedById: user.id }, data: { openedById: null, openedByName: ERASED_NAME } })).count;
      await tx.ticket.updateMany({ where: { assigneeId: user.id }, data: { assigneeId: null, assigneeName: null } });
      await tx.ticketMessage.updateMany({ where: { authorId: user.id }, data: { authorId: null, authorName: ERASED_NAME } });
      counts.sessions = (await tx.session.deleteMany({ where: { userId: user.id } })).count;
      counts.memberships = user.memberships.length;
      await tx.user.delete({ where: { id: user.id } }); // μαζί φεύγουν συμμετοχές, συνεδρίες και σύνδεσμοι κωδικού
      counts.account = 1;
    }
    if (customer) {
      // shortcut: σήμερα τίποτα άλλο δεν δείχνει σε πελάτη. Όταν υπάρξουν παραστατικά χονδρικής, η εγγραφή θα ανωνυμοποιείται αντί να σβήνεται (τα παραστατικά τα κρατά ο νόμος).
      await tx.customer.delete({ where: { id: customer.id } });
      counts.customer = 1;
    }
    await tx.erasureRequest.update({ where: { id }, data: { status: "COMPLETED", decidedById: actor?.id === user?.id ? null : (actor?.id ?? null), decidedAt: new Date(), subjectLabel: null, reason: null, summary: counts } });
    await logEvent({ orgId: req.orgId, type: "ERASURE_COMPLETED", actor: actor?.id === user?.id ? null : actor, subjectType: req.subjectType as SubjectType, subjectId: req.subjectId, detail: { requestId: id, ...counts } }, tx);
    return counts;
  });
  return summary;
}

// ---- Αντίγραφο δεδομένων (δικαίωμα πρόσβασης και φορητότητας) ----

/** Ό,τι κρατά η επιχείρηση για έναν πελάτη της, για να του το παραδώσει. */
export async function exportCustomer(id: string, orgId: string, actor: Actor) {
  const c = await db.customer.findFirst({ where: { id, orgId } });
  if (!c) throw new GdprError("Ο πελάτης δεν βρέθηκε");
  const [consents, files, requests] = await Promise.all([
    consentsOf("customer", id),
    db.storedFile.findMany({ where: { orgId, refType: "customer", refId: id }, select: { name: true, category: true, size: true, createdAt: true } }),
    db.erasureRequest.findMany({ where: { orgId, subjectType: "customer", subjectId: id }, select: { requestedAt: true, status: true, dueAt: true, decidedAt: true } }),
  ]);
  await logEvent({ orgId, type: "EXPORT", actor, subjectType: "customer", subjectId: id, subjectLabel: [c.name, c.email].filter(Boolean).join(" · ") });
  const details = { ...c, id: undefined, orgId: undefined }; // τα εσωτερικά αναγνωριστικά δεν αφορούν τον πελάτη
  return { exportedAt: new Date().toISOString(), customer: details, consents: consents.map((x) => ({ purpose: PURPOSES[x.purpose as Purpose]?.label ?? x.purpose, version: x.version, granted: x.granted, at: x.at, source: x.source })), files, erasureRequests: requests };
}

export async function exportUser(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { memberships: { include: { org: true, role: true, store: true } } } });
  if (!user) throw new GdprError("Ο λογαριασμός δεν βρέθηκε");
  const [consents, sessions, emails, requests, files] = await Promise.all([
    consentsOf("user", userId),
    db.session.findMany({ where: { userId }, select: { expiresAt: true } }),
    db.emailLog.findMany({ where: { to: user.email }, select: { createdAt: true, template: true, subject: true, status: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    db.erasureRequest.findMany({ where: { subjectType: "user", subjectId: userId }, select: { requestedAt: true, status: true, dueAt: true, decidedAt: true } }),
    db.storedFile.findMany({ where: { OR: [{ uploadedById: userId }, { refType: "user", refId: userId }] }, select: { name: true, category: true, size: true, createdAt: true } }),
  ]);
  await logEvent({ orgId: scopeOf(user), type: "EXPORT", actor: { id: user.id, name: user.name }, subjectType: "user", subjectId: user.id, subjectLabel: `${user.name} · ${user.email}` });
  return {
    exportedAt: new Date().toISOString(),
    account: { name: user.name, email: user.email, createdAt: user.createdAt, platformRole: user.platformRole },
    memberships: user.memberships.map((m) => ({ business: m.org.name, role: m.role.name, store: m.store?.name ?? null })),
    consents: consents.map((c) => ({ purpose: PURPOSES[c.purpose as Purpose]?.label ?? c.purpose, version: c.version, granted: c.granted, at: c.at, source: c.source })),
    activeSessions: sessions.length,
    emailsSentToYou: emails,
    erasureRequests: requests,
    files,
  };
}
