// Περιοχές μιας πόλης για τη φόρμα διεύθυνσης (?city=<GeoCity id>&q=). Κοινά δεδομένα — αρκεί σύνδεση.
import { getUser } from "@/lib/auth";
import { geoAreas } from "@/lib/geo";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const cityId = p.get("city")?.trim();
  if (!cityId) return Response.json([]);
  return Response.json(await geoAreas(cityId, p.get("q") ?? undefined), { headers: { "Cache-Control": "private, max-age=600" } });
}
