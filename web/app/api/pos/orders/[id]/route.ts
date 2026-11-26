import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { tillErrorResponse } from "@/lib/pos-till";
import { moveBody, moveOrder, orderErrorResponse } from "@/lib/orders";

// Αποδοχή (με χρόνο ετοιμασίας), απόρριψη με λόγο, «έτοιμη», «στον διανομέα», «παραδόθηκε», ακύρωση.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/orders/[id]">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = moveBody.extend({ byName: z.string().trim().max(60).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const { byName, ...input } = parsed.data;
  try {
    return Response.json(await moveOrder(ctx, (await params).id, input, byName));
  } catch (e) {
    return orderErrorResponse(e) ?? tillErrorResponse(e, ctx, "pos/orders/[id]");
  }
}
