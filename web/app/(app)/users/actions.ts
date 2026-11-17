"use server";
// Χρήστες και ρόλοι του συνδρομητή. Κάθε action θέλει το δικαίωμα «users.manage» και δουλεύει ΜΟΝΟ στη δική του επιχείρηση.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { platformSettings, sendMail } from "@/lib/mail/send";
import { templates } from "@/lib/mail/templates";
import { permissionDiff } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { ALL_PERMISSIONS, canGrant, isPermission, PERMISSIONS } from "@/lib/permissions";
import { createResetLink } from "@/lib/reset";

const id = z.string().min(1).max(60);
const name = z.string().trim().min(2, "Το όνομα θέλει τουλάχιστον 2 χαρακτήρες").max(60);
const fail = (message: string): never => redirect(`/users?error=${encodeURIComponent(message)}`);
const done = (what: string): never => {
  revalidatePath("/users");
  redirect(`/users?saved=${what}`);
};
function read<T extends z.ZodType>(schema: T, form: FormData): z.infer<T> {
  const r = schema.safeParse(Object.fromEntries(form));
  return r.success ? r.data : fail(r.error.issues[0].message);
}

const effective = (role: { locked: boolean; permissions: string[] }) => (role.locked ? ALL_PERMISSIONS : role.permissions);
/** Ο ρόλος πρέπει να είναι της επιχείρησης ΚΑΙ να μη δίνει δικαιώματα που δεν έχει όποιος τον αναθέτει. */
async function grantableRole(orgId: string, roleId: string, actor: string[]) {
  const role = await db.orgRole.findFirst({ where: { id: roleId, orgId } });
  if (!role) return fail("Άγνωστος ρόλος");
  if (!canGrant(actor, effective(role))) return fail(`Δεν μπορείς να δώσεις τον ρόλο «${role.name}»: έχει δικαιώματα που δεν έχεις εσύ`);
  return role;
}
/** Πρέπει πάντα να μένει κάποιος που διαχειρίζεται χρήστες, αλλιώς η επιχείρηση κλειδώνεται έξω. */
async function keepAnAdmin(tx: Prisma.TransactionClient, orgId: string) {
  const admins = await tx.membership.count({ where: { orgId, user: { disabledAt: null }, role: { OR: [{ locked: true }, { permissions: { has: "users.manage" } }] } } });
  if (admins === 0) throw new Error("LOCKOUT");
}
/** Ο χρήστης που αλλάζεις πρέπει να είναι της επιχείρησης ΚΑΙ να μην έχει δικαιώματα που δεν έχεις εσύ. */
async function manageable(orgId: string, membershipId: string, actor: string[]) {
  const m = await db.membership.findFirst({ where: { id: id.parse(membershipId), orgId }, include: { user: true, role: true } });
  if (!m) return fail("Άγνωστος χρήστης");
  if (!canGrant(actor, effective(m.role))) return fail(`Δεν μπορείς να αλλάξεις τον χρήστη «${m.user.name}»: ο ρόλος του έχει δικαιώματα που δεν έχεις εσύ`);
  return m;
}
const permLabel = (key: string) => PERMISSIONS.find((p) => p.key === key)?.label ?? key;
const guarded = (work: (tx: Prisma.TransactionClient) => Promise<void>) =>
  db.$transaction(work).catch((e) => (e instanceof Error && e.message === "LOCKOUT" ? fail("Πρέπει να μείνει τουλάχιστον ένας χρήστης που διαχειρίζεται χρήστες και ρόλους") : Promise.reject(e)));

export async function inviteUser(form: FormData) {
  const { org, permissions, user: actor } = await currentOrg("users.manage");
  const d = read(z.object({ name, email: z.string().trim().toLowerCase().email("Το email δεν είναι έγκυρο"), roleId: id, storeId: z.string().max(60) }), form);
  const role = await grantableRole(org.id, d.roleId, permissions);
  const storeId = d.storeId && (await db.store.findFirst({ where: { id: d.storeId, orgId: org.id } })) ? d.storeId : null;
  // shortcut: ένας χρήστης ανήκει σε μία επιχείρηση· email που υπάρχει ήδη (εδώ ή αλλού) δεν προσκαλείται ξανά
  if (await db.user.findUnique({ where: { email: d.email } })) return fail("Υπάρχει ήδη χρήστης με αυτό το email");
  const user = await db.user.create({ data: { name: d.name, email: d.email, memberships: { create: { orgId: org.id, roleId: role.id, storeId } } } });
  const url = await createResetLink(user.id, 72, org);
  await sendMail({ to: user.email, template: "invitation", org, mail: templates.invitation(await platformSettings(), { name: user.name, orgName: org.name, role: role.name, url }) });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "user.invited", target: `${user.name} · ${user.email}`, detail: `Ρόλος: ${role.name}` });
  done("invited");
}

export async function updateMember(form: FormData) {
  const { org, permissions, user: actor } = await currentOrg("users.manage");
  const d = read(z.object({ membershipId: id, roleId: id, storeId: z.string().max(60) }), form);
  const target = await manageable(org.id, d.membershipId, permissions);
  const role = await grantableRole(org.id, d.roleId, permissions);
  const storeId = d.storeId && (await db.store.findFirst({ where: { id: d.storeId, orgId: org.id } })) ? d.storeId : null;
  await guarded(async (tx) => {
    await tx.membership.updateMany({ where: { id: d.membershipId, orgId: org.id }, data: { roleId: role.id, storeId } });
    await keepAnAdmin(tx, org.id);
  });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "user.role", target: target.user.name, detail: target.roleId === role.id ? "Άλλαξε το κατάστημα" : `${target.role.name} → ${role.name}` });
  done("member");
}

