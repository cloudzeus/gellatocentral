"use server";
// Χρήστες, ομάδες και ρόλοι του συνδρομητή. Κάθε action θέλει το ανάλογο δικαίωμα users.* (read/add/edit/delete)
// και δουλεύει ΜΟΝΟ στη δική του επιχείρηση. Τα δικαιώματα ενός μέλους είναι η ένωση ρόλου + ομάδων.

import { flashFail } from "@/lib/flash-server";
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
import { canGrant, isPermission, normalize, orgPermissionsOf, permissionLabel } from "@/lib/permissions";
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

/** Ο ρόλος πρέπει να είναι της επιχείρησης ΚΑΙ να μη δίνει δικαιώματα που δεν έχει όποιος τον αναθέτει. */
async function grantableRole(orgId: string, roleId: string, actor: string[]) {
  const role = await db.orgRole.findFirst({ where: { id: roleId, orgId } });
  if (!role) return fail("Άγνωστος ρόλος");
  if (!canGrant(actor, orgPermissionsOf(role))) return fail(`Δεν μπορείς να δώσεις τον ρόλο «${role.name}»: έχει δικαιώματα που δεν έχεις εσύ`);
  return role;
}
/** Οι ομάδες που ζήτησε η φόρμα, μόνο όσες είναι της επιχείρησης ΚΑΙ δεν έχουν δικαιώματα πάνω από του αναθέτοντα. */
async function grantableGroups(orgId: string, groupIds: string[], actor: string[]) {
  const groups = await db.orgGroup.findMany({ where: { id: { in: groupIds }, orgId } });
  for (const g of groups) if (!canGrant(actor, orgPermissionsOf({ locked: false, permissions: g.permissions }))) return fail(`Δεν μπορείς να δώσεις την ομάδα «${g.name}»: έχει δικαιώματα που δεν έχεις εσύ`);
  return groups;
}
/** Τα καταστήματα που ζήτησε η φόρμα, μόνο όσα είναι της επιχείρησης. Κανένα = όλα. */
const grantableStores = async (orgId: string, storeIds: string[]) => db.store.findMany({ where: { id: { in: storeIds }, orgId }, select: { id: true } });
/** Πρέπει πάντα να μένει κάποιος που διαχειρίζεται χρήστες, αλλιώς η επιχείρηση κλειδώνεται έξω. */
async function keepAnAdmin(tx: Prisma.TransactionClient, orgId: string) {
  // hasSome με το παλιό κλειδί: για δεδομένα που δεν έχει προλάβει να ξαναγράψει το scripts/migrate-permissions.ts
  const admins = await tx.membership.count({ where: { orgId, user: { disabledAt: null }, role: { OR: [{ locked: true }, { permissions: { hasSome: ["users.edit", "users.manage"] } }] } } });
  if (admins === 0) throw new Error("LOCKOUT");
}
/** Ο χρήστης που αλλάζεις πρέπει να είναι της επιχείρησης ΚΑΙ να μην έχει δικαιώματα που δεν έχεις εσύ. */
async function manageable(orgId: string, membershipId: string, actor: string[]) {
  const m = await db.membership.findFirst({ where: { id: id.parse(membershipId), orgId }, include: { user: true, role: true, groups: { include: { group: true } } } });
  if (!m) return fail("Άγνωστος χρήστης");
  const theirs = [...orgPermissionsOf(m.role), ...m.groups.flatMap((g) => g.group.permissions)];
  if (!canGrant(actor, theirs)) return fail(`Δεν μπορείς να αλλάξεις τον χρήστη «${m.user.name}»: έχει δικαιώματα που δεν έχεις εσύ`);
  return m;
}
const guarded = (work: (tx: Prisma.TransactionClient) => Promise<void>) =>
  db.$transaction(work).catch((e) => (e instanceof Error && e.message === "LOCKOUT" ? fail("Πρέπει να μείνει τουλάχιστον ένας χρήστης που διαχειρίζεται χρήστες και ρόλους") : Promise.reject(e)));

