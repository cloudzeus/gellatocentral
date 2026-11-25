// Ημερήσιος έλεγχος συνδρομών: υπενθύμιση 3 ημέρες πριν λήξει η δοκιμή και ειδοποίηση όταν λήξει η συνδρομή.
// Καλείται από εξωτερικό χρονοδιακόπτη (π.χ. cron του Coolify) με `Authorization: Bearer $CRON_SECRET`.
import { DAYS_TO_CLOSE } from "@/lib/support/rules";
import { setting } from "@/lib/config";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { billingRecipients, platformSettings, sendMail } from "@/lib/mail/send";
import { templates } from "@/lib/mail/templates";
import { billableStores, planOf } from "@/lib/plan-data";
import { monthlyPreview } from "@/lib/plans";

export async function POST(req: Request) {
  const secret = await setting("CRON_SECRET");
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (secret.length < 20 || Buffer.byteLength(given) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(given), Buffer.from(secret)))
    return Response.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  // λυμένα αιτήματα χωρίς απάντηση για 5 ημέρες κλείνουν
  await db.ticket.updateMany({ where: { status: "RESOLVED", resolvedAt: { lt: new Date(now.getTime() - DAYS_TO_CLOSE * 864e5) } }, data: { status: "CLOSED" } });
  const brand = await platformSettings();
  const result = { trialEnding: 0, expired: 0, failed: 0 };

  const ending = await db.subscription.findMany({ where: { status: "TRIALING", currentPeriodEnd: { gt: now, lt: new Date(now.getTime() + 3 * 864e5) } } });
  for (const sub of ending) {
    try {
      const { org, to } = await billingRecipients(sub.orgId);
      if (!org) continue;
      const monthly = monthlyPreview(await planOf(org.id), (await billableStores(org.id)).map((x) => ({ ...x, paused: !!x.paused }))).totalCents;
      const mail = templates.trialEnding(brand, { orgName: org.name, endsAt: sub.currentPeriodEnd, daysLeft: Math.max(1, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / 864e5)), monthlyCents: monthly });
      // dedupeKey: μία υπενθύμιση ανά παραλήπτη και περίοδο, όσες φορές κι αν τρέξει το cron
      for (const address of to) if ((await sendMail({ to: address, template: "trialEnding", org, mail, dedupeKey: `trialEnding:${sub.id}:${sub.currentPeriodEnd.toISOString()}:${address}` })) === "SENT") result.trialEnding++;
    } catch (e) {
      result.failed++;
      console.error("cron/subscriptions: υπενθύμιση δοκιμής", sub.id, e instanceof Error ? e.message : e);
    }
  }

  const expired = await db.subscription.findMany({ where: { status: { in: ["TRIALING", "ACTIVE"] }, currentPeriodEnd: { lt: now } } });
  for (const sub of expired) {
    // Ένα σφάλμα σε μία επιχείρηση δεν σταματά τις επόμενες.
    try {
      // Με συνθήκη: αν μπήκε πληρωμή από τη στιγμή της λίστας, η συνδρομή μένει ενεργή.
      const { count } = await db.subscription.updateMany({ where: { id: sub.id, status: { in: ["TRIALING", "ACTIVE"] }, currentPeriodEnd: { lt: now } }, data: { status: "PAST_DUE" } });
      if (!count) continue;
      const { org, to } = await billingRecipients(sub.orgId);
      if (!org) continue;
      const mail = templates.subscriptionExpired(brand, { orgName: org.name, endedAt: sub.currentPeriodEnd });
      for (const address of to) if ((await sendMail({ to: address, template: "subscriptionExpired", org, mail, dedupeKey: `expired:${sub.id}:${sub.currentPeriodEnd.toISOString()}:${address}` })) === "SENT") result.expired++;
    } catch (e) {
      result.failed++;
      console.error("cron/subscriptions: λήξη συνδρομής", sub.id, e instanceof Error ? e.message : e);
    }
  }
  return Response.json(result);
}
