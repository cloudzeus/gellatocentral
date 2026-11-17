"use server";

import { redirect } from "next/navigation";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkoutConfigured, createOrder, withVat } from "@/lib/viva/checkout";

/** Στέλνει τον πελάτη στη σελίδα πληρωμής της Viva για μια ανεξόφλητη χρέωση της ΔΙΚΗΣ του επιχείρησης. */
export async function payCharge(chargeId: string) {
  const { org, user } = await currentOrg("billing.view");
  const charge = await db.subscriptionCharge.findFirst({ where: { id: chargeId, paidAt: null, subscription: { orgId: org.id } } });
  if (!charge) redirect("/billing");
  if (!checkoutConfigured()) redirect(`/billing?error=${encodeURIComponent("Η πληρωμή με κάρτα δεν είναι ακόμα διαθέσιμη. Επικοινώνησε μαζί μας.")}`);
  let url: string;
  try {
    const order = await createOrder({
      amountCents: withVat(charge.amountCents),
      description: `Συνδρομή ${org.name} ${charge.periodStart.toLocaleDateString("el-GR")} – ${charge.periodEnd.toLocaleDateString("el-GR")}`,
      email: user.email,
      fullName: user.name,
      reference: charge.id,
    });
    // ο κωδικός εντολής δένει την πληρωμή με τη χρέωση: στην επιστροφή ψάχνουμε με αυτόν, όχι με ό,τι λέει το URL
    await db.subscriptionCharge.update({ where: { id: charge.id }, data: { vivaOrderCode: order.orderCode } });
    url = order.url;
  } catch {
    redirect(`/billing?error=${encodeURIComponent("Η Viva δεν απάντησε. Δοκίμασε ξανά σε λίγο.")}`);
  }
  redirect(url);
}
