import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { deviceReceiving } from "@/lib/receiving";
import { setItemSpot } from "@/lib/storage-spots";
import { WorkflowError } from "@/lib/workflow-db";

const body = z.object({ genericItemId: z.string().min(1).max(40), warehouseId: z.string().min(1).max(40), spotId: z.string().max(40).nullish(), name: z.string().trim().max(60).nullish() });

/** Ορίζει πού μπαίνει ένα υλικό στην αποθήκη· η επόμενη παραλαβή και το απόθεμα θα το δείχνουν. */
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid", message: "Λάθος στοιχεία θέσης" }, { status: 400 });
  const { stock, warehouseIds, denied } = await deviceReceiving(ctx, "stock");
  if (denied) return Response.json({ error: "role", message: denied }, { status: 403 });
  try { return Response.json({ spot: await setItemSpot(stock.orgId, warehouseIds, parsed.data, stock.userName) }); }
  catch (e) { if (e instanceof WorkflowError) return Response.json({ error: "workflow", message: e.message }, { status: 409 }); throw e; }
}
