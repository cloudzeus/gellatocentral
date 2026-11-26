import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { failShare, startShare } from "@/lib/pos";
import { pausedResponse, sendToTerminal, startPayload, tillErrorResponse } from "@/lib/pos-till";
import { shiftResponse } from "@/lib/till-shift";

const body = z.object({ methodId: z.string().min(1).max(40), amountCents: z.number().int().min(1).max(10_000_000) });

// Μοίρασμα κατά ποσό: ένα μέρος του λογαριασμού πριν από την απόδειξη. Κάρτα → payload για το Viva Terminal (όπως η
// πώληση· το αποτέλεσμα πάει στο /api/pos/sales/[shareId]/result). Μετρητά → καταγράφεται αμέσως ({ paid: true }).
export async function POST(req: Request, { params }: RouteContext<"/api/pos/bills/[id]/shares">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paused = await pausedResponse(ctx);
  if (paused) return paused;
  const noShift = await shiftResponse(ctx);
  if (noShift) return noShift;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const r = await startShare(ctx, (await params).id, parsed.data.methodId, parsed.data.amountCents, true);
    if (!r.start) return Response.json({ paid: true, shareId: r.share.id });
    if (ctx.device.vivaCloud) {
      const failed = await sendToTerminal(ctx, r.start, (message) => failShare(ctx.device.id, r.share.id, { error: message }, ctx.org.id));
      if (failed) return failed;
    }
    return Response.json({ ...startPayload(r.start), external: ctx.device.vivaCloud });
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/bills/shares");
  }
}
