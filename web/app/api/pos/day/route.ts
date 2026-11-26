import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { athensDay, closeDay, dayReport, ShiftError } from "@/lib/till-shift";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Κλείσιμο ημέρας του ταμείου: σύνολα ανά ταμία και τι εμποδίζει το κλείσιμο. ?date=YYYY-MM-DD (προεπιλογή: σήμερα). */
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const d = day.safeParse(new URL(req.url).searchParams.get("date") ?? athensDay(new Date()));
  if (!d.success) return Response.json({ error: "invalid" }, { status: 400 });
  return Response.json(await dayReport(ctx, d.data));
}

export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const d = z.object({ date: day }).safeParse(await req.json().catch(() => null));
  if (!d.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    await closeDay(ctx, d.data.date);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof ShiftError) return Response.json({ error: e.code, message: e.message }, { status: 409 });
    throw e;
  }
}
