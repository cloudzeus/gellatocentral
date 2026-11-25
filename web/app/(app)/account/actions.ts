"use server";
// Ο λογαριασμός του ίδιου του χρήστη: όνομα, κωδικός και οι συνδέσεις του. Κάθε action δουλεύει μόνο για όποιον είναι συνδεδεμένος.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logAccess } from "@/lib/access-log";
import { currentTokenHash, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

const fail = (message: string): never => redirect(`/account?error=${encodeURIComponent(message)}`);
const done = (what: string): never => {
  revalidatePath("/account");
  redirect(`/account?saved=${what}`);
};

export async function saveName(form: FormData) {
  const user = await requireUser();
  const d = z.string().trim().min(2).max(60).safeParse(form.get("name"));
  if (!d.success) return fail("Το όνομα θέλει από 2 έως 60 χαρακτήρες");
  await db.user.update({ where: { id: user.id }, data: { name: d.data } });
  revalidatePath("/", "layout"); // το όνομα φαίνεται και στο μενού
  done("name");
}

export async function changePassword(form: FormData) {
  const user = await requireUser();
  const d = z.object({ current: z.string().min(1).max(200), next: z.string().min(10).max(200) }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail("Ο νέος κωδικός θέλει τουλάχιστον 10 χαρακτήρες");
  if (!(await verifyPassword(d.data.current, user.passwordHash))) return fail("Ο τωρινός κωδικός δεν είναι σωστός");
  if (d.data.current === d.data.next) return fail("Ο νέος κωδικός είναι ίδιος με τον τωρινό");
  const here = await currentTokenHash();
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(d.data.next) } }),
    db.session.deleteMany({ where: { userId: user.id, tokenHash: { not: here ?? "" } } }), // οι άλλες συσκευές αποσυνδέονται
  ]);
  await logAccess({ orgId: user.memberships[0]?.orgId ?? null, actorName: user.name, action: "user.password", target: user.name });
  done("password");
}

export async function signOutOthers() {
  const user = await requireUser();
  await db.session.deleteMany({ where: { userId: user.id, tokenHash: { not: (await currentTokenHash()) ?? "" } } });
  done("sessions");
}
