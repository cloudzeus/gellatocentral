import { z } from "zod";
import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import { athensDay, closeShift, lastKept, openShift, shiftReport, shiftsOn, ShiftError, startShift, tillStaff } from "@/lib/till-shift";

/** Ποιος είναι στη βάρδια· ?report=1 προσθέτει τα σύνολα της βάρδιας για την οθόνη κλεισίματος. */
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const on = await shiftsOn(ctx);
  if (!on) return Response.json({ on: false });
  const [shift, staff, kept, dayClosed] = await Promise.all([
    openShift(ctx.device.id), tillStaff(ctx), lastKept(ctx.device.id),
    db.tillDayClose.findUnique({ where: { deviceId_day: { deviceId: ctx.device.id, day: athensDay(new Date()) } }, select: { id: true } }),
  ]);
  const report = shift && new URL(req.url).searchParams.get("report") ? await shiftReport(ctx) : null;
  return Response.json({
    on: true, dayClosed: !!dayClosed, staff,
    shift: shift ? { id: shift.id, employee: shift.employee, startedAt: shift.startedAt, openingCents: shift.openingCents } : null,
    suggested: kept ? { cents: kept.keptCents ?? 0, by: kept.employee.name, at: kept.endedAt } : null,
    report: report ? { figures: report.figures, expectedCents: report.expectedCents } : null,
  });
}

const cents = z.number().int().min(0).max(10_000_000);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), employeeId: z.string().min(1).max(40), pin: z.string().regex(/^\d{4}$/), openingCents: cents }),
  z.object({ action: z.literal("close"), countedCents: cents, keptCents: cents, reason: z.string().trim().max(200).optional() }),
]);

export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid", message: "Λάθος στοιχεία" }, { status: 400 });
  try {
    if (parsed.data.action === "start") {
      const s = await startShift(ctx, parsed.data);
      return Response.json({ id: s.id });
    }
    return Response.json(await closeShift(ctx, parsed.data));
  } catch (e) {
    if (e instanceof ShiftError) return Response.json({ error: e.code, message: e.message }, { status: e.code === "wrong_pin" || e.code === "locked" ? 403 : 409 });
    throw e;
  }
}
