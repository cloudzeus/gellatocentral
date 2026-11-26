import { z } from "zod";
import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import { customerCard } from "@/lib/orders";
import { liveCall } from "@/lib/telephony/calls";

// Το ταμείο ρωτά κάθε 2″ αν χτυπά τηλέφωνο γι' αυτό· μαζί έρχεται η καρτέλα του πελάτη (ή null για άγνωστο αριθμό).
// shortcut: polling· με πολλά ταμεία SSE από τον server.
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const call = await liveCall(ctx);
  if (!call) return Response.json({ call: null });
  return Response.json({ call: { ...call, customer: await customerCard(ctx, call.phone) } });
}

// Το ταμείο έκλεισε την καρτέλα της κλήσης: δεν ξαναεμφανίζεται.
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = z.object({ id: z.string().cuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  await db.call.updateMany({ where: { id: parsed.data.id, orgId: ctx.org.id }, data: { seenAt: new Date() } });
  return Response.json({ ok: true });
}
