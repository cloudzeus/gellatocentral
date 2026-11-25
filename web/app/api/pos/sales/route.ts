import { z } from "zod";
import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import { accessFor } from "@/lib/plan-data";
import { TenantWriteBlockedError, tenantWriteTransaction } from "@/lib/migration-cutover";
import { issueSale, pendingSale, PosError } from "@/lib/pos";
import { toVivaJson } from "@/lib/viva/fiscal";

const body = z.object({
  methodId: z.string().min(1).max(40).optional(), // τα seeded id είναι «pm_cash»…, όχι cuid
  // Παλιά builds της εφαρμογής στέλνουν «CASH»/«CARD» αντί για id: αντιστοιχεί στο σταθερό code του τρόπου πληρωμής.
  method: z.enum(["CASH", "CARD"]).optional(),
  lines: z.array(z.object({ productId: z.string().cuid(), quantity: z.number().int().min(1).max(999) })).min(1).max(100),
}).refine((b) => b.methodId || b.method);

const startPayload = (s: { saleId: string; reference: string; receipt: { totalCents: number; data: unknown } }) => ({
  saleId: s.saleId,
  reference: s.reference,
  amountCents: s.receipt.totalCents,
  // Για το deeplink της Viva (inter-app): το fiscalisationData πηγαίνει Base64URL
  fiscalisationData: Buffer.from(toVivaJson(s.receipt.data)).toString("base64url"),
});

// Η εφαρμογή στέλνει ΜΟΝΟ προϊόν + ποσότητα· τιμές και ΦΠΑ τα παίρνουμε από τη βάση.
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  // αναστολή, κλείσιμο, απλήρωτη συνδρομή, εποχιακή παύση ή πακέτο χωρίς ταμείο: δεν εκδίδονται αποδείξεις
  const access = await accessFor(ctx.org.id, [ctx.device.storeId]);
  if (!access.open.includes("pos")) return Response.json({ error: "paused", message: access.state.kind === "closing" ? "Η επιχείρηση κλείνει: το ταμείο είναι κλειστό" : access.state.kind === "suspended" ? "Η επιχείρηση είναι σε αναστολή. Επικοινώνησε με την υποστήριξη" : access.state.kind === "unpaid" ? "Η συνδρομή έχει λήξει. Με την πληρωμή το ταμείο ανοίγει αμέσως" : access.paused ? "Το κατάστημα είναι σε εποχιακή παύση. Ο διαχειριστής το ανοίγει ξανά από τη Συνδρομή" : "Το πακέτο της επιχείρησης δεν περιλαμβάνει ταμείο" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const methodId = parsed.data.methodId ?? (await db.paymentMethod.findFirst({ where: { code: parsed.data.method!.toLowerCase(), active: true, posEnabled: true }, select: { id: true } }))?.id;
  if (!methodId) return Response.json({ error: "method_unavailable", message: "Ο τρόπος πληρωμής δεν είναι διαθέσιμος στο ταμείο." }, { status: 400 });

  const qty = new Map<string, number>();
  for (const l of parsed.data.lines) qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.quantity);
  const products = await db.product.findMany({ where: { id: { in: [...qty.keys()] }, orgId: ctx.org.id, active: true }, include: { vatRate: true } });
  if (products.length !== qty.size) return Response.json({ error: "unknown_product" }, { status: 400 });

  try {
    // Η διαγραφή παλιού draft και η δημιουργία μπαίνουν στο ίδιο tenant gate με την έκδοση.
    const sale = await tenantWriteTransaction(ctx.org.id, async (tx) => {
      await tx.sale.deleteMany({ where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "DRAFT" } });
      return tx.sale.create({
        data: {
          orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id,
          lines: { create: products.map((p) => ({ productId: p.id, name: p.name, quantity: qty.get(p.id)!, unitPriceCents: p.priceCents, vatRate: p.vatRate.rate })) },
        },
      });
    });
    const started = await issueSale(ctx, sale.id, methodId, true);
    if (!started) return Response.json({ error: "empty" }, { status: 400 });
    return Response.json(startPayload(started));
  } catch (e) {
    // 409 ΜΟΝΟ όταν υπάρχει ήδη πληρωμή σε εξέλιξη: η εφαρμογή το διαβάζει έτσι. Μαζί πάει η εκκρεμής πώληση, ώστε η
    // συσκευή να τη συνεχίσει ακόμη κι αν έχασε την πρώτη απάντηση (κακό δίκτυο) ή έκλεισε στη μέση.
    if (e instanceof PosError && e.code === "busy") {
      const pending = await pendingSale(db, ctx);
      return Response.json({ error: "busy", message: e.message, pending: pending && { ...startPayload(pending), methodId: pending.methodId, methodName: pending.methodName, issuedAt: pending.issuedAt } }, { status: 409 });
    }
    if (e instanceof PosError) return Response.json({ error: e.code, message: e.message }, { status: 400 });
    if (e instanceof TenantWriteBlockedError) return Response.json({ error: "paused", message: e.message }, { status: 403 });
    console.error("pos/sales:", e instanceof Error ? e.message : e);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
