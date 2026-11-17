import { z } from "zod";
import { db } from "@/lib/db";
import { deviceFromRequest } from "@/lib/device-auth";
import { DEVICE_KIND } from "@/lib/devices";

// Οι συσκευές στέλνουν εδώ τις μετρήσεις τους (θερμοκρασία ψυγείου, ζύγιση), με το κλειδί που πήραν στη σύζευξη:
//   POST /api/devices/readings   Authorization: Bearer <κλειδί>
//   { "value": -18.4 }   ή   { "readings": [{ "value": -18.4, "at": "2026-11-17T08:00:00Z" }, …] }  (έως 500, για όσα μαζεύτηκαν χωρίς σύνδεση)
// Το είδος της μέτρησης το ορίζει το είδος της συσκευής: ένα ψυγείο δεν μπορεί να δηλώσει ζύγιση.
const reading = z.object({ value: z.number().finite().min(-100).max(100_000), at: z.coerce.date().optional() });
const body = z.union([reading.transform((r) => [r]), z.object({ readings: z.array(reading).min(1).max(500) }).transform((b) => b.readings)]);

export async function POST(req: Request) {
  const ctx = await deviceFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const kind = DEVICE_KIND[ctx.device.kind].measures;
  if (!kind) return Response.json({ error: "device_does_not_measure" }, { status: 400 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const now = Date.now();
  // μέτρηση «από το μέλλον» (λάθος ρολόι συσκευής) καταγράφεται με την ώρα του server
  const data = parsed.data.map((r) => ({ orgId: ctx.org.id, deviceId: ctx.device.id, kind, value: r.value, at: r.at && r.at.getTime() <= now + 60_000 ? r.at : new Date(now) }));
  await db.reading.createMany({ data });
  return Response.json({ saved: data.length });
}
