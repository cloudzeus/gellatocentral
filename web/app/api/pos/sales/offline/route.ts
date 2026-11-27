// Συγχρονισμός πώλησης που έγινε στο ταμείο Android χωρίς σύνδεση (lib/pos-offline.ts). Χωρίς έλεγχο παύσης ή βάρδιας:
// η πώληση έχει ήδη γίνει και πληρωθεί, εδώ απλώς καταγράφεται. Ίδια κλήση ξανά → ίδιο αποτέλεσμα.
import { tillFromRequest } from "@/lib/device-auth";
import { offlineSale, recordOfflineSale } from "@/lib/pos-offline";

export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = offlineSale.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  let r;
  try { r = await recordOfflineSale(ctx, parsed.data); } catch { return Response.json({ error: "viva_unavailable" }, { status: 502 }); }
  if (r.state === "done") return Response.json({ ok: true, series: r.series, aa: r.aa });
  if (r.state === "pending") return Response.json({ pending: true }, { status: 202 });
  return Response.json({ error: "rejected", reason: r.reason }, { status: 409 });
}
