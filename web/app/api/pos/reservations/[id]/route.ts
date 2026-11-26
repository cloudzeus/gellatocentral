import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { pausedResponse, tillErrorResponse } from "@/lib/pos-till";
import { closeReservation, reservationBody, reservationErrorResponse, seatReservation, updateReservation } from "@/lib/reservations";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("seat"), tableId: z.string().cuid().optional(), byName: z.string().trim().max(60).optional() }),
  z.object({ action: z.literal("no_show") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("update"), data: reservationBody.partial() }),
]);

// Ενέργειες σε κράτηση: «ήρθαν» (ανοίγει λογαριασμό στο τραπέζι), «δεν ήρθαν», ακύρωση, αλλαγή.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/reservations/[id]">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const id = (await params).id;
  const b = parsed.data;
  try {
    if (b.action === "seat") {
      const paused = await pausedResponse(ctx);
      if (paused) return paused;
      return Response.json(await seatReservation(ctx, id, b.tableId, b.byName));
    }
    if (b.action === "update") await updateReservation(ctx, id, b.data);
    else await closeReservation(ctx, id, b.action === "no_show" ? "NO_SHOW" : "CANCELLED");
    return Response.json({ ok: true });
  } catch (e) {
    return reservationErrorResponse(e) ?? tillErrorResponse(e, ctx, "pos/reservations/[id]");
  }
}
