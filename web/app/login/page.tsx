import Link from "next/link";
import { AuthCard, Notice } from "@/components/auth-card";
import { btn, Field } from "@/components/ui";
import { login } from "./actions";

// Η σελίδα διαβάζει το ?error του URL: δεν προ-αποδίδεται στατικά.
export const instant = false;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const q = await searchParams;
  return (
    <AuthCard>
      <form action={login} className="space-y-4">
        <h1 className="text-xl">Σύνδεση</h1>
        {q.error ? <Notice tone="error">Λάθος email ή κωδικός. Μετά από 5 λάθος προσπάθειες ο λογαριασμός κλειδώνει για 15 λεπτά.</Notice> : null}
        {q.reset ? <Notice tone="ok">Ο κωδικός άλλαξε. Μπες με τον νέο.</Notice> : null}
        <Field label="Email" name="email" type="email" autoComplete="username" required />
        <Field label="Κωδικός" name="password" type="password" autoComplete="current-password" required />
        <button className={btn("default", "lg", "w-full")}>Σύνδεση</button>
      </form>
      <Link href="/forgot" className="flex min-h-11 items-center justify-center text-sm font-semibold text-primary underline-offset-2 hover:underline">Ξέχασα τον κωδικό</Link>
    </AuthCard>
  );
}
