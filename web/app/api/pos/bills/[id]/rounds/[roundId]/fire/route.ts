import { after } from "next/server";
import { fireRound } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { signOrderSlips } from "@/lib/order-slips";
import { pausedResponse, tillErrorResponse } from "@/lib/pos-till";
import { openShift } from "@/lib/till-shift";

// «Βγάλ' το»: η αποστολή που περίμενε («Μετά») πάει τώρα σε κουζίνα/bar με το 8.6 της.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/bills/[id]/rounds/[roundId]/fire">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paused = await pausedResponse(ctx);
  if (paused) return paused;
  const { id, roundId } = await params;
  try {
    const r = await fireRound(ctx, id, roundId, (await openShift(ctx.device.id))?.employee.name);
    after(() => signOrderSlips(ctx.org.id, ctx.issuer.vivaMerchantId ?? null, r.slipIds));
    return Response.json({ ok: true });
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/bills/fire");
  }
}
