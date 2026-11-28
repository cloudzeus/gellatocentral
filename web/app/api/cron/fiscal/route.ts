// Επανάληψη διαβιβάσεων που απέτυχαν. Καλείται από τον χρονοδιακόπτη (cron του Coolify) κάθε λίγα λεπτά
// με `Authorization: Bearer $CRON_SECRET`· η αναμονή ανά παραστατικό (backoff) είναι μέσα στο retryFiscal.
import { timingSafeEqual } from "node:crypto";
import { setting } from "@/lib/config";
import { retryFiscal } from "@/lib/fiscal-retry";
import { resolveStaleSales } from "@/lib/sale-resolve";

export async function POST(req: Request) {
  const secret = await setting("CRON_SECRET");
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (secret.length < 20 || Buffer.byteLength(given) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return Response.json({ error: "unauthorized" }, { status: 401 });
  // πρώτα οι πωλήσεις σε αναμονή: όσες πληρώθηκαν παίρνουν απόδειξη πριν από την επανάληψη διαβιβάσεων
  const sales = await resolveStaleSales();
  return Response.json({ ...(await retryFiscal()), sales });
}
