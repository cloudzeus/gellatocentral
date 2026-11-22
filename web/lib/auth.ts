// Σύνδεση χρηστών και έλεγχος δικαιωμάτων (RBAC). Συνεδρία σε httpOnly cookie· στη βάση μένει μόνο το sha256 της.
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { allowedPermissions } from "./modules";
import { accessFor } from "./plan-data";
import { loadPlatformRoles } from "./platform-roles";
import { expandOrg, orgPermissionsOf, type Permission, permissionFor, platformCan, type PlatformPermission } from "./permissions";

const COOKIE = "gs_session";
const DAYS = 14;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DAYS * 864e5);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db.$transaction([db.session.create({ data: { tokenHash: sha(token), userId, expiresAt, userAgent } }), db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })]);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}
export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha(token) } });
  jar.delete(COOKIE);
}

/** Ο συνδεδεμένος χρήστης με τη συμμετοχή, τον ρόλο, τις ομάδες και τα καταστήματά του, ή null. */
export const getUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha(token) },
    include: { user: { include: { memberships: { include: { org: true, role: true, stores: true, warehouses: true, groups: { include: { group: true } } } }, staffRole: true, staffGroups: { include: { group: true } } } } },
  });
  // απενεργοποιημένος χρήστης δεν μπαίνει, ακόμα κι αν έμεινε κάποια συνεδρία
  if (!session || session.expiresAt <= new Date() || session.user.disabledAt) return null;
  if (session.user.platformRole) await loadPlatformRoles();
  return session.user;
});
/** Το sha256 της τρέχουσας συνεδρίας, για να ξεχωρίζει «αυτή η συσκευή» από τις άλλες. */
export async function currentTokenHash() {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? sha(token) : null;
}

export async function requireUser() {
  return (await getUser()) ?? redirect("/login");
}

/** Προσωπικό πλατφόρμας με το συγκεκριμένο δικαίωμα. Χωρίς αυτό: πίσω στη λίστα συνδρομητών (ή έξω). */
export async function requirePlatform(permission: PlatformPermission = "orgs.read") {
  const user = await requireUser();
  if (!user.platformRole) redirect("/");
  if (!platformCan(user, permission)) redirect(`/platform?error=${encodeURIComponent("Ο ρόλος σου δεν επιτρέπει αυτή την ενέργεια")}`);
  return { ...user, platformRole: user.platformRole, can: (p: PlatformPermission) => platformCan(user, p) };
}

/** Η πρώτη σελίδα που επιτρέπεται με αυτά τα δικαιώματα (για ανακατεύθυνση όταν λείπει κάποιο). */
const home = (permissions: string[]) => (["/", "/pos", "/receipts", "/devices", "/users", "/billing"] as const).find((p) => permissions.includes(permissionFor(p)));

/**
 * Τα δικαιώματα ενός μέλους όπως ισχύουν: ρόλος ∪ ομάδες (ο κλειδωμένος ρόλος έχει πάντα όλα),
 * μείον όσα ανήκουν σε ενότητες που δεν έχει το πακέτο ή που κλείνουν στην εποχιακή παύση.
 */
export const memberPermissions = (m: { role: { locked: boolean; permissions: string[] }; groups: { group: { permissions: string[] } }[] }, open: readonly string[]): Permission[] =>
  allowedPermissions(m.role.locked ? orgPermissionsOf(m.role) : expandOrg([...m.role.permissions, ...m.groups.flatMap((g) => g.group.permissions)]), open) as Permission[];

/**
 * Η επιχείρηση του χρήστη, ο ρόλος και τα δικαιώματά του. Με `needs` ελέγχει και ότι έχει το δικαίωμα
 * για τη σελίδα/ενέργεια. Καλείται σε ΚΑΘΕ σελίδα και server action, όχι μόνο για το μενού.
 * storeIds/warehouseIds: ρητοί περιορισμοί του μέλους· κενός πίνακας = όλα εντός του αντίστοιχου scope.
 */
export const currentOrg = cache(async (needs?: Permission) => {
  const user = await requireUser();
  const m = user.memberships[0];
  if (!m) redirect(user.platformRole ? "/platform" : "/login");
  const storeIds = m.stores.map((s) => s.storeId);
  const warehouseIds = m.warehouses.map((w) => w.warehouseId);
  const access = await accessFor(m.orgId, storeIds);
  const permissions = memberPermissions(m, access.open);
  if (needs && !permissions.includes(needs)) redirect(home(permissions) ?? "/account");
  return { user, membership: m, role: m.role, permissions, can: (p: Permission) => permissions.includes(p), org: m.org, storeIds, warehouseIds, access };
});
