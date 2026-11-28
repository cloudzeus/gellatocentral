import { z } from "zod";
import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import { tenantWriteTransaction } from "@/lib/migration-cutover";
import { issueSale, PosError } from "@/lib/pos";
import { cartLines, priceCart } from "@/lib/pos-cart";
import { pausedResponse, sendToTerminal, startPayload, tillErrorResponse } from "@/lib/pos-till";
import { shiftResponse } from "@/lib/till-shift";
import { ModifierError } from "@/lib/pos-modifiers";

const body = z.object({
  methodId: z.string().min(1).max(40).optional(), // τα seeded id είναι «pm_cash»…, όχι cuid
  // Παλιά builds της εφαρμογής στέλνουν «CASH»/«CARD» αντί για id: αντιστοιχεί στο σταθερό code του τρόπου πληρωμής.
  method: z.enum(["CASH", "CARD"]).optional(),
  // Ίδιο κλειδί για το ίδιο καλάθι: η επανάληψη επιστρέφει την ίδια πώληση. Προαιρετικό για τα παλιά builds.
  clientRef: z.string().min(8).max(64).optional(),
  lines: cartLines,
}).refine((b) => b.methodId || b.method);

// Η εφαρμογή στέλνει ΜΟΝΟ προϊόν + ποσότητα· τιμές και ΦΠΑ τα παίρνουμε από τη βάση.
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paused = await pausedResponse(ctx);
  if (paused) return paused;
  const noShift = await shiftResponse(ctx);
  if (noShift) return noShift;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const { clientRef } = parsed.data;
  if (clientRef) {
    const prior = await db.sale.findUnique({ where: { deviceId_clientRef: { deviceId: ctx.device.id, clientRef } }, select: { id: true, status: true, series: true, aa: true } });
    // Πληρώθηκε ήδη (η πρώτη απάντηση χάθηκε): το ταμείο κλείνει την πώληση, χωρίς δεύτερη χρέωση.
    if (prior?.status === "COMPLETED") return Response.json({ paid: true, saleId: prior.id, series: prior.series, aa: prior.aa });
    if (prior?.status === "AWAITING_PAYMENT") return tillErrorResponse(new PosError("busy", "Η πώληση αυτή περιμένει ήδη πληρωμή."), ctx, "pos/sales");
  }

  const methodId = parsed.data.methodId ?? (await db.paymentMethod.findFirst({ where: { code: parsed.data.method!.toLowerCase(), active: true, posEnabled: true }, select: { id: true } }))?.id;
  if (!methodId) return Response.json({ error: "method_unavailable", message: "Ο τρόπος πληρωμής δεν είναι διαθέσιμος στο ταμείο." }, { status: 400 });

  // Τιμή και επιλογές κάθε γραμμής από τον κατάλογο.
  let priced;
  try {
    priced = await priceCart(ctx.org.id, parsed.data.lines);
  } catch (e) {
    if (e instanceof ModifierError) return Response.json({ error: "invalid_options", message: e.message }, { status: 400 });
    throw e;
  }
  if (!priced) return Response.json({ error: "unknown_product" }, { status: 400 });

  try {
    // Η διαγραφή παλιού draft και η δημιουργία μπαίνουν στο ίδιο tenant gate με την έκδοση.
    const sale = await tenantWriteTransaction(ctx.org.id, async (tx) => {
      await tx.sale.deleteMany({ where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "DRAFT" } });
      // ακυρωμένη πώληση με το ίδιο κλειδί: το καλάθι ξαναχρεώνεται ως νέα πώληση
      if (clientRef) await tx.sale.updateMany({ where: { deviceId: ctx.device.id, clientRef, status: "CANCELLED" }, data: { clientRef: null } });
      return tx.sale.create({
        data: {
          orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id, clientRef,
          lines: { create: priced.map(({ seat: _seat, ...l }) => l) }, // η θέση αφορά μόνο λογαριασμούς τραπεζιού
        },
      });
    });
    const started = await issueSale(ctx, sale.id, methodId, true);
    if (!started) return Response.json({ error: "empty" }, { status: 400 });
    if (ctx.device.vivaCloud) {
      const failed = await sendToTerminal(ctx, started);
      if (failed) return failed;
    }
    return Response.json({ ...startPayload(started), external: ctx.device.vivaCloud });
  } catch (e) {
    // δύο ταυτόχρονα αιτήματα με το ίδιο κλειδί: το δεύτερο βλέπει την πώληση του πρώτου
    if ((e as { code?: string }).code === "P2002") return tillErrorResponse(new PosError("busy", "Η πώληση αυτή περιμένει ήδη πληρωμή."), ctx, "pos/sales");
    return tillErrorResponse(e, ctx, "pos/sales");
  }
}
