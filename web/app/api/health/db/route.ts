import { db } from "@/lib/db";

// Έλεγχος ετοιμότητας: απαντά 200 μόνο αν η βάση απαντά μέσα σε 2 δευτ. Ξεχωριστό από το /api/health, που μένει
// έλεγχος «ζει ο server»: αν το Coolify επανεκκινούσε το container σε κάθε διακοπή της βάσης, θα χειροτέρευε τη διακοπή.
export async function GET() {
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "database_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
