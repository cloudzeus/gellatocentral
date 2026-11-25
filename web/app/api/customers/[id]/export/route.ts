// Αντίγραφο των δεδομένων ενός πελάτη (δικαίωμα πρόσβασης), για να του το παραδώσει η επιχείρηση.
import { getUser, memberPermissions } from "@/lib/auth";
import { exportCustomer, GdprError } from "@/lib/gdpr";
import { accessFor } from "@/lib/plan-data";

export async function GET(_request: Request, { params }: RouteContext<"/api/customers/[id]/export">) {
  const user = await getUser();
  const m = user?.memberships[0];
  if (!user || !m) return new Response("Δεν βρέθηκε", { status: 404 });
  const access = await accessFor(m.orgId, m.stores.map((s) => s.storeId));
  if (!memberPermissions(m, access.open).includes("parties.read")) return new Response("Δεν βρέθηκε", { status: 404 });
  try {
    const data = await exportCustomer((await params).id, m.orgId, { id: user.id, name: user.name });
    return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="dedomena-pelati.json"', "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof GdprError) return new Response("Δεν βρέθηκε", { status: 404 });
    throw e;
  }
}
