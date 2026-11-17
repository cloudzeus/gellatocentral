"use server";

import { needsLegalConsent, recordConsent, scopeOf } from "@/lib/gdpr";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { platformSettings, sendMail } from "@/lib/mail/send";
import { templates } from "@/lib/mail/templates";
import { hashPassword } from "@/lib/password";
import { createResetLink, hashResetToken } from "@/lib/reset";

export async function requestReset(form: FormData) {
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (email.success) {
    const user = await db.user.findUnique({ where: { email: email.data }, include: { memberships: { include: { org: true } } } });
    // το πολύ ένα email ανά 2 λεπτά ανά χρήστη, για να μη γίνεται η φόρμα μέσο ενόχλησης
    const recent = user && (await db.passwordReset.findFirst({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date(Date.now() + 58 * 60_000) } } }));
    if (user && !recent) {
      const org = user.memberships[0]?.org ?? null;
      const url = await createResetLink(user.id, 1, org);
      await sendMail({ to: user.email, template: "passwordReset", org, mail: templates.passwordReset(await platformSettings(), { name: user.name, url }) });
    }
  }
  // ίδια απάντηση είτε υπάρχει ο λογαριασμός είτε όχι
  redirect("/forgot?sent=1");
}

export async function resetPassword(form: FormData) {
  const d = z.object({ token: z.string().min(20).max(100), password: z.string().min(10).max(200) }).safeParse(Object.fromEntries(form));
  if (!d.success) redirect(`/reset?token=${encodeURIComponent(String(form.get("token") ?? ""))}&error=short`);
  const reset = await db.passwordReset.findUnique({ where: { tokenHash: hashResetToken(d.data.token) }, include: { user: { include: { memberships: true } } } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) redirect("/reset?error=expired");
  // πρώτη ενεργοποίηση ή νέα έκδοση όρων: χωρίς αποδοχή δεν ορίζεται κωδικός
  const mustAccept = await needsLegalConsent(reset.userId);
  if (mustAccept && form.get("accept") !== "on") redirect(`/reset?token=${encodeURIComponent(d.data.token)}&error=accept`);
  // η συνθήκη usedAt: null κάνει τον σύνδεσμο μίας χρήσης ακόμα και σε διπλό πάτημα
  const { count } = await db.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count === 0) redirect("/reset?error=expired");
  await db.$transaction([
    db.user.update({ where: { id: reset.userId }, data: { passwordHash: hashPassword(d.data.password), failedLogins: 0, lockedUntil: null } }),
    db.session.deleteMany({ where: { userId: reset.userId } }), // όλες οι συσκευές αποσυνδέονται
  ]);
  if (mustAccept) await recordConsent({ orgId: scopeOf(reset.user), subjectType: "user", subjectId: reset.userId, subjectLabel: `${reset.user.name} · ${reset.user.email}`, purpose: "legal", granted: true, source: "activation", actor: { id: reset.userId, name: reset.user.name } });
  redirect("/login?reset=1");
}
