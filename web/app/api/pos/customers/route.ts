import { tillFromRequest } from "@/lib/device-auth";
import { pausedResponse, tillErrorResponse } from "@/lib/pos-till";
import { createCustomer, customerCard, newCustomerBody } from "@/lib/orders";

// Η καρτέλα πελάτη από το τηλέφωνο (?phone=…), για τηλεφωνική παραγγελία χωρίς τηλεφωνικό κέντρο.
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const phone = new URL(req.url).searchParams.get("phone") ?? "";
  return Response.json({ customer: await customerCard(ctx, phone) });
}

// Νέος πελάτης από άγνωστο αριθμό.
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paused = await pausedResponse(ctx);
  if (paused) return paused;
  const parsed = newCustomerBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    await createCustomer(ctx, parsed.data);
    return Response.json({ customer: await customerCard(ctx, parsed.data.phone) });
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/customers");
  }
}
