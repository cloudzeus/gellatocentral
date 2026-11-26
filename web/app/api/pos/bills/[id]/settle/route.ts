import { z } from "zod";
import { draftSettlement } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { issueSale } from "@/lib/pos";
import { pausedResponse, sendToTerminal, startPayload, tillErrorResponse } from "@/lib/pos-till";
import { shiftResponse } from "@/lib/till-shift";

// lines: μοίρασμα ανά είδη (τι πληρώνει αυτός ο πελάτης). Χωρίς lines πληρώνεται ό,τι μένει.
const body = z.object({
  methodId: z.string().min(1).max(40),
  lines: z.array(z.object({ lineId: z.string().cuid(), quantity: z.number().int().min(1).max(999) })).min(1).max(100).optional(),
});

// Πληρωμή ό,τι μένει στον λογαριασμό με μία απόδειξη. Από εδώ και πέρα όπως η άμεση πώληση: η εφαρμογή ανοίγει το
// Viva Terminal με το ίδιο payload και αναφέρει το αποτέλεσμα στο /api/pos/sales/[id]/result. Με την πληρωμή ο
// λογαριασμός κλείνει μόνος του (completeSale).
export async function POST(req: Request, { params }: RouteContext<"/api/pos/bills/[id]/settle">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paused = await pausedResponse(ctx);
  if (paused) return paused;
  const noShift = await shiftResponse(ctx);
  if (noShift) return noShift;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const sale = await draftSettlement(ctx, (await params).id, parsed.data.lines);
    const started = await issueSale(ctx, sale.id, parsed.data.methodId, true);
    if (!started) return Response.json({ error: "empty" }, { status: 400 });
    if (ctx.device.vivaCloud) {
      const failed = await sendToTerminal(ctx, started);
      if (failed) return failed;
    }
    return Response.json({ ...startPayload(started), external: ctx.device.vivaCloud });
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/bills/settle");
  }
}
