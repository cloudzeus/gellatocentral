import { z } from "zod";
import { voidLine } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { tillErrorResponse } from "@/lib/pos-till";

const body = z.object({ reason: z.string().trim().min(1).max(120) });

// Ακύρωση γραμμής που δεν έχει πληρωθεί. Η γραμμή μένει στον λογαριασμό, σημειωμένη με τον λόγο.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/bills/[id]/lines/[lineId]/void">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const { id, lineId } = await params;
  try {
    await voidLine(ctx, id, lineId, parsed.data.reason);
    return Response.json({ ok: true });
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/bills/void");
  }
}
