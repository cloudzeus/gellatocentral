import { z } from "zod";
import { markServed } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { tillErrorResponse } from "@/lib/pos-till";

const body = z.object({ lineIds: z.array(z.string().cuid()).min(1).max(100), served: z.boolean() });

// Ο σερβιτόρος σημειώνει ότι σέρβιρε γραμμές του λογαριασμού (ή το αναιρεί).
export async function POST(req: Request, { params }: RouteContext<"/api/pos/bills/[id]/served">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    return Response.json(await markServed(ctx, (await params).id, parsed.data.lineIds, parsed.data.served));
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/bills/served");
  }
}
