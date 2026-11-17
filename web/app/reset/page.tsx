import Link from "next/link";
import { AuthCard, Notice } from "@/components/auth-card";
import { btn, Field } from "@/components/ui";
import { db } from "@/lib/db";
import { hashResetToken } from "@/lib/reset";
import { resetPassword } from "../forgot/actions";
import { Submit } from "@/components/submit";

export const instant = false;

export default async function ResetPage({ searchParams }: PageProps<"/reset">) {
  const q = await searchParams;
  const token = typeof q.token === "string" ? q.token : "";
  // έλεγχος πριν δείξουμε τη φόρμα: ληγμένος ή χρησιμοποιημένος σύνδεσμος φαίνεται αμέσως
  const reset = token ? await db.passwordReset.findUnique({ where: { tokenHash: hashResetToken(token) } }) : null;
  const valid = !!reset && !reset.usedAt && reset.expiresAt > new Date();
  return (
    <AuthCard>
      <h1 className="text-xl">Νέος κωδικός</h1>
      {!valid ? (
        <>
          <Notice tone="error">Ο σύνδεσμος έληξε ή χρησιμοποιήθηκε ήδη</Notice>
          <Link href="/forgot" className={btn("default", "lg", "w-full")}>Ζήτησε νέο σύνδεσμο</Link>
        </>
      ) : (
        <form action={resetPassword} className="space-y-4">
          {q.error === "short" ? <Notice tone="error">Ο κωδικός θέλει τουλάχιστον 10 χαρακτήρες</Notice> : null}
          <input type="hidden" name="token" value={token} />
          <Field label="Νέος κωδικός" name="password" type="password" autoComplete="new-password" required minLength={10} hint="Τουλάχιστον 10 χαρακτήρες. Μετά την αλλαγή αποσυνδέονται όλες οι συσκευές σου." />
          <Submit className={btn("default", "lg", "w-full")}>Αποθήκευση κωδικού</Submit>
        </form>
      )}
    </AuthCard>
  );
}
