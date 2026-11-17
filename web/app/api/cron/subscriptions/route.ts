// Ημερήσιος έλεγχος συνδρομών: υπενθύμιση 3 ημέρες πριν λήξει η δοκιμή και ειδοποίηση όταν λήξει η συνδρομή.
// Καλείται από εξωτερικό χρονοδιακόπτη (π.χ. cron του Coolify) με `Authorization: Bearer $CRON_SECRET`.
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { billingRecipients, platformSettings, sendMail } from "@/lib/mail/send";
import { templates } from "@/lib/mail/templates";
import { BILLABLE_KINDS, monthlyCharge } from "@/lib/pricing";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (secret.length < 20 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret)))
    return Response.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const brand = await platformSettings();
  const result = { trialEnding: 0, expired: 0 };

  const ending = await db.subscription.findMany({ where: { status: "TRIALING", currentPeriodEnd: { gt: now, lt: new Date(now.getTime() + 3 * 864e5) } } });
  for (const sub of ending) {
    const { org, to } = await billingRecipients(sub.orgId);
    if (!org) continue;
    const [stores, devices] = await Promise.all([db.store.count({ where: { orgId: org.id, active: true } }), db.device.count({ where: { orgId: org.id, active: true, kind: { in: [...BILLABLE_KINDS] } } })]);
    const mail = templates.trialEnding(brand, { orgName: org.name, endsAt: sub.currentPeriodEnd, daysLeft: Math.max(1, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / 864e5)), monthlyCents: monthlyCharge(stores, devices).totalCents });
    // dedupeKey: μία υπενθύμιση ανά παραλήπτη και περίοδο, όσες φορές κι αν τρέξει το cron
    for (const address of to) if ((await sendMail({ to: address, template: "trialEnding", org, mail, dedupeKey: `trialEnding:${sub.id}:${sub.currentPeriodEnd.toISOString()}:${address}` })) === "SENT") result.trialEnding++;
  }

  const expired = await db.subscription.findMany({ where: { status: { in: ["TRIALING", "ACTIVE"] }, currentPeriodEnd: { lt: now } } });
  for (const sub of expired) {
    await db.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
    const { org, to } = await billingRecipients(sub.orgId);
    if (!org) continue;
    const mail = templates.subscriptionExpired(brand, { orgName: org.name, endedAt: sub.currentPeriodEnd });
    for (const address of to) if ((await sendMail({ to: address, template: "subscriptionExpired", org, mail, dedupeKey: `expired:${sub.id}:${sub.currentPeriodEnd.toISOString()}:${address}` })) === "SENT") result.expired++;
  }
  return Response.json(result);
}
