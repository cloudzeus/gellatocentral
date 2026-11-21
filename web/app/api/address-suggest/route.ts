// Προτάσεις διεύθυνσης για τις φόρμες συναλλασσομένων, όσο γράφει ο χρήστης. Ο browser ρωτά εμάς και εμείς τον χάρτη:
// έτσι η υπηρεσία χάρτη δεν μαθαίνει ποιος χρήστης ρωτά. Κάθε πρόταση εμπλουτίζεται με τον Δήμο Καλλικράτη και
// την πόλη της κοινής λίστας (lib/geo), ώστε να γεμίζουν και τα dropdown της φόρμας. Ίδια δικαιώματα με το ΑΦΜ lookup.
import { getUser, memberPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { suggestAddresses } from "@/lib/geocode";
import { enrichSuggestions } from "@/lib/geo";
import { accessFor } from "@/lib/plan-data";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const m = user.memberships[0];
  const canTenant = m ? memberPermissions(m, (await accessFor(m.orgId, m.stores.map((s) => s.storeId))).open).includes("parties.read") : false;
  if (!canTenant && !user.platformRole) return Response.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 4) return Response.json([]);
  // Αν η φόρμα έχει ήδη επιλεγμένη πόλη, οι προτάσεις οδών προτιμούν εκείνη (βλ. suggestAddresses)
  const cityId = (sp.get("cityId") ?? "").trim();
  let near: { latitude: number; longitude: number } | null = null;
  let cityName = (sp.get("city") ?? "").trim().slice(0, 80) || null;
  if (cityId) {
    const c = await db.geoCity.findUnique({ where: { id: cityId }, select: { name: true, latitude: true, longitude: true } });
    if (c) {
      cityName = c.name;
      if (c.latitude != null && c.longitude != null) near = { latitude: c.latitude, longitude: c.longitude };
    }
  }
  return Response.json(await enrichSuggestions(await suggestAddresses(q, [], near, cityName)), { headers: { "Cache-Control": "private, max-age=300" } });
}
