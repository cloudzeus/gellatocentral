// Καιρός δύο φορές την ημέρα (MET Norway) για κάθε κατάστημα με συντεταγμένες· τροφοδοτεί την πρόβλεψη με καιρό.
import { timingSafeEqual } from "node:crypto";
import { setting } from "@/lib/config";
import { db } from "@/lib/db";
import { refreshWeather } from "@/lib/planning/planning-db";

export async function POST(req: Request) {
  const secret = await setting("CRON_SECRET");
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (secret.length < 20 || Buffer.byteLength(given) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return Response.json({ error: "unauthorized" }, { status: 401 });
  // shortcut: το User-Agent (στοιχεία επικοινωνίας που ζητά το MET) διαβάζεται από env· να μπει στη σελίδα ρυθμίσεων μαζί με τα υπόλοιπα κλειδιά.
  return Response.json(await refreshWeather(db, { userAgent: process.env.MET_NO_USER_AGENT ?? "" }));
}
