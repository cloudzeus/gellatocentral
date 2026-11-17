import { z } from "zod";
import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import { issueSale } from "@/lib/pos";
import { toVivaJson } from "@/lib/viva/fiscal";

const body = z.object({
  method: z.enum(["CASH", "CARD"]),
  lines: z.array(z.object({ productId: z.string().cuid(), quantity: z.number().int().min(1).max(999) })).min(1).max(100),
});

// Η εφαρμογή στέλνει ΜΟΝΟ προϊόν + ποσότητα· τιμές και ΦΠΑ τα παίρνουμε από τη βάση.
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const qty = new Map<string, number>();
  for (const l of parsed.data.lines) qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.quantity);
  const products = await db.product.findMany({ where: { id: { in: [...qty.keys()] }, orgId: ctx.org.id, active: true } });
  if (products.length !== qty.size) return Response.json({ error: "unknown_product" }, { status: 400 });

  // ένα πρόχειρο ανά συσκευή: το προηγούμενο (π.χ. από αποτυχημένη πληρωμή) αντικαθίσταται
  await db.sale.deleteMany({ where: { deviceId: ctx.device.id, status: "DRAFT" } });
  const sale = await db.sale.create({
    data: {
      orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id,
      lines: { create: products.map((p) => ({ productId: p.id, name: p.name, quantity: qty.get(p.id)!, unitPriceCents: p.priceCents, vatRate: p.vatRate })) },
    },
  });
  try {
    const started = await issueSale(ctx, sale.id, parsed.data.method, true);
    if (!started) return Response.json({ error: "empty" }, { status: 400 });
    return Response.json({
      saleId: started.saleId,
      reference: started.reference,
      amountCents: started.receipt.totalCents,
      // Για το deeplink της Viva (inter-app): το fiscalisationData πηγαίνει Base64URL
      fiscalisationData: Buffer.from(toVivaJson(started.receipt.data)).toString("base64url"),
    });
  } catch (e) {
    return Response.json({ error: "busy", message: e instanceof Error ? e.message : "" }, { status: 409 });
  }
}
