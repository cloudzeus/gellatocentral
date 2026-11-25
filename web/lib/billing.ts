import { db } from "./db";
import { billingRecipients, platformSettings, sendMail } from "./mail/send";
import { templates } from "./mail/templates";

/**
 * Εξόφληση χρέωσης (χειροκίνητα από την κονσόλα ή με κάρτα μέσω Viva): η συνδρομή γίνεται ενεργή, παρατείνεται
 * ως το τέλος της περιόδου και φεύγει email επιβεβαίωσης. Αν κληθεί δύο φορές, η δεύτερη δεν κάνει τίποτα.
 */
export async function settleCharge(chargeId: string, vivaTransactionId?: string) {
  const charge = await db.subscriptionCharge.findUnique({ where: { id: chargeId }, include: { subscription: true } });
  if (!charge) return null;
  // Χρέωση και συνδρομή μαζί: αλλιώς μια αποτυχία στη μέση αφήνει πληρωμένη χρέωση με ληγμένη συνδρομή,
  // και η επανάληψη δεν τη διορθώνει γιατί βρίσκει τη χρέωση ήδη πληρωμένη.
  const count = await db.$transaction(async (tx) => {
    const { count } = await tx.subscriptionCharge.updateMany({ where: { id: charge.id, paidAt: null }, data: { paidAt: new Date(), vivaTransactionId } });
    if (count)
      await tx.subscription.update({
        where: { id: charge.subscriptionId },
        data: { status: "ACTIVE", currentPeriodEnd: charge.periodEnd > charge.subscription.currentPeriodEnd ? charge.periodEnd : undefined },
      });
    return count;
  });
  if (count) {
    const { org, to } = await billingRecipients(charge.subscription.orgId);
    const mail = templates.paymentReceived(await platformSettings(), { orgName: org!.name, ...charge });
    for (const address of to) await sendMail({ to: address, template: "paymentReceived", org, mail });
  }
  return charge;
}
