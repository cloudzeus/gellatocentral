import { z } from "zod";
import { cancelBill } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { tillErrorResponse } from "@/lib/pos-till";

const body = z.object({ reason: z.string().trim().min(1).max(120) });

// Κλείσιμο λογαριασμού χωρίς πληρωμή: μόνο αν δεν έχει πληρωθεί ή δεν πληρώνεται τίποτα.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/bills/[id]/cancel">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    await cancelBill(ctx, (await params).id, parsed.data.reason);
    return Response.json({ ok: true });
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/bills/cancel");
  }
}
