"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { completeSale, failSale, issueSale } from "@/lib/pos";
import { currentContext } from "@/lib/tenant";
import { getSession, startSale, vivaConfigured } from "@/lib/viva/cloud-terminal";

const id = z.string().cuid();

async function draftSale(tx: Prisma.TransactionClient, ctx: Awaited<ReturnType<typeof currentContext>>) {
  const where = { deviceId: ctx.device.id, status: "DRAFT" as const };
  return (
    (await tx.sale.findFirst({ where })) ??
    (await tx.sale.create({ data: { orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id } }))
  );
}

export async function addLine(productId: string) {
  const ctx = await currentContext();
  // το προϊόν πρέπει να ανήκει στην επιχείρηση του χρήστη
  const product = await db.product.findFirst({ where: { id: id.parse(productId), orgId: ctx.org.id, active: true } });
  if (!product) return;
  await db.$transaction(async (tx) => {
    const sale = await draftSale(tx, ctx);
    await tx.saleLine.upsert({
      where: { saleId_productId: { saleId: sale.id, productId: product.id } },
      update: { quantity: { increment: 1 } },
      create: { saleId: sale.id, productId: product.id, name: product.name, quantity: 1, unitPriceCents: product.priceCents, vatRate: product.vatRate },
    });
  });
  revalidatePath("/pos");
}

export async function changeQuantity(lineId: string, delta: 1 | -1) {
  const ctx = await currentContext();
  const line = await db.saleLine.findFirst({ where: { id: id.parse(lineId), sale: { deviceId: ctx.device.id, status: "DRAFT" } } });
  if (!line) return;
  if (line.quantity + delta <= 0) await db.saleLine.delete({ where: { id: line.id } });
  else await db.saleLine.update({ where: { id: line.id }, data: { quantity: { increment: delta } } });
  revalidatePath("/pos");
}

export async function clearSale() {
  const ctx = await currentContext();
  await db.saleLine.deleteMany({ where: { sale: { deviceId: ctx.device.id, status: "DRAFT" } } });
  revalidatePath("/pos");
}

export async function pay(method: "CASH" | "CARD") {
  z.enum(["CASH", "CARD"]).parse(method);
  const ctx = await currentContext();
  const live = await vivaConfigured();
  if (live && !(ctx.org.vivaMerchantId && ctx.device.vivaTerminalId))
    throw new Error("Λείπει ο κωδικός εμπόρου Viva ή το τερματικό της συσκευής.");
  const draft = await db.sale.findFirst({ where: { deviceId: ctx.device.id, status: "DRAFT" }, select: { id: true } });
  const started = draft && (await issueSale(ctx, draft.id, method, live));
  if (!started) return;

  if (live) {
    try {
      await startSale({
        sessionId: started.reference,
        terminalId: ctx.device.vivaTerminalId!,
        cashRegisterId: ctx.device.id,
        amountCents: started.receipt.totalCents,
        merchantReference: started.saleId,
        terminalMerchantId: ctx.org.vivaMerchantId!,
        fiscalisationData: started.receipt.data,
      });
    } catch (e) {
      await failSale(ctx.device.id, started.saleId, e instanceof Error ? e.message : String(e));
    }
  }
  revalidatePath("/pos");
}

/** Ρωτά τη Viva για την πληρωμή που περιμένει. Ασφαλές να κληθεί ξανά και ξανά. */
export async function syncPayment(saleId: string) {
  const ctx = await currentContext();
  const sale = await db.sale.findFirst({ where: { id: saleId, deviceId: ctx.device.id, status: "AWAITING_PAYMENT" }, include: { payment: true } });
  if (!sale?.payment?.vivaSessionId) return;
  const session = await getSession(sale.payment.vivaSessionId);
  if (!session) return; // ακόμα στο τερματικό
  const raw = session as Prisma.InputJsonObject;
  if (session.success === true) await completeSale(ctx.device.id, sale.id, raw, String(session.transactionId ?? ""));
  else await failSale(ctx.device.id, sale.id, `Η πληρωμή δεν ολοκληρώθηκε (eventId ${String(session.eventId)})`, raw);
}

export async function cancelPending(saleId: string) {
  const ctx = await currentContext();
  await failSale(ctx.device.id, id.parse(saleId), "Ακυρώθηκε από τον ταμία");
  revalidatePath("/pos");
}
