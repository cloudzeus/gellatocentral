// Προτάσεις διεύθυνσης για τις φόρμες συναλλασσομένων, όσο γράφει ο χρήστης. Ο browser ρωτά εμάς και εμείς τον χάρτη:
// έτσι η υπηρεσία χάρτη δεν μαθαίνει ποιος χρήστης ρωτά. Ίδια δικαιώματα με τη συμπλήρωση από ΑΦΜ.
import { getUser } from "@/lib/auth";
import { suggestAddresses } from "@/lib/geocode";
import { allowedPermissions } from "@/lib/modules";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { accessFor } from "@/lib/plan-data";
import { partyRefs } from "@/lib/refs";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const m = user.memberships[0];
  const canTenant = m ? allowedPermissions(m.role.locked ? ALL_PERMISSIONS : m.role.permissions, (await accessFor(m.orgId, m.storeId)).open).includes("customers.manage") : false;
  if (!canTenant && !user.platformRole) return Response.json({ error: "forbidden" }, { status: 403 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 4) return Response.json([]);
  return Response.json(await suggestAddresses(q, (await partyRefs()).regions), { headers: { "Cache-Control": "private, max-age=300" } });
}
