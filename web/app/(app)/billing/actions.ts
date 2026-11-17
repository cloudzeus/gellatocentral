"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAccess } from "@/lib/access-log";
import { planOf } from "@/lib/plan-data";
import { pauseDaysLeft } from "@/lib/plans";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { withVat } from "@/lib/pricing";
import { checkoutConfigured, createOrder } from "@/lib/viva/checkout";

/** Στέλνει τον πελάτη στη σελίδα πληρωμής της Viva για μια ανεξόφλητη χρέωση της ΔΙΚΗΣ του επιχείρησης. */
export async function payCharge(chargeId: string) {
  const { org, user } = await currentOrg("billing.view");
  const charge = await db.subscriptionCharge.findFirst({ where: { id: chargeId, paidAt: null, subscription: { orgId: org.id } } });
  if (!charge) redirect("/billing");
  if (!(await checkoutConfigured())) redirect(`/billing?error=${encodeURIComponent("Η πληρωμή με κάρτα δεν είναι ακόμα διαθέσιμη. Επικοινώνησε μαζί μας.")}`);
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

const back = (q: string): never => {
  revalidatePath("/", "layout"); // η παύση αλλάζει και το μενού όσων δουλεύουν στο κατάστημα
  redirect(`/billing?${q}#stores`);
};

/** Εποχιακή παύση: το κατάστημα κλείνει (ταμείο και βασικές ενότητες) και πληρώνει το ποσοστό του πακέτου. */
export async function pauseStore(storeId: string) {
  const { org, user } = await currentOrg("stores.pause");
  const store = await db.store.findFirst({ where: { id: storeId, orgId: org.id, active: true }, include: { pauses: true } });
  if (!store) return back(`error=${encodeURIComponent("Άγνωστο κατάστημα")}`);
  if (store.pauses.some((p) => !p.endedAt)) return back("saved=paused");
  const plan = await planOf(org.id);
  const maxDays = pauseDaysLeft(plan.pauseMaxDaysPerYear, store.pauses, new Date());
  if (maxDays <= 0) return back(`error=${encodeURIComponent(`Το κατάστημα «${store.name}» έχει χρησιμοποιήσει και τις ${plan.pauseMaxDaysPerYear} ημέρες παύσης του τελευταίου 12μήνου`)}`);
  await db.storePause.create({ data: { orgId: org.id, storeId: store.id, maxDays, startedByName: user.name } });
  await logAccess({ orgId: org.id, actorName: user.name, action: "store.paused", target: store.name, detail: `Πληρώνει το ${plan.pausePercent}% αν κρατήσει 30+ ημέρες` });
  back("saved=paused");
}

/** Άνοιγμα ξανά: αμέσως, χωρίς έγκριση. Αν η παύση κράτησε κάτω από 30 ημέρες δεν δίνεται έκπτωση. */
export async function resumeStore(storeId: string) {
  const { org, user } = await currentOrg("stores.pause");
  const pause = await db.storePause.findFirst({ where: { storeId, orgId: org.id, endedAt: null }, include: { store: true } });
  if (!pause) return back("saved=resumed");
  await db.storePause.update({ where: { id: pause.id }, data: { endedAt: new Date(), endedByName: user.name } });
  await logAccess({ orgId: org.id, actorName: user.name, action: "store.resumed", target: pause.store.name });
  back("saved=resumed");
}
