// Βραδινός έλεγχος σκαναρισμένων παραστατικών με το myDATA (lib/mydata-check.ts). Καλείται από τον χρονοδιακόπτη
// (cron του Coolify) μία φορά τη νύχτα με `Authorization: Bearer $CRON_SECRET`.
import { timingSafeEqual } from "node:crypto";
import { setting } from "@/lib/config";
import { recheckDue } from "@/lib/mydata-check";

export async function POST(req: Request) {
  const secret = await setting("CRON_SECRET");
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (secret.length < 20 || Buffer.byteLength(given) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await recheckDue());
}
