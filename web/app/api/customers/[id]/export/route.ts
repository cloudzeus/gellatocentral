// Αντίγραφο των δεδομένων ενός πελάτη (δικαίωμα πρόσβασης), για να του το παραδώσει η επιχείρηση.
import { getUser } from "@/lib/auth";
import { exportCustomer, GdprError } from "@/lib/gdpr";
import { ALL_PERMISSIONS } from "@/lib/permissions";

export async function GET(_request: Request, { params }: RouteContext<"/api/customers/[id]/export">) {
  const user = await getUser();
  const m = user?.memberships[0];
  if (!user || !m || !(m.role.locked ? ALL_PERMISSIONS : m.role.permissions).includes("customers.manage")) return new Response("Δεν βρέθηκε", { status: 404 });
  try {
    const data = await exportCustomer((await params).id, m.orgId, { id: user.id, name: user.name });
    return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="dedomena-pelati.json"', "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof GdprError) return new Response("Δεν βρέθηκε", { status: 404 });
    throw e;
  }
}
