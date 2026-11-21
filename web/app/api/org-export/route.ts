// Όλα τα δεδομένα μιας επιχείρησης σε ένα αρχείο JSON. Το κατεβάζει ο Επιχειρηματίας για τη δική του επιχείρηση,
// ή το προσωπικό της πλατφόρμας με δικαίωμα GDPR για όποια επιχείρηση (?org=…). Κάθε λήψη καταγράφεται.
import { logAccess } from "@/lib/access-log";
import { getUser } from "@/lib/auth";
import { exportOrg, receiptsCsv } from "@/lib/org-close";
import { platformCan } from "@/lib/permissions";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return new Response("Χρειάζεται σύνδεση", { status: 401 });
  const asked = new URL(req.url).searchParams.get("org");
  const m = user.memberships[0];
  const orgId = asked && platformCan(user, "gdpr.read") ? asked : m?.role.locked ? m.orgId : null;
  if (!orgId || (asked && asked !== orgId)) return new Response("Δεν επιτρέπεται", { status: 403 });
  // ?format=receipts: μόνο το αρχείο αποδείξεων, σε CSV για τον λογιστή
  if (new URL(req.url).searchParams.get("format") === "receipts") {
    return new Response(await receiptsCsv(orgId), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="apodeixeis.csv"', "Cache-Control": "private, no-store" } });
  }
  const data = await exportOrg(orgId);
  if (!data) return new Response("Δεν βρέθηκε", { status: 404 });
  await logAccess({ orgId, actorName: user.platformRole ? `${user.name} (πλατφόρμα)` : user.name, action: "org.exported", target: data.organization.name });
  const name = (data.organization.slug ?? "epicheirisi").replace(/[^a-z0-9-]/g, "");
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-dedomena.json"`, "Cache-Control": "private, no-store" },
  });
}