export async function removeMember(membershipId: string) {
  const { org, permissions, user: actor } = await currentOrg("users.manage");
  const m = await manageable(org.id, membershipId, permissions);
  await guarded(async (tx) => {
    await tx.membership.delete({ where: { id: m.id } });
    await tx.session.deleteMany({ where: { userId: m.userId } }); // αποσυνδέεται αμέσως από παντού
    await keepAnAdmin(tx, org.id);
  });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "user.removed", target: `${m.user.name} · ${m.user.email}`, detail: `Ρόλος: ${m.role.name}` });
  done("removed");
}

/** Απενεργοποίηση: ο χρήστης δεν συνδέεται, αλλά μένει στη λίστα με τον ρόλο του και ενεργοποιείται ξανά με ένα κλικ. */
export async function setMemberActive(membershipId: string, active: boolean) {
  const { org, permissions, user: actor, membership: me } = await currentOrg("users.manage");
  const m = await manageable(org.id, membershipId, permissions);
  if (m.id === me.id) return fail("Δεν μπορείς να απενεργοποιήσεις τον εαυτό σου");
  await guarded(async (tx) => {
    await tx.user.update({ where: { id: m.userId }, data: { disabledAt: active ? null : new Date() } });
    if (!active) await tx.session.deleteMany({ where: { userId: m.userId } }); // αποσυνδέεται αμέσως από παντού
    await keepAnAdmin(tx, org.id);
  });
  await logAccess({ orgId: org.id, actorName: actor.name, action: active ? "user.enabled" : "user.disabled", target: m.user.name });
  done(active ? "enabled" : "disabled");
}

export async function sendResetLink(membershipId: string) {
  const { org, user: actor } = await currentOrg("users.manage");
  const m = await db.membership.findFirst({ where: { id: id.parse(membershipId), orgId: org.id }, include: { user: true } });
  if (!m) return;
  if (m.user.disabledAt) return fail("Ο χρήστης είναι απενεργοποιημένος. Ενεργοποίησέ τον πρώτα");
  const url = await createResetLink(m.userId, 72, org);
  await sendMail({ to: m.user.email, template: "passwordReset", org, mail: templates.passwordReset(await platformSettings(), { name: m.user.name, url }) });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "user.reset", target: m.user.name });
  done("reset");
}

export async function saveRole(form: FormData) {
  const { org, permissions: mine, user: actor } = await currentOrg("users.manage");
  const d = read(z.object({ roleId: z.string().max(60), name }), form);
  const wanted = form.getAll("permissions").map(String).filter(isPermission);
  if (!canGrant(mine, wanted)) return fail("Δεν μπορείς να δώσεις σε ρόλο δικαιώματα που δεν έχεις εσύ");
  const clash = await db.orgRole.findFirst({ where: { orgId: org.id, name: d.name, NOT: { id: d.roleId || undefined } } });
  if (clash) return fail(`Υπάρχει ήδη ρόλος «${d.name}»`);
  if (!d.roleId) {
    await db.orgRole.create({ data: { orgId: org.id, name: d.name, permissions: wanted } });
    await logAccess({ orgId: org.id, actorName: actor.name, action: "role.created", target: d.name, detail: permissionDiff([], wanted, permLabel) });
    return done("role");
  }
  const role = await db.orgRole.findFirst({ where: { id: d.roleId, orgId: org.id } });
  if (!role) return fail("Άγνωστος ρόλος");
  if (role.locked) return fail(`Ο ρόλος «${role.name}» έχει πάντα όλα τα δικαιώματα και δεν αλλάζει`);
  // δεν αγγίζεις ρόλο που έχει ήδη περισσότερα δικαιώματα από εσένα
  if (!canGrant(mine, role.permissions)) return fail(`Ο ρόλος «${role.name}» έχει δικαιώματα που δεν έχεις εσύ`);
  await guarded(async (tx) => {
    await tx.orgRole.update({ where: { id: role.id }, data: { name: d.name, permissions: wanted } });
    await keepAnAdmin(tx, org.id);
  });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "role.changed", target: d.name, detail: `${role.name === d.name ? "" : `Νέο όνομα (πριν: ${role.name}) · `}${permissionDiff(role.permissions, wanted, permLabel)}` });
  done("role");
}

export async function deleteRole(roleId: string) {
  const { org, user: actor } = await currentOrg("users.manage");
  const role = await db.orgRole.findFirst({ where: { id: id.parse(roleId), orgId: org.id }, include: { _count: { select: { members: true } } } });
  if (!role) return;
  if (role.locked || role.system) return fail("Οι ρόλοι του συστήματος δεν διαγράφονται");
  if (role._count.members) return fail(`Ο ρόλος «${role.name}» έχει ${role._count.members} χρήστες. Άλλαξέ τους ρόλο πρώτα.`);
  await db.orgRole.delete({ where: { id: role.id } });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "role.deleted", target: role.name });
  done("role");
}
