import { z } from "zod";
import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import type { Prisma } from "@/lib/generated/prisma/client";
import { accessFor } from "@/lib/plan-data";
import { completeSale, failSale } from "@/lib/pos";
import { verifySaleSession } from "@/lib/viva/cloud-terminal";

const body = z.object({ success: z.boolean(), transactionId: z.string().max(100).optional(), callback: z.string().max(8000) });

// Η εφαρμογή αναφέρει το callback του Viva Terminal. Η επιτυχία ολοκληρώνεται μόνο αφού
// ο server ανακτήσει και διασταυρώσει τη συνεδρία· το callback δεν αποτελεί απόδειξη πληρωμής.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/sales/[id]/result">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const access = await accessFor(ctx.org.id, [ctx.device.storeId]);
  if (!access.open.includes("pos")) return Response.json({ error: "paused" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const { id } = await params;
  const sale = await db.sale.findFirst({
    where: { id, orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id },
    select: {
      id: true, orgId: true, storeId: true, deviceId: true, status: true, totalCents: true,
      payment: { select: { amountCents: true, vivaSessionId: true } },
    },
  });
  if (!sale) return Response.json({ error: "not_found" }, { status: 404 });

  // Η δήλωση αποτυχίας ακολουθεί το υπάρχον ασφαλές flow και δεν χρησιμοποιείται ως απόδειξη επιτυχίας.
  if (!parsed.data.success) {
    await failSale(ctx.device.id, sale.id, "Η πληρωμή δεν ολοκληρώθηκε στο τερματικό", { callback: parsed.data.callback }, ctx.org.id);
    return Response.json({ ok: true });
  }
  if (sale.status !== "AWAITING_PAYMENT" && sale.status !== "COMPLETED")
    return Response.json({ error: "invalid_state" }, { status: 409 });

  let verification: Awaited<ReturnType<typeof verifySaleSession>>;
  try {
    verification = await verifySaleSession(sale, {
      orgId: ctx.org.id,
      storeId: ctx.store.id,
      deviceId: ctx.device.id,
      terminalId: ctx.device.vivaTerminalId,
    }, parsed.data.transactionId);
  } catch {
    // Σφάλμα δικτύου/provider: η πώληση μένει σε αναμονή για νέα προσπάθεια.
    return Response.json({ error: "viva_unavailable" }, { status: 502 });
  }
  if (verification.status === "pending") return Response.json({ pending: true }, { status: 202 });
  if (verification.status === "rejected")
    return Response.json({ error: "verification_failed", reason: verification.reason }, { status: 409 });

  // Το completeSale είναι idempotent· αποθηκεύουμε αποκλειστικά την επαληθευμένη απάντηση του provider.
  await completeSale(ctx.device.id, sale.id, verification.raw as Prisma.InputJsonObject, verification.transactionId, ctx.org.id);
  return Response.json({ ok: true });
}
