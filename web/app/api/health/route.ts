import { db } from "@/lib/db";

// Έλεγχος υγείας για τον load balancer και την παρακολούθηση: 200 μόνο αν ο κόμβος φτάνει στη βάση.
// Δεν αποκαλύπτει τίποτα άλλο (ούτε εκδόσεις, ούτε λεπτομέρειες σφάλματος).
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
