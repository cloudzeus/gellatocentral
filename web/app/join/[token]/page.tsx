import { AuthCard, Notice } from "@/components/auth-card";
import { ExpiredLink } from "@/components/state-screen";
import { Submit } from "@/components/submit";
import { btn, Field } from "@/components/ui";
import { inviteInfo } from "@/lib/staff-db";
import { join } from "./actions";

// Το περιεχόμενο εξαρτάται από το προσωπικό token.
export const instant = false;

export default async function JoinPage({ params, searchParams }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const q = await searchParams;
  const invite = await inviteInfo(token);
  if (!invite) return <ExpiredLink title="Το link εγγραφής δεν ισχύει πια" />;
  return (
    <AuthCard>
      <form action={join.bind(null, token)} className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">{invite.orgName}</p>
          <h1 className="text-xl">Καλώς ήρθες, {invite.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Φτιάξε τον λογαριασμό σου για να βλέπεις τις βάρδιες σου σε όλα τα καταστήματα. Στη συσκευή του καταστήματος μπαίνεις με το PIN σου, όχι με αυτόν τον κωδικό.</p>
        </div>
        {typeof q.error === "string" ? <Notice tone="error">{q.error}</Notice> : null}
        <Field label="Email" name="email" type="email" autoComplete="username" defaultValue={invite.email ?? ""} required />
        <Field label="Κινητό (προαιρετικό)" name="phone" type="tel" autoComplete="tel" defaultValue={invite.phone ?? ""} />
        <Field label="Κωδικός (τουλάχιστον 10 χαρακτήρες)" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <Field label="Ξανά ο κωδικός" name="password2" type="password" autoComplete="new-password" minLength={10} required />
        <Submit className={btn("default", "lg", "w-full")}>Δημιουργία λογαριασμού</Submit>
        <p className="text-xs text-muted-foreground">Το link ισχύει έως {invite.expiresAt.toLocaleDateString("el-GR")} και χρησιμοποιείται μία φορά.</p>
      </form>
    </AuthCard>
  );
}
