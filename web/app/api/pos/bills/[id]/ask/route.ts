import { z } from "zod";
import { askBill } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { tillErrorResponse } from "@/lib/pos-till";

const body = z.object({ ask: z.boolean(), cash: z.boolean().optional() });

// «Ζήτησε λογαριασμό» (cash: θα πληρώσει μετρητά στον ταμία) ή αναίρεση.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/bills/[id]/ask">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    return Response.json(await askBill(ctx, (await params).id, parsed.data.ask, parsed.data.cash));
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/bills/ask");
  }
}
