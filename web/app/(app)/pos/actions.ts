"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { tenantWriteTransaction } from "@/lib/migration-cutover";
import { completeSale, failSale, issueSale } from "@/lib/pos";
import { currentContext, POS_DEVICE_COOKIE } from "@/lib/tenant";
import { startSale, vivaConfigured, VivaUnknownOutcomeError } from "@/lib/viva/cloud-terminal";
import { syncBrowserPayment } from "@/lib/viva/browser-payment";

const id = z.string().cuid();

export async function addLine(productId: string) {
  const ctx = await currentContext();
  // το προϊόν πρέπει να ανήκει στην επιχείρηση του χρήστη
  const product = await db.product.findFirst({ where: { id: id.parse(productId), orgId: ctx.org.id, active: true }, include: { vatRate: true } });
  if (!product) return;
  await tenantWriteTransaction(ctx.org.id, async (tx) => {
    const where = { deviceId: ctx.device.id, status: "DRAFT" as const };
    const sale = (await tx.sale.findFirst({ where })) ?? (await tx.sale.create({ data: { orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id } }));
    await tx.saleLine.upsert({
      where: { saleId_productId: { saleId: sale.id, productId: product.id } },
      update: { quantity: { increment: 1 } },
      create: { saleId: sale.id, productId: product.id, name: product.name, quantity: 1, unitPriceCents: product.priceCents, vatRate: product.vatRate.rate },
    });
  });
  revalidatePath("/pos");
}

export async function changeQuantity(lineId: string, delta: 1 | -1) {
  const ctx = await currentContext();
  await tenantWriteTransaction(ctx.org.id, async (tx) => {
    const line = await tx.saleLine.findFirst({ where: { id: id.parse(lineId), sale: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "DRAFT" } } });
    if (!line) return;
    if (line.quantity + delta <= 0) await tx.saleLine.delete({ where: { id: line.id } });
    else await tx.saleLine.update({ where: { id: line.id }, data: { quantity: { increment: delta } } });
  });
  revalidatePath("/pos");
}

export async function clearSale() {
  const ctx = await currentContext();
  await tenantWriteTransaction(ctx.org.id, async (tx) => {
    await tx.saleLine.deleteMany({ where: { sale: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "DRAFT" } } });
  });
  revalidatePath("/pos");
}

export async function pay(methodId: string) {
  // τα id των seeded τρόπων είναι σταθερά («pm_cash»…), όχι cuid — γι' αυτό γενικός έλεγχος
  z.string().min(1).max(40).parse(methodId);
  const ctx = await currentContext();
  const live = await vivaConfigured();
  if (live && !(ctx.issuer.vivaMerchantId && ctx.device.vivaTerminalId))
    throw new Error("Λείπει ο κωδικός εμπόρου Viva ή το τερματικό της συσκευής.");
  const draft = await db.sale.findFirst({ where: { deviceId: ctx.device.id, status: "DRAFT" }, select: { id: true } });
  const started = draft && (await issueSale(ctx, draft.id, methodId, live));
  if (!started) return;

  if (live) {
    try {
      await startSale({
        sessionId: started.reference,
        terminalId: ctx.device.vivaTerminalId!,
        cashRegisterId: ctx.device.id,
        amountCents: started.receipt.totalCents,
        merchantReference: started.saleId,
        terminalMerchantId: ctx.issuer.vivaMerchantId!,
        fiscalisationData: started.receipt.data,
      });
    } catch (e) {
      // Άγνωστο αποτέλεσμα: η χρέωση μπορεί να έφτασε στο τερματικό. Η πώληση μένει «περιμένει πληρωμή» και το
      // ταμείο ρωτά τη Viva (syncPayment)· αν γύριζε σε πρόχειρο, το επόμενο «Πληρωμή» θα χρέωνε δεύτερη φορά.
      if (!(e instanceof VivaUnknownOutcomeError))
        await failSale(ctx.device.id, started.saleId, e instanceof Error ? e.message : String(e), undefined, ctx.org.id);
    }
  }
  revalidatePath("/pos");
}

/** Ρωτά τη Viva για την πληρωμή που περιμένει. Ασφαλές να κληθεί ξανά και ξανά. */
export async function syncPayment(saleId: string) {
  const ctx = await currentContext();
  const sale = await db.sale.findFirst({
    where: {
      id: saleId,
      orgId: ctx.org.id,
      storeId: ctx.store.id,
      deviceId: ctx.device.id,
      status: { in: ["AWAITING_PAYMENT", "COMPLETED"] },
    },
    select: {
      id: true, orgId: true, storeId: true, deviceId: true, status: true, totalCents: true,
      payment: { select: { amountCents: true, vivaSessionId: true } },
    },
  });
  if (!sale) return { status: "not_found" } as const;
  const status = sale.status;
  if (status !== "AWAITING_PAYMENT" && status !== "COMPLETED") return { status: "not_found" } as const;

  return syncBrowserPayment({ ...sale, status }, {
    orgId: ctx.org.id,
    storeId: ctx.store.id,
    deviceId: ctx.device.id,
    terminalId: ctx.device.vivaTerminalId,
  }, {
    complete: (raw, transactionId) => completeSale(ctx.device.id, sale.id, raw, transactionId, ctx.org.id),
    fail: (reason, raw) => failSale(ctx.device.id, sale.id, reason, raw, ctx.org.id),
  });
}

export async function cancelPending(saleId: string) {
  const ctx = await currentContext();
  await failSale(ctx.device.id, id.parse(saleId), "Ακυρώθηκε από τον ταμία", undefined, ctx.org.id);
  revalidatePath("/pos");
}

/** Ποιο ταμείο του καταστήματος χρησιμοποιεί αυτός ο browser. Μόνο ταμεία στα οποία έχει πρόσβαση ο χρήστης. */
export async function chooseTill(form: FormData) {
  const id = z.string().cuid().parse(form.get("deviceId"));
  const { tills } = await currentContext();
  if (!tills.some((t) => t.id === id)) throw new Error("Το ταμείο δεν είναι διαθέσιμο για τον λογαριασμό σου.");
  (await cookies()).set(POS_DEVICE_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/pos");
}
