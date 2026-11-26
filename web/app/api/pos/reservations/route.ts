import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { pausedResponse, tillErrorResponse } from "@/lib/pos-till";
import { createReservation, dayReservations, guestHistory, reservationBody, reservationErrorResponse } from "@/lib/reservations";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });

// Κρατήσεις της ημέρας (?date=YYYY-MM-DD, προεπιλογή σήμερα), ή το ιστορικό ενός πελάτη (?phone=…) για τη φόρμα νέας κράτησης.
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone");
  if (phone) return Response.json({ guest: await guestHistory(ctx, phone) });
  const date = url.searchParams.get("date") ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "invalid" }, { status: 400 });
  return Response.json(await dayReservations(ctx, date));
}

export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paused = await pausedResponse(ctx);
  if (paused) return paused;
  const parsed = reservationBody.extend({ byName: z.string().trim().max(60).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const { byName, ...input } = parsed.data;
  try {
    return Response.json(await createReservation(ctx, input, byName));
  } catch (e) {
    return reservationErrorResponse(e) ?? tillErrorResponse(e, ctx, "pos/reservations");
  }
}
