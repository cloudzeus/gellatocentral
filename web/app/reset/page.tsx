import Link from "next/link";
import { AuthCard, Notice } from "@/components/auth-card";
import { btn, Field } from "@/components/ui";
import { db } from "@/lib/db";
import { needsLegalConsent } from "@/lib/gdpr";
import { platformSettings } from "@/lib/mail/send";
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
  const mustAccept = valid && (await needsLegalConsent(reset.userId));
  const legal = mustAccept ? await platformSettings() : null;
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
          {q.error === "accept" ? <Notice tone="error">Για να συνεχίσεις χρειάζεται η αποδοχή των όρων</Notice> : null}
          <input type="hidden" name="token" value={token} />
          <Field label="Νέος κωδικός" name="password" type="password" autoComplete="new-password" required minLength={10} hint="Τουλάχιστον 10 χαρακτήρες. Μετά την αλλαγή αποσυνδέονται όλες οι συσκευές σου." />
          {legal ? (
            <label className="flex items-start gap-3 text-sm font-medium">
              <input type="checkbox" name="accept" required className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span>Διάβασα και αποδέχομαι τους <a href={legal.termsUrl!} target="_blank" rel="noreferrer" className="underline underline-offset-2">όρους χρήσης</a> και την <a href={legal.privacyUrl!} target="_blank" rel="noreferrer" className="underline underline-offset-2">πολιτική απορρήτου</a></span>
            </label>
          ) : null}
          <Submit className={btn("default", "lg", "w-full")}>Αποθήκευση κωδικού</Submit>
        </form>
      )}
    </AuthCard>
  );
}
