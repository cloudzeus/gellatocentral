import { tillFromRequest } from "@/lib/device-auth";
import { pausedResponse, tillErrorResponse } from "@/lib/pos-till";
import { createPhoneOrder, orderErrorResponse, phoneOrderBody, storeOrders } from "@/lib/orders";

// Οι παραγγελίες εκτός καταστήματος (τηλέφωνο, Wolt, efood): ίδιες σε όλα τα ταμεία του καταστήματος.
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await storeOrders(ctx));
}

// Νέα τηλεφωνική παραγγελία από το καλάθι του ταμείου.
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paused = await pausedResponse(ctx);
  if (paused) return paused;
  const parsed = phoneOrderBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid", message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    return Response.json(await createPhoneOrder(ctx, parsed.data));
  } catch (e) {
    return orderErrorResponse(e) ?? tillErrorResponse(e, ctx, "pos/orders");
  }
}
