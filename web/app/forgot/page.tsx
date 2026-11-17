import Link from "next/link";
import { AuthCard, Notice } from "@/components/auth-card";
import { btn, Field } from "@/components/ui";
import { requestReset } from "./actions";

export const instant = false;

export default async function ForgotPage({ searchParams }: PageProps<"/forgot">) {
  const sent = (await searchParams).sent;
  return (
    <AuthCard>
      <h1 className="text-xl">Ξέχασα τον κωδικό</h1>
      {sent ? (
        <Notice tone="ok">Αν υπάρχει λογαριασμός με αυτό το email, στείλαμε σύνδεσμο για νέο κωδικό. Ισχύει για 1 ώρα. Κοίταξε και στα ανεπιθύμητα.</Notice>
      ) : (
        <form action={requestReset} className="space-y-4">
          <p className="text-sm text-muted-foreground">Γράψε το email σου και θα σου στείλουμε σύνδεσμο για να ορίσεις νέο κωδικό.</p>
          <Field label="Email" name="email" type="email" autoComplete="username" required />
          <button className={btn("default", "lg", "w-full")}>Αποστολή συνδέσμου</button>
        </form>
      )}
      <Link href="/login" className="flex min-h-11 items-center justify-center text-sm font-semibold text-primary underline-offset-2 hover:underline">Πίσω στη σύνδεση</Link>
    </AuthCard>
  );
}
