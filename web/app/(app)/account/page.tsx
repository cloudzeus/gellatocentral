import { LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page } from "@/components/ui";
import { deviceLabel } from "@/lib/access";
import { currentTokenHash, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PLATFORM_ROLES } from "@/lib/permissions";
import { changePassword, saveName, signOutOthers } from "./actions";

const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });
const SAVED: Record<string, string> = { name: "Το όνομα άλλαξε", password: "Ο κωδικός άλλαξε. Οι άλλες συσκευές αποσυνδέθηκαν", sessions: "Οι άλλες συσκευές αποσυνδέθηκαν" };

// Κάθε χρήστης για τον δικό του λογαριασμό: όνομα, κωδικός, από πού είναι συνδεδεμένος.
export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser();
  const q = await searchParams;
  const [sessions, here] = await Promise.all([db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }), currentTokenHash()]);
  const m = user.memberships[0];
  const others = sessions.filter((s) => s.tokenHash !== here).length;

  return (
    <Page section="Προφίλ" title="Ο λογαριασμός μου" description={`${user.email} · ${m ? `${m.role.name} · ${m.org.name}` : user.platformRole ? PLATFORM_ROLES[user.platformRole].label : ""}`}>
      <div className="max-w-4xl space-y-4">
        {typeof q.saved === "string" && SAVED[q.saved] ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">{SAVED[q.saved]}</p> : null}
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε: {q.error.slice(0, 200)}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Στοιχεία</h2></div>
            <form action={saveName} className="grid gap-4 p-5 [&>button]:justify-self-end">
              <Field label="Ονοματεπώνυμο" name="name" required minLength={2} maxLength={60} defaultValue={user.name} autoComplete="name" />
              <p className="text-sm text-muted-foreground">Το email ({user.email}) είναι το όνομα σύνδεσής σου και δεν αλλάζει από εδώ</p>
              <Submit className={btn("outline")}>Αποθήκευση</Submit>
            </form>
          </Card>

          <Card>
            <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Κωδικός</h2></div>
            <form action={changePassword} className="grid gap-4 p-5 [&>button]:justify-self-end">
              <Field label="Τωρινός κωδικός" name="current" type="password" required autoComplete="current-password" />
              <Field label="Νέος κωδικός" name="next" type="password" required minLength={10} maxLength={200} autoComplete="new-password" hint="Τουλάχιστον 10 χαρακτήρες. Με την αλλαγή αποσυνδέονται οι άλλες συσκευές" />
              <Submit className={btn("default")}>Αλλαγή κωδικού</Submit>
            </form>
          </Card>
        </div>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 basis-64 flex-1">
              <h2 className="text-lg">Συνδέσεις</h2>
              <p className="text-sm text-muted-foreground">{others ? `Είσαι συνδεδεμένος και σε ${others} ${others === 1 ? "άλλη συσκευή" : "άλλες συσκευές"}. Αν δεν τις αναγνωρίζεις, αποσύνδεσέ τες και άλλαξε κωδικό` : "Είσαι συνδεδεμένος μόνο από αυτή τη συσκευή"}</p>
            </div>
            {others ? <form action={signOutOthers}><Submit className={btn("outline")}><LogOut /> Αποσύνδεση από τις άλλες</Submit></form> : null}
          </div>
          <ul className="divide-y divide-border/70">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <MonitorSmartphone className="size-4 text-muted-foreground" aria-hidden />
                <p className="min-w-0 flex-1"><span className="font-semibold">{deviceLabel(s.userAgent)}</span><span className="block text-xs text-muted-foreground">Σύνδεση: {when.format(s.createdAt)}</span></p>
                {s.tokenHash === here ? <Badge tone="success">Αυτή η συσκευή</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>

        <Link href="/my-data" className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 hover:bg-secondary">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1"><span className="font-semibold">Τα δεδομένα μου</span><span className="block text-sm text-muted-foreground">Τι προσωπικά στοιχεία κρατάμε, οι συναινέσεις σου, αντίγραφο και διαγραφή</span></span>
        </Link>
      </div>
    </Page>
  );
}