export async function inviteUser(form: FormData) {
  const { org, permissions, user: actor } = await currentOrg("users.add");
  const d = read(z.object({ name, email: z.string().trim().toLowerCase().email("Το email δεν είναι έγκυρο"), roleId: id }), form);
  const role = await grantableRole(org.id, d.roleId, permissions);
  const groups = await grantableGroups(org.id, form.getAll("groupIds").map(String), permissions);
  const stores = await grantableStores(org.id, form.getAll("storeIds").map(String));
  // shortcut: ένας χρήστης ανήκει σε μία επιχείρηση· email που υπάρχει ήδη (εδώ ή αλλού) δεν προσκαλείται ξανά
  if (await db.user.findUnique({ where: { email: d.email } })) return fail("Υπάρχει ήδη χρήστης με αυτό το email");
  const user = await db.user.create({
    data: {
      name: d.name, email: d.email,
      memberships: { create: { orgId: org.id, roleId: role.id, stores: { create: stores.map((s) => ({ storeId: s.id })) }, groups: { create: groups.map((g) => ({ groupId: g.id })) } } },
    },
  });
  const url = await createResetLink(user.id, 72, org);
  await sendMail({ to: user.email, template: "invitation", org, mail: templates.invitation(await platformSettings(), { name: user.name, orgName: org.name, role: role.name, url }) });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "user.invited", target: `${user.name} · ${user.email}`, detail: `Ρόλος: ${role.name}${groups.length ? ` · Ομάδες: ${groups.map((g) => g.name).join(", ")}` : ""}${stores.length ? ` · Καταστήματα: ${stores.length}` : ""}` });
  done("invited");
}

export async function updateMember(form: FormData) {
  const { org, permissions, user: actor } = await currentOrg("users.edit");
  const d = read(z.object({ membershipId: id, roleId: id }), form);
  const target = await manageable(org.id, d.membershipId, permissions);
  const role = await grantableRole(org.id, d.roleId, permissions);
  const groups = await grantableGroups(org.id, form.getAll("groupIds").map(String), permissions);
  const stores = await grantableStores(org.id, form.getAll("storeIds").map(String));
  await guarded(async (tx) => {
    await tx.membership.updateMany({ where: { id: d.membershipId, orgId: org.id }, data: { roleId: role.id } });
    await tx.membershipStore.deleteMany({ where: { membershipId: d.membershipId } });
    await tx.membershipStore.createMany({ data: stores.map((s) => ({ membershipId: d.membershipId, storeId: s.id })) });
    await tx.membershipGroup.deleteMany({ where: { membershipId: d.membershipId } });
    await tx.membershipGroup.createMany({ data: groups.map((g) => ({ membershipId: d.membershipId, groupId: g.id })) });
    await keepAnAdmin(tx, org.id);
  });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "user.role", target: target.user.name, detail: `${target.roleId === role.id ? "Ίδιος ρόλος" : `${target.role.name} → ${role.name}`} · Καταστήματα: ${stores.length || "όλα"} · Ομάδες: ${groups.map((g) => g.name).join(", ") || "καμία"}` });
  done("member");
}

export async function removeMember(membershipId: string) {
  const { org, permissions, user: actor } = await currentOrg("users.delete");
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
  const { org, permissions, user: actor, membership: me } = await currentOrg("users.edit");
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
  const { org, user: actor } = await currentOrg("users.edit");
  const m = await db.membership.findFirst({ where: { id: id.parse(membershipId), orgId: org.id }, include: { user: true } });
  if (!m) { await flashFail("Δεν έγινε: ο χρήστης δεν βρέθηκε", "Ανανέωσε τη σελίδα και δοκίμασε ξανά."); return; }
  if (m.user.disabledAt) return fail("Ο χρήστης είναι απενεργοποιημένος. Ενεργοποίησέ τον πρώτα");
  const url = await createResetLink(m.userId, 72, org);
  await sendMail({ to: m.user.email, template: "passwordReset", org, mail: templates.passwordReset(await platformSettings(), { name: m.user.name, url }) });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "user.reset", target: m.user.name });
  done("reset");
}

/** Κοινός κορμός για ρόλο ή ομάδα: όνομα + δικαιώματα, χωρίς να δίνεις κάτι που δεν έχεις. Το read προστίθεται αυτόματα. */
async function savePermSet(form: FormData, table: "role" | "group") {
  const { org, permissions: mine, user: actor } = await currentOrg("users.edit");
  const d = read(z.object({ rowId: z.string().max(60), name }), form);
  const wanted = normalize(form.getAll("permissions").map(String).filter(isPermission));
  if (!canGrant(mine, wanted)) return fail(`Δεν μπορείς να δώσεις σε ${table === "role" ? "ρόλο" : "ομάδα"} δικαιώματα που δεν έχεις εσύ`);
  const where = { orgId: org.id, name: d.name, NOT: { id: d.rowId || undefined } };
  const clash = table === "role" ? await db.orgRole.findFirst({ where }) : await db.orgGroup.findFirst({ where });
  if (clash) return fail(`Υπάρχει ήδη ${table === "role" ? "ρόλος" : "ομάδα"} «${d.name}»`);
  return { org, actor, d, wanted, mine };
}

