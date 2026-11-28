import { z } from "zod";
import { setSoldOut, soldOutIds } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { tillErrorResponse } from "@/lib/pos-till";
import { openShift } from "@/lib/till-shift";

// Τι έχει τελειώσει σήμερα στο κατάστημα (προϊόντα και γεύσεις).
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ soldOut: await soldOutIds(ctx) });
}

const body = z.object({ itemId: z.string().cuid(), out: z.boolean() });

// «Τελείωσε» / «Υπάρχει ξανά» από τη συσκευή.
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    return Response.json({ soldOut: await setSoldOut(ctx, parsed.data.itemId, parsed.data.out, (await openShift(ctx.device.id))?.employee.name) });
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/soldout");
  }
}
