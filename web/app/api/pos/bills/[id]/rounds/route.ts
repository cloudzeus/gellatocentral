import { z } from "zod";
import { addRound } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { cartLines, priceCart } from "@/lib/pos-cart";
import { pausedResponse, tillErrorResponse } from "@/lib/pos-till";

const body = z.object({ lines: cartLines, byName: z.string().trim().max(60).optional() });

// Νέα αποστολή στον λογαριασμό. Η συσκευή στέλνει μόνο προϊόν, ποσότητα, επιλογές· τιμές από τον κατάλογο.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/bills/[id]/rounds">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paused = await pausedResponse(ctx);
  if (paused) return paused;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const priced = await priceCart(ctx.org.id, parsed.data.lines);
    if (!priced) return Response.json({ error: "unknown_product" }, { status: 400 });
    return Response.json(await addRound(ctx, (await params).id, priced, parsed.data.byName));
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/bills/rounds");
  }
}
