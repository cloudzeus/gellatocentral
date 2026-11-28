import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { checkQuietly, resolveCheck } from "@/lib/mydata-check";
import { receivePurchaseOrder } from "@/lib/procurement-db";
import { deviceReceiving, openOrders, orderInStore } from "@/lib/receiving";
import { StockScopeError } from "@/lib/stock-scope";
import { WorkflowError } from "@/lib/workflow-db";

/** Οι ανοιχτές παραγγελίες των αποθηκών του καταστήματος, με barcodes για τη σάρωση. */
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { stock, warehouseIds, denied } = await deviceReceiving(ctx);
  if (denied) return Response.json({ error: "role", message: denied }, { status: 403 });
  return Response.json({ orders: await openOrders(stock, warehouseIds) });
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((d) => new Date(`${d}T12:00:00Z`));
const body = z.object({
  orderId: z.string().min(1).max(40),
  clientKey: z.string().regex(/^[-_a-zA-Z0-9]{8,100}$/),
  lines: z.array(z.object({ orderLineId: z.string().min(1).max(40), quantityBase: z.number().int().positive(), batchNumber: z.string().trim().max(20).nullish(), expiresAt: day.nullish() })).min(1).max(200),
  deliveryNote: z.object({ number: z.string().trim().max(60).nullish(), date: day.nullish(), mark: z.string().trim().max(30).nullish() }).optional(),
  shortfall: z.array(z.object({ orderLineId: z.string().min(1).max(40), action: z.enum(["wait", "close"]), expectedAt: day.nullish() })).max(200).optional(),
  remark: z.string().trim().max(300).optional(),
  mydataPaper: z.boolean().optional(), // ο αποθηκάριος είπε «το χαρτί είναι σωστό» σε διαφορά με το myDATA
});

/** Καταχώριση παραλαβής: η ίδια με τη σελίδα της παραγγελίας (απόθεμα, παρτίδες, έλεγχος τιμών, αναμενόμενα). */
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid", message: "Λάθος στοιχεία παραλαβής" }, { status: 400 });
  const { stock, warehouseIds, denied } = await deviceReceiving(ctx);
  if (denied) return Response.json({ error: "role", message: denied }, { status: 403 });
  if (!(await orderInStore(stock.orgId, parsed.data.orderId, warehouseIds))) return Response.json({ error: "scope", message: "Η παραγγελία δεν ανήκει στις αποθήκες αυτού του καταστήματος" }, { status: 403 });
  try {
    const { mydataPaper, ...input } = parsed.data;
    const r = await receivePurchaseOrder(stock, input);
    // ο έλεγχος με το myDATA γράφεται στο παραστατικό της παραλαβής· λάθος της ΑΑΔΕ δεν χαλάει την καταχώριση
    const check = await checkQuietly(stock.orgId, r.purchaseDocId);
    if (check?.status === "DIFF" && mydataPaper) await resolveCheck(stock.orgId, r.purchaseDocId, "PAPER", stock.userName).catch(() => undefined);
    return Response.json({ ok: true, receipt: r });
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ error: "workflow", message: e.message }, { status: 409 });
    if (e instanceof StockScopeError) return Response.json({ error: "scope", message: "Η παραγγελία δεν ανήκει στις αποθήκες αυτού του καταστήματος" }, { status: 403 });
    throw e;
  }
}
