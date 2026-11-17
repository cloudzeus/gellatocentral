// Σύνδεση χρηστών και έλεγχος δικαιωμάτων (RBAC). Συνεδρία σε httpOnly cookie· στη βάση μένει μόνο το sha256 της.
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { allowedPermissions } from "./modules";
import { accessFor } from "./plan-data";
import { loadPlatformRoles } from "./platform-roles";
import { ALL_PERMISSIONS, type Permission, permissionFor, platformCan, type PlatformPermission } from "./permissions";

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

/** Ο συνδεδεμένος χρήστης με τη συμμετοχή και τον ρόλο του, ή null. */
export const getUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha(token) },
    include: { user: { include: { memberships: { include: { org: true, role: true } }, staffRole: true } } },
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
export async function requirePlatform(permission: PlatformPermission = "orgs.view") {
  const user = await requireUser();
  if (!user.platformRole) redirect("/");
  if (!platformCan(user, permission)) redirect(`/platform?error=${encodeURIComponent("Ο ρόλος σου δεν επιτρέπει αυτή την ενέργεια")}`);
  return { ...user, platformRole: user.platformRole, can: (p: PlatformPermission) => platformCan(user, p) };
}

/** Η πρώτη σελίδα που επιτρέπεται με αυτά τα δικαιώματα (για ανακατεύθυνση όταν λείπει κάποιο). */
const home = (permissions: string[]) => (["/", "/pos", "/receipts", "/devices", "/users", "/billing"] as const).find((p) => permissions.includes(permissionFor(p)));

/**
 * Η επιχείρηση του χρήστη, ο ρόλος και τα δικαιώματά του. Με `needs` ελέγχει και ότι έχει το δικαίωμα
 * για τη σελίδα/ενέργεια. Καλείται σε ΚΑΘΕ σελίδα και server action, όχι μόνο για το μενού.
 */
export const currentOrg = cache(async (needs?: Permission) => {
  const user = await requireUser();
  const m = user.memberships[0];
  if (!m) redirect(user.platformRole ? "/platform" : "/login");
  // ο κλειδωμένος ρόλος έχει πάντα όλα τα δικαιώματα, και όσα προστεθούν αργότερα
  // …μείον όσα ανήκουν σε ενότητες που δεν έχει το πακέτο της επιχείρησης ή που κλείνουν στην εποχιακή παύση
  const access = await accessFor(m.orgId, m.storeId);
  const permissions: string[] = allowedPermissions(m.role.locked ? ALL_PERMISSIONS : m.role.permissions, access.open);
  if (needs && !permissions.includes(needs)) redirect(home(permissions) ?? "/account");
  return { user, membership: m, role: m.role, permissions, org: m.org, storeId: m.storeId, access };
});
