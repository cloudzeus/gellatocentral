// Δέντρο Καλλικράτη για τις φόρμες: παιδιά κόμβου (?parent=), αναζήτηση (?q=&level=4|5),
// ή κόμβος με την αλυσίδα γονέων του (?code=). Κοινά δεδομένα αναφοράς — αρκεί σύνδεση.
import { getUser } from "@/lib/auth";
import { geoBreadcrumb, geoRegionChildren, searchGeoRegions } from "@/lib/geo";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const code = p.get("code")?.trim();
  if (code) return Response.json({ breadcrumb: await geoBreadcrumb(code) }, { headers: { "Cache-Control": "private, max-age=3600" } });
  const q = p.get("q")?.trim();
  if (q) {
    const level = p.get("level") === "4" ? 4 : p.get("level") === "5" ? 5 : undefined;
    return Response.json(await searchGeoRegions(q, level), { headers: { "Cache-Control": "private, max-age=3600" } });
  }
  return Response.json(await geoRegionChildren(p.get("parent")?.trim() || null), { headers: { "Cache-Control": "private, max-age=3600" } });
}
