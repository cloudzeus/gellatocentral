// Αντίγραφο των προσωπικών δεδομένων του συνδεδεμένου χρήστη (δικαίωμα πρόσβασης και φορητότητας), ως αρχείο JSON.
import { getUser } from "@/lib/auth";
import { exportUser } from "@/lib/gdpr";

export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Χρειάζεται σύνδεση", { status: 401 });
  const data = await exportUser(user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="ta-dedomena-mou.json"', "Cache-Control": "private, no-store" },
  });
}
