"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { flashFail } from "@/lib/flash-server";
import { tenantWriteTransaction } from "@/lib/migration-cutover";
import { completeSale, failSale, issueSale } from "@/lib/pos";
import { currentContext, POS_DEVICE_COOKIE } from "@/lib/tenant";
import { redirect } from "next/navigation";
import { abortSession, startSale, vivaConfigured, VivaUnknownOutcomeError } from "@/lib/viva/cloud-terminal";
import { cancelBrowserPayment, syncBrowserPayment } from "@/lib/viva/browser-payment";

const id = z.string().cuid();

export async function addLine(productId: string) {
  const ctx = await currentContext();
  // το προϊόν πρέπει να ανήκει στην επιχείρηση του χρήστη
  const product = await db.product.findFirst({ where: { id: id.parse(productId), orgId: ctx.org.id, active: true }, include: { vatRate: true } });
  if (!product) return;
  // shortcut: το ταμείο του browser δεν έχει φύλλο επιλογών· προϊόν με υποχρεωτικές επιλογές πουλιέται από το ταμείο Android
  if (await db.productModifierGroup.findFirst({ where: { productId: product.id, group: { kind: "REQUIRED" } } }))
    return flashFail(`Το «${product.name}» θέλει επιλογές (π.χ. γεύσεις)`, "Πούλησέ το από το ταμείο της tablet.");
  await tenantWriteTransaction(ctx.org.id, async (tx) => {
    const where = { deviceId: ctx.device.id, status: "DRAFT" as const };
    const sale = (await tx.sale.findFirst({ where })) ?? (await tx.sale.create({ data: { orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id } }));
    // η γραμμή χωρίς επιλογές του προϊόντος· με επιλογές θα ήταν άλλη γραμμή
    const line = await tx.saleLine.findFirst({ where: { saleId: sale.id, productId: product.id, options: { equals: Prisma.DbNull }, note: null } });
    if (line) await tx.saleLine.update({ where: { id: line.id }, data: { quantity: { increment: 1 } } });
    else await tx.saleLine.create({ data: { saleId: sale.id, productId: product.id, name: product.name, quantity: 1, unitPriceCents: product.priceCents, vatRate: product.vatRate.rate } });
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

const CANCEL_ERROR: Record<string, string> = {
  aborting: "Η ακύρωση στάλθηκε στο τερματικό. Αν ο πελάτης έχει ήδη βάλει την κάρτα, ακύρωσε στο τερματικό",
  error: "Η Viva δεν απαντά. Η πληρωμή μένει σε αναμονή, δοκίμασε ξανά σε λίγο",
  rejected: "Η απάντηση της Viva δεν ταιριάζει με την πώληση. Επικοινώνησε με την υποστήριξη",
};

export async function cancelPending(saleId: string) {
  const ctx = await currentContext();
  const sale = await db.sale.findFirst({
    where: { id: id.parse(saleId), orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id, status: "AWAITING_PAYMENT" },
    select: { id: true, orgId: true, storeId: true, deviceId: true, totalCents: true, payment: { select: { amountCents: true, vivaSessionId: true } } },
  });
  if (!sale) return revalidatePath("/pos");
  // Πρώτα σταματά το τερματικό: αλλιώς ο πελάτης θα μπορούσε να πληρώσει μια πώληση που γύρισε σε πρόχειρο.
  const result = await cancelBrowserPayment({ ...sale, status: "AWAITING_PAYMENT" }, {
    orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id, terminalId: ctx.device.vivaTerminalId,
  }, {
    complete: (raw, transactionId) => completeSale(ctx.device.id, sale.id, raw, transactionId, ctx.org.id),
    fail: (reason, raw) => failSale(ctx.device.id, sale.id, reason, raw, ctx.org.id),
  }, abortSession);
  revalidatePath("/pos");
  if (result.status === "completed") redirect(`/pos?saved=${encodeURIComponent("Ο πελάτης είχε ήδη πληρώσει: η απόδειξη εκδόθηκε")}`);
  const error = CANCEL_ERROR[result.status];
  if (error) redirect(`/pos?error=${encodeURIComponent(error)}`);
}

/** Ποιο ταμείο του καταστήματος χρησιμοποιεί αυτός ο browser. Μόνο ταμεία στα οποία έχει πρόσβαση ο χρήστης. */
export async function chooseTill(form: FormData) {
  const id = z.string().cuid().parse(form.get("deviceId"));
  const { tills } = await currentContext();
  if (!tills.some((t) => t.id === id)) throw new Error("Το ταμείο δεν είναι διαθέσιμο για τον λογαριασμό σου.");
  (await cookies()).set(POS_DEVICE_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/pos");
}
