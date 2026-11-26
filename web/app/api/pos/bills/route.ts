import { z } from "zod";
import { openBill, storeBills } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { pausedResponse, tillErrorResponse } from "@/lib/pos-till";

// Η κάτοψη του καταστήματος: τραπέζια και ανοιχτοί λογαριασμοί, ίδια για κάθε συσκευή.
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await storeBills(ctx));
}

const body = z.object({
  tableId: z.string().cuid().optional(),
  label: z.string().trim().min(1).max(60).optional(),
  guests: z.number().int().min(1).max(99).optional(),
  byName: z.string().trim().max(60).optional(),
}).refine((b) => b.tableId || b.label, { message: "τραπέζι ή όνομα" });

// Άνοιγμα λογαριασμού. Σε τραπέζι που είναι ήδη ανοιχτό επιστρέφει τον υπάρχοντα (existing: true).
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paused = await pausedResponse(ctx);
  if (paused) return paused;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    return Response.json(await openBill(ctx, parsed.data));
  } catch (e) {
    return tillErrorResponse(e, ctx, "pos/bills");
  }
}
