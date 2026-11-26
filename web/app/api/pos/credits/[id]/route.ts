import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { cancelCredit, syncCredit } from "@/lib/pos-refund";

/** Πού βρίσκεται η επιστροφή: { state: completed | pending | failed }. Ασφαλές να κληθεί ξανά και ξανά. */
export async function GET(req: Request, { params }: RouteContext<"/api/pos/credits/[id]">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const state = await syncCredit(ctx.org.id, (await params).id, ctx.device.id);
    return state ? Response.json({ state }) : Response.json({ error: "not_found" }, { status: 404 });
  } catch { return Response.json({ error: "viva_unavailable" }, { status: 502 }); }
}

/** «Ακύρωση» όσο η επιστροφή περιμένει στο POS. Αν η Viva λέει ότι πέρασε, απαντά completed. */
export async function POST(req: Request, { params }: RouteContext<"/api/pos/credits/[id]">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!z.object({ cancel: z.literal(true) }).safeParse(await req.json().catch(() => null)).success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const state = await cancelCredit(ctx.org.id, (await params).id, ctx.device.id);
    return state ? Response.json({ state }) : Response.json({ error: "not_found" }, { status: 404 });
  } catch { return Response.json({ error: "viva_unavailable" }, { status: 502 }); }
}