export async function saveRole(form: FormData) {
  const ctx = await savePermSet(form, "role");
  if (!ctx) return;
  const { org, actor, d, wanted, mine } = ctx;
  if (!d.rowId) {
    await db.orgRole.create({ data: { orgId: org.id, name: d.name, permissions: wanted } });
    await logAccess({ orgId: org.id, actorName: actor.name, action: "role.created", target: d.name, detail: permissionDiff([], wanted, permissionLabel) });
    return done("role");
  }
  const role = await db.orgRole.findFirst({ where: { id: d.rowId, orgId: org.id } });
  if (!role) return fail("Άγνωστος ρόλος");
  if (role.locked) return fail(`Ο ρόλος «${role.name}» έχει πάντα όλα τα δικαιώματα και δεν αλλάζει`);
  // δεν αγγίζεις ρόλο που έχει ήδη περισσότερα δικαιώματα από εσένα
  if (!canGrant(mine, orgPermissionsOf(role))) return fail(`Ο ρόλος «${role.name}» έχει δικαιώματα που δεν έχεις εσύ`);
  await guarded(async (tx) => {
    await tx.orgRole.update({ where: { id: role.id }, data: { name: d.name, permissions: wanted } });
    await keepAnAdmin(tx, org.id);
  });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "role.changed", target: d.name, detail: `${role.name === d.name ? "" : `Νέο όνομα (πριν: ${role.name}) · `}${permissionDiff(role.permissions, wanted, permissionLabel)}` });
  done("role");
}

export async function deleteRole(roleId: string) {
  const { org, user: actor } = await currentOrg("users.delete");
  const role = await db.orgRole.findFirst({ where: { id: id.parse(roleId), orgId: org.id }, include: { _count: { select: { members: true } } } });
  if (!role) { await flashFail("Δεν έγινε: ο ρόλος δεν βρέθηκε", "Ανανέωσε τη σελίδα και δοκίμασε ξανά."); return; }
  if (role.locked || role.system) return fail("Οι ρόλοι του συστήματος δεν διαγράφονται");
  if (role._count.members) return fail(`Ο ρόλος «${role.name}» έχει ${role._count.members} χρήστες. Άλλαξέ τους ρόλο πρώτα.`);
  await db.orgRole.delete({ where: { id: role.id } });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "role.deleted", target: role.name });
  done("role");
}

export async function saveGroup(form: FormData) {
  const ctx = await savePermSet(form, "group");
  if (!ctx) return;
  const { org, actor, d, wanted } = ctx;
  if (!d.rowId) {
    await db.orgGroup.create({ data: { orgId: org.id, name: d.name, permissions: wanted } });
    await logAccess({ orgId: org.id, actorName: actor.name, action: "group.created", target: d.name, detail: permissionDiff([], wanted, permissionLabel) });
    return done("group");
  }
  const group = await db.orgGroup.findFirst({ where: { id: d.rowId, orgId: org.id } });
  if (!group) return fail("Άγνωστη ομάδα");
  if (!canGrant(ctx.mine, orgPermissionsOf({ locked: false, permissions: group.permissions }))) return fail(`Η ομάδα «${group.name}» έχει δικαιώματα που δεν έχεις εσύ`);
  await db.orgGroup.update({ where: { id: group.id }, data: { name: d.name, permissions: wanted } });
  await logAccess({ orgId: org.id, actorName: actor.name, action: "group.changed", target: d.name, detail: permissionDiff(group.permissions, wanted, permissionLabel) });
  done("group");
}

export async function deleteGroup(groupId: string) {
  const { org, user: actor } = await currentOrg("users.delete");
  const group = await db.orgGroup.findFirst({ where: { id: id.parse(groupId), orgId: org.id } });
  if (!group) { await flashFail("Δεν έγινε: η ομάδα δεν βρέθηκε", "Ανανέωσε τη σελίδα και δοκίμασε ξανά."); return; }
  await db.orgGroup.delete({ where: { id: group.id } }); // οι συνδέσεις μελών φεύγουν μαζί (Cascade)
  await logAccess({ orgId: org.id, actorName: actor.name, action: "group.deleted", target: group.name });
  done("group");
}
