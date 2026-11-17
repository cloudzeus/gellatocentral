// Συμπλήρωση στοιχείων από ΑΦΜ για τη φόρμα συναλλασσόμενου. Πάντα 200: όταν δεν βρεθεί κάτι, το λέει το `message`.
// Επιτρέπεται σε όποιον διαχειρίζεται συναλλασσόμενους της επιχείρησής του, και στο προσωπικό της πλατφόρμας.
import { getUser } from "@/lib/auth";
import { allowedPermissions } from "@/lib/modules";
import { lookupParty } from "@/lib/party-lookup";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { accessFor } from "@/lib/plan-data";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const m = user.memberships[0];
  const canTenant = m ? allowedPermissions(m.role.locked ? ALL_PERMISSIONS : m.role.permissions, (await accessFor(m.orgId, m.storeId)).open).includes("customers.manage") : false;
  if (!canTenant && !user.platformRole) return Response.json({ error: "forbidden" }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const vat = (q.get("vat") ?? "").slice(0, 30);
  if (vat.replace(/\W/g, "").length < 5) return Response.json({ ok: false, message: "Γράψε πρώτα το ΑΦΜ" });
  return Response.json(await lookupParty({ countryCode: (q.get("country") ?? "GR").slice(0, 2), vat, org: canTenant ? { id: m.orgId, vatNumber: m.org.vatNumber } : null, userName: user.name, force: q.get("force") === "1" }));
}
