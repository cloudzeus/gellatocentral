import { Download, Trash2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { ProcessFlow } from "@/components/process-flow";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { activeVersion, consentsOf } from "@/lib/gdpr";
import { currentConsents, daysLeft, DUE_DAYS, PURPOSES, type Purpose } from "@/lib/gdpr/rules";
import { platformSettings } from "@/lib/mail/send";
import { PLATFORM_ROLES } from "@/lib/permissions";
import { requestMyErasure, setMyConsent } from "../gdpr/actions";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "long", timeZone: "Europe/Athens" });

// Κάθε χρήστης, για τα δικά του προσωπικά δεδομένα: τι κρατάμε, τι έχει αποδεχτεί, αντίγραφο και διαγραφή.
export default async function MyDataPage({ searchParams }: PageProps<"/my-data">) {
  const user = await requireUser();
  const q = await searchParams;
  const [rows, request, settings, legal] = await Promise.all([
    consentsOf("user", user.id),
    db.erasureRequest.findFirst({ where: { subjectType: "user", subjectId: user.id }, orderBy: { requestedAt: "desc" } }),
    platformSettings(),
    activeVersion("legal"),
  ]);
  const consents = currentConsents(rows);
  const accepted = consents.get("legal");
  const optional = (Object.keys(PURPOSES) as Purpose[]).filter((p) => PURPOSES[p].audience === "user" && !PURPOSES[p].required);
  const m = user.memberships[0];
  const facts: [string, string][] = [
    ["Ονοματεπώνυμο", user.name],
    ["Email", user.email],
    ["Λογαριασμός από", day.format(user.createdAt)],
    ["Ρόλος", m ? `${m.role.name} · ${m.org.name}` : user.platformRole ? PLATFORM_ROLES[user.platformRole].label : "—"],
  ];
  const pending = request?.status === "PENDING";

  return (
    <Page section="Ο λογαριασμός μου" title="Τα δεδομένα μου" description="Τι προσωπικά στοιχεία κρατάμε για σένα, τι έχεις αποδεχτεί και πώς τα παίρνεις ή τα σβήνεις">
      <div className="max-w-4xl space-y-4">
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η επιλογή σου αποθηκεύτηκε</p> : null}
        {q.requested ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Το αίτημα διαγραφής καταχωρίστηκε. Θα έχεις απάντηση μέσα σε {DUE_DAYS} ημέρες</p> : null}
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{q.error === "confirm" ? "Τσέκαρε το κουτί επιβεβαίωσης για να σταλεί το αίτημα" : q.error.slice(0, 200)}</p> : null}

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Τι κρατάμε για σένα</h2><p className="text-sm text-muted-foreground">Μαζί με αυτά: το ιστορικό των email που σου στείλαμε και οι συναινέσεις σου</p></div>
            <a href="/api/my-data" download className={btn("outline")}><Download /> Λήψη αντιγράφου</a>
          </div>
          <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
            {facts.map(([l, v]) => <div key={l} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{l}</dt><dd className="truncate font-semibold">{v}</dd></div>)}
          </dl>
        </Card>

        <Card>
          <div className="border-b border-border px-5 py-4"><h2 className="text-lg">Συναινέσεις</h2><p className="text-sm text-muted-foreground">Ό,τι είναι προαιρετικό το αλλάζεις όποτε θέλεις. Κάθε αλλαγή καταγράφεται</p></div>
          <ul className="divide-y divide-border">
            <li className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{PURPOSES.legal.label}</p>
                <p className="text-sm text-muted-foreground">
                  {legal && settings.termsUrl && settings.privacyUrl ? <><a href={settings.termsUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">Όροι χρήσης</a> · <a href={settings.privacyUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">Πολιτική απορρήτου</a> · έκδοση {legal}</> : "Τα νομικά κείμενα δεν έχουν αναρτηθεί ακόμα"}
                </p>
              </div>
              {accepted?.granted ? <Badge tone={accepted.version === legal ? "success" : "warning"}>{accepted.version === legal ? `Αποδοχή ${day.format(accepted.at)}` : `Αποδοχή παλιάς έκδοσης ${accepted.version}`}</Badge> : <Badge tone="neutral">Δεν έχει ζητηθεί</Badge>}
            </li>
            {optional.map((p) => {
              const on = consents.get(p)?.granted === true;
              return (
                <li key={p} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1"><p className="font-medium">{PURPOSES[p].label}</p><p className="text-sm text-muted-foreground">{PURPOSES[p].hint}</p></div>
                  <Badge tone={on ? "success" : "neutral"}>{on ? `Ναι, από ${day.format(consents.get(p)!.at)}` : "Όχι"}</Badge>
                  <form action={setMyConsent.bind(null, p, !on)}><Submit className={btn("outline", "sm")}>{on ? "Ανάκληση" : "Συμφωνώ"}</Submit></form>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Διαγραφή των δεδομένων μου</h2><p className="text-sm text-muted-foreground">Σβήνεται ο λογαριασμός και τα προσωπικά σου στοιχεία. Δεν αναιρείται</p></div>
            {pending ? null : (
              <Modal label={<><Trash2 /> Ζητώ διαγραφή</>} variant="outline" title="Αίτημα διαγραφής" description={`Το εξετάζει ο υπεύθυνος και απαντά μέσα σε ${DUE_DAYS} ημέρες`}>
                <form action={requestMyErasure} className="grid gap-4 [&>button]:justify-self-end">
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>Δεν θα μπορείς πια να συνδεθείς</li>
                    <li>Σβήνονται όνομα, email, συνεδρίες και ό,τι αρχείο είναι δεμένο μαζί σου</li>
                    <li>Μένουν μόνο όσα επιβάλλει ο νόμος, χωρίς δικά σου στοιχεία (π.χ. οι αποδείξεις που εκδόθηκαν)</li>
                  </ul>
                  <Field label="Λόγος (προαιρετικά)" name="reason" maxLength={500} />
                  <label className="flex items-start gap-3 text-sm font-medium"><input type="checkbox" name="confirm" required className="mt-0.5 size-4 accent-[var(--primary)]" /> Κατάλαβα ότι η διαγραφή είναι οριστική</label>
                  <Submit className={btn("destructive")}>Αποστολή αιτήματος</Submit>
                </form>
              </Modal>
            )}
          </div>
          <div className="p-5">
            {request ? (
              <>
                <ProcessFlow label="Πορεία αιτήματος διαγραφής" steps={[
                  { id: "ask", label: "Αίτημα", state: "done", detail: day.format(request.requestedAt) },
                  { id: "review", label: "Εξέταση", state: pending ? "current" : request.status === "REJECTED" ? "failed" : "done", detail: pending ? (daysLeft(request.dueAt) >= 0 ? `Απάντηση σε ${daysLeft(request.dueAt)} ημ.` : "Η προθεσμία πέρασε") : request.status === "REJECTED" ? "Δεν έγινε δεκτό" : "Εγκρίθηκε" },
                  { id: "erase", label: "Διαγραφή", state: request.status === "COMPLETED" ? "done" : "todo", detail: request.status === "COMPLETED" && request.decidedAt ? day.format(request.decidedAt) : undefined },
                ]} />
                {request.status === "REJECTED" && request.decisionNote ? <p className="mt-3 rounded-lg bg-secondary px-4 py-3 text-sm"><span className="font-medium">Ο λόγος:</span> {request.decisionNote}. Αν διαφωνείς, μπορείς να απευθυνθείς στην Αρχή Προστασίας Δεδομένων (dpa.gr)</p> : null}
              </>
            ) : <p className="text-muted-foreground">Δεν έχεις κάνει αίτημα διαγραφής</p>}
          </div>
        </Card>
      </div>
    </Page>
  );
}
