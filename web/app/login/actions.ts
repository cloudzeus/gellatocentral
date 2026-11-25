"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, startSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";

const fail = () => redirect("/login?error=1");

export async function login(form: FormData) {
  const d = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail();
  // Όριο ανά διεύθυνση, πέρα από το κλείδωμα ανά λογαριασμό. Η διεύθυνση είναι γνωστή μόνο πίσω από έμπιστο proxy.
  const ip = process.env.TRUST_PROXY === "1" ? (await headers()).get("x-forwarded-for")?.split(",")[0].trim() : null;
  if (ip && rateLimited(`login:${ip}`, 30, 15 * 60_000)) return fail();
  const user = await db.user.findUnique({ where: { email: d.data.email }, include: { memberships: true } });
  // ίδιο μήνυμα για άγνωστο email, λάθος κωδικό, κλειδωμένο και απενεργοποιημένο λογαριασμό
  if (!user || user.disabledAt || (user.lockedUntil && user.lockedUntil > new Date())) return fail();
  if (!(await verifyPassword(d.data.password, user.passwordHash))) {
    // Ατομική αύξηση: με «διάβασε και γράψε», παράλληλες προσπάθειες έγραφαν όλες 1 και το κλείδωμα δεν ερχόταν ποτέ.
    const { failedLogins } = await db.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
    // 5 λάθος κωδικοί στη σειρά = κλείδωμα 15 λεπτών
    if (failedLogins >= 5) await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) } });
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
