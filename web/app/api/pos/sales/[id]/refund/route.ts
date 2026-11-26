import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import { tenantWriteTransaction } from "@/lib/migration-cutover";
import { refundSale } from "@/lib/pos-refund";
import { shiftResponse } from "@/lib/till-shift";

const body = z.object({ reason: z.string().trim().min(1).max(200) });

/**
 * Επιστροφή χρημάτων από το ταμείο: πιστωτικό 11.4 για όλη την απόδειξη και επιστροφή στο τερματικό Viva του ταμείου.
 * Μόνο για αποδείξεις αυτού του ταμείου. Η εφαρμογή περιμένει με το GET /credits/[id].
 */
export async function POST(req: Request, { params }: RouteContext<"/api/pos/sales/[id]/refund">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const noShift = await shiftResponse(ctx);
  if (noShift) return noShift;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid", message: "Διάλεξε αιτία επιστροφής" }, { status: 400 });
  const id = (await params).id;
  const sale = await db.sale.findFirst({ where: { id, orgId: ctx.org.id, deviceId: ctx.device.id, status: "COMPLETED" }, select: { id: true, storeId: true, totalCents: true } });
  if (!sale) return Response.json({ error: "not_found", message: "Η απόδειξη δεν βρέθηκε σε αυτό το ταμείο" }, { status: 404 });
  const r = await refundSale(ctx.org.id, sale.id);
  if (!r.ok) return Response.json({ error: r.code, message: r.message }, { status: r.code === "not_refundable" ? 409 : 400 });
  await tenantWriteTransaction(ctx.org.id, (tx) => writeAudit(tx, {
    orgId: ctx.org.id, actor: { id: null, name: ctx.device.name }, action: "sale.refund", entityType: "sale", entityId: sale.id,
    storeId: sale.storeId, reason: parsed.data.reason, metadata: { creditId: r.creditId, amountCents: r.amountCents },
  }));
  return Response.json({ creditId: r.creditId, amountCents: r.amountCents, state: r.live ? "pending" : "completed" });
}
