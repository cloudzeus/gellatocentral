import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { completeSale, failSale } from "@/lib/pos";

const body = z.object({ success: z.boolean(), transactionId: z.string().max(100).optional(), callback: z.string().max(8000) });

// Η εφαρμογή αναφέρει το αποτέλεσμα που της επέστρεψε το Viva Terminal (callback URI).
// shortcut: εμπιστευόμαστε τη συσκευή (με το κλειδί της). Πριν από παραγωγή, επαλήθευση του transactionId
// απευθείας στη Viva (Transactions API / webhook), ώστε μια πειραγμένη εφαρμογή να μη «κλείνει» απλήρωτες πωλήσεις.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/sales/[id]/result">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const { id } = await params;
  const raw = { callback: parsed.data.callback };
  if (parsed.data.success) await completeSale(ctx.device.id, id, raw, parsed.data.transactionId);
  else await failSale(ctx.device.id, id, "Η πληρωμή δεν ολοκληρώθηκε στο τερματικό", raw);
  return Response.json({ ok: true });
}
