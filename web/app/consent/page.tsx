import { redirect } from "next/navigation";
import { AuthCard, Notice } from "@/components/auth-card";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Submit } from "@/components/submit";
import { btn } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { needsLegalConsent } from "@/lib/gdpr";
import { platformSettings } from "@/lib/mail/send";
import { acceptLegal, logoutAfterDecline } from "../(app)/gdpr/actions";

export const instant = false;

// Αποδοχή όρων: εμφανίζεται στην πρώτη είσοδο και κάθε φορά που αλλάζει η έκδοση των νομικών κειμένων.
export default async function ConsentPage({ searchParams }: PageProps<"/consent">) {
  const user = await requireUser();
  if (!(await needsLegalConsent(user.id))) redirect("/");
  const s = await platformSettings();
  return (
    <AuthCard>
      <h1 className="text-xl">Όροι χρήσης και απόρρητο</h1>
      <p className="text-muted-foreground">Για να συνεχίσεις, διάβασε και αποδέξου τα κείμενα (έκδοση {s.legalVersion}).</p>
      {(await searchParams).error ? <Notice tone="error">Τσέκαρε το κουτί για να συνεχίσεις</Notice> : null}
      <ul className="space-y-2">
        <li><a href={s.termsUrl!} target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-2">Όροι χρήσης</a></li>
        <li><a href={s.privacyUrl!} target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-2">Πολιτική απορρήτου</a></li>
      </ul>
      <form action={acceptLegal} className="space-y-4">
        <label className="flex items-start gap-3 text-sm font-medium"><Checkbox name="accept" required className="mt-0.5" /> Διάβασα και αποδέχομαι τους όρους χρήσης και την πολιτική απορρήτου</label>
        <Submit className={btn("default", "lg", "w-full")}>Αποδοχή και συνέχεια</Submit>
      </form>
      <form action={logoutAfterDecline}><Submit className={btn("ghost", "default", "w-full")}>Δεν αποδέχομαι · Έξοδος</Submit></form>
    </AuthCard>
  );
}
