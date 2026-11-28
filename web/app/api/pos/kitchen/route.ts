import { z } from "zod";
import { kitchenFromRequest } from "@/lib/device-auth";
import { bumpTicket, kitchenBoard, kitchenDevice, markReady } from "@/lib/kitchen";

// Οθόνη κουζίνας: GET = τα δελτία (η εφαρμογή ρωτά κάθε 5″), POST = «έτοιμο» σε είδος, σε δελτίο ή αναίρεση.
export async function GET(req: Request) {
  const ctx = await kitchenFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const device = await kitchenDevice(ctx.device.id);
  return Response.json({ device, ...(await kitchenBoard(ctx, device.station, device.kdsLateMin)) });
}

const station = z.enum(["KITCHEN", "BAR"]);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("line"), lineIds: z.array(z.string().cuid()).min(1).max(100), ready: z.boolean() }),
  z.object({ action: z.literal("bump"), roundId: z.string().cuid(), station }),
]);

export async function POST(req: Request) {
  const ctx = await kitchenFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const b = parsed.data;
  return Response.json(b.action === "line" ? await markReady(ctx, b.lineIds, b.ready) : await bumpTicket(ctx, b.roundId, b.station));
}
