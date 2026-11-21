// Πόλεις/οικισμοί για τη φόρμα διεύθυνσης: μέσα στον επιλεγμένο δήμο (?municipality=) ή
// συνολική αναζήτηση (?q=). Κοινά δεδομένα αναφοράς — αρκεί σύνδεση.
import { getUser } from "@/lib/auth";
import { geoCities } from "@/lib/geo";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const rows = await geoCities({ municipalityCode: p.get("municipality")?.trim() || null, q: p.get("q") ?? undefined });
  return Response.json(rows, { headers: { "Cache-Control": "private, max-age=3600" } });
}
