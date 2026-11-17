"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, startSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";

const fail = () => redirect("/login?error=1");

export async function login(form: FormData) {
  const d = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail();
  const user = await db.user.findUnique({ where: { email: d.data.email }, include: { memberships: true } });
  // ίδιο μήνυμα για άγνωστο email, λάθος κωδικό, κλειδωμένο και απενεργοποιημένο λογαριασμό
  if (!user || user.disabledAt || (user.lockedUntil && user.lockedUntil > new Date())) return fail();
  if (!verifyPassword(d.data.password, user.passwordHash)) {
    const failed = user.failedLogins + 1;
    // 5 λάθος κωδικοί στη σειρά = κλείδωμα 15 λεπτών
    await db.user.update({ where: { id: user.id }, data: failed >= 5 ? { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) } : { failedLogins: failed } });
    return fail();
  }
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  await startSession(user.id);
  redirect(user.platformRole ? "/platform" : "/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
