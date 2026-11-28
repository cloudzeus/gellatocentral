"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { tenantWriteTransaction } from "@/lib/migration-cutover";
import { setSoldOut } from "@/lib/bills";
import { completeSale, failSale, issueSale, PosError } from "@/lib/pos";
import { cartLines, priceCart } from "@/lib/pos-cart";
import { ModifierError } from "@/lib/pos-modifiers";
import { sendToTerminal } from "@/lib/pos-till";
import { currentContext, POS_DEVICE_COOKIE } from "@/lib/tenant";
import { redirect } from "next/navigation";
import { abortSession, vivaConfigured } from "@/lib/viva/cloud-terminal";
import { cancelBrowserPayment, syncBrowserPayment } from "@/lib/viva/browser-payment";

const id = z.string().cuid();

export type ChargeResult = { error: string } | { pending: string } | { paid: { saleId: string; series: string; aa: number; totalCents: number } };

/**
 * Είσπραξη του καλαθιού του browser. Ο browser στέλνει ΜΟΝΟ προϊόν, ποσότητα, επιλογές και σημείωση·
 * τιμές και ΦΠΑ τα βγάζει ο server από τον κατάλογο (ίδια λογική με το /api/pos/sales του Android).
 */
export async function charge(lines: unknown, methodId: string): Promise<ChargeResult> {
  // τα id των seeded τρόπων είναι σταθερά («pm_cash»…), όχι cuid — γι' αυτό γενικός έλεγχος
  z.string().min(1).max(40).parse(methodId);
  const ctx = await currentContext();
  const live = await vivaConfigured();
  if (live && !(ctx.issuer.vivaMerchantId && ctx.device.vivaTerminalId))
    return { error: "Αυτό το ταμείο δεν έχει τερματικό Viva. Διάλεξε άλλο ταμείο ή όρισέ του τερματικό στο Συσκευές" };
  const parsed = cartLines.safeParse(lines);
  if (!parsed.success) return { error: "Η πώληση δεν διαβάστηκε. Ανανέωσε τη σελίδα και δοκίμασε ξανά" };
  let priced;
  try {
    priced = await priceCart(ctx.org.id, parsed.data);
  } catch (e) {
    if (e instanceof ModifierError) return { error: e.message };
    throw e;
  }
  if (!priced) return { error: "Κάποιο προϊόν δεν υπάρχει πια στον κατάλογο. Ανανέωσε τη σελίδα" };

  let started;
  try {
    const sale = await tenantWriteTransaction(ctx.org.id, async (tx) => {
      await tx.sale.deleteMany({ where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "DRAFT" } });
      return tx.sale.create({ data: { orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id, lines: { create: priced.map(({ seat: _seat, ...l }) => l) } } });
    });
    started = await issueSale(ctx, sale.id, methodId, live);
  } catch (e) {
    if (e instanceof PosError) return { error: e.message };
    throw e;
  }
  if (!started) return { error: "Η πώληση είναι άδεια" };
  revalidatePath("/pos");
  if (!live) {
    // δοκιμαστική λειτουργία: η πώληση ολοκληρώθηκε ήδη, χωρίς τερματικό
    const done = await db.sale.findUniqueOrThrow({ where: { id: started.saleId }, select: { series: true, aa: true } });
    return { paid: { saleId: started.saleId, series: done.series ?? "", aa: done.aa ?? 0, totalCents: started.receipt.totalCents } };
  }
  // Άγνωστο αποτέλεσμα στο τερματικό = μένει «περιμένει πληρωμή» (sendToTerminal)· αλλιώς ένα δεύτερο «Είσπραξη» θα χρέωνε δύο φορές.
  const failed = await sendToTerminal(ctx, started);
  if (failed) return { error: ((await failed.json()) as { message?: string }).message ?? "Η χρέωση δεν έφτασε στο τερματικό" };
  return { pending: started.saleId };
}

/** «Τελείωσε» / «Υπάρχει ξανά» για ένα προϊόν του καταστήματος. Επιστρέφει όσα έχουν τελειώσει. */
export async function toggleSoldOut(itemId: string, out: boolean) {
  const ctx = await currentContext();
  return setSoldOut(ctx, id.parse(itemId), out, ctx.user.name);
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
