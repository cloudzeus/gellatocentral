import { CircleAlert, CircleCheck } from "lucide-react";
import { requirePlatform } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Badge, btn, Card, Field, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/mail/send";
import { samples, TEMPLATE_LABEL } from "@/lib/mail/templates";
import { filterParam, listParams } from "@/lib/paging";
import { Connections } from "@/components/connections";
import { saveLegalSettings, savePlatformSettings } from "../actions";
import { Submit } from "@/components/submit";

const STATUS = { SENT: { tone: "success", text: "Στάλθηκε" }, FAILED: { tone: "danger", text: "Απέτυχε" }, SKIPPED: { tone: "warning", text: "Δεν στάλθηκε" } } as const;

export default async function PlatformSettingsPage({ searchParams }: PageProps<"/platform/settings">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const list = listParams(q, 15, ["to", "when"]);
  const status = filterParam(q, "status", ["SENT", "FAILED", "SKIPPED"]);
  const where = {
    ...(list.q ? { OR: [{ to: { contains: list.q, mode: "insensitive" as const } }, { subject: { contains: list.q, mode: "insensitive" as const } }] } : {}),
    ...(status ? { status } : {}),
  };
  
  const [settings, log, total] = await Promise.all([
    platformSettings(),
    db.emailLog.findMany({ where, orderBy: list.sort === "to" ? { to: list.dir } : { createdAt: list.sort === "when" ? list.dir : "desc" }, skip: list.skip, take: list.take, include: { org: true } }),
    db.emailLog.count({ where }),
  ]);
  const previews = Object.entries(samples(settings)) as [keyof typeof TEMPLATE_LABEL, ReturnType<typeof samples>["test"]][];

  return (
    <Page section="Ρυθμίσεις πλατφόρμας" title="Ρυθμίσεις & email" description="Όλες οι συνδέσεις και τα στοιχεία της πλατφόρμας σε ένα σημείο. Ισχύουν για όλους τους πελάτες">
      <div className="max-w-7xl space-y-4">
        {q.error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{String(q.error)}</p> : null}

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <h2 className="min-w-0 flex-1 text-lg">Στοιχεία πλατφόρμας {q.saved ? <span role="status" className="ml-2 text-sm font-semibold text-success">Αποθηκεύτηκε</span> : null}</h2>
            <Modal label="Αλλαγή" title="Στοιχεία πλατφόρμας">
              <form key={[settings.brandName, settings.baseDomain, settings.supportEmail].join()} action={savePlatformSettings} className="grid gap-4 [&>button]:justify-self-end">
                <Field label="Όνομα πλατφόρμας" name="brandName" required minLength={2} maxLength={60} defaultValue={settings.brandName} hint="Στην κεφαλίδα κάθε email και στον αποστολέα" />
                <Field label="Βασικός τομέας" name="baseDomain" maxLength={80} defaultValue={settings.baseDomain ?? ""} placeholder="gelatosystem.app" hint="Κάθε πελάτης παίρνει υποτομέας.αυτό" />
                <Field label="Email υποστήριξης" name="supportEmail" type="email" maxLength={120} defaultValue={settings.supportEmail ?? ""} hint="Στο κάτω μέρος κάθε email" />
                <Submit className={btn("default")}>Αποθήκευση</Submit>
              </form>
            </Modal>
          </div>
          <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-3">
            {[["Όνομα πλατφόρμας", settings.brandName], ["Βασικός τομέας", settings.baseDomain], ["Email υποστήριξης", settings.supportEmail]].map(([l, v]) => (
              <div key={l} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{l}</dt><dd className="truncate font-semibold">{v ?? <span className="font-normal text-muted-foreground">Δεν έχει οριστεί</span>}</dd></div>
            ))}
          </dl>
        </Card>

        <Connections q={q} />

        <Card id="legal" className="scroll-mt-28">
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            {settings.legalVersion && settings.termsUrl && settings.privacyUrl ? <CircleCheck className="size-6 shrink-0 text-success" /> : <CircleAlert className="size-6 shrink-0 text-gold" />}
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Νομικά κείμενα και αποδοχή όρων {q.saved === "legal" ? <span role="status" className="ml-2 text-sm font-semibold text-success">Αποθηκεύτηκε</span> : null}</h2>
              <p className="text-sm text-muted-foreground">{settings.legalVersion && settings.termsUrl && settings.privacyUrl ? `Κάθε χρήστης αποδέχεται την έκδοση ${settings.legalVersion} πριν μπει στην εφαρμογή. Αν αλλάξεις έκδοση, θα τη ζητήσει ξανά από όλους.` : "Όσο λείπει κάποιο από τα τρία, η εφαρμογή δεν ζητά αποδοχή όρων από κανέναν."}</p>
            </div>
            <Modal label="Αλλαγή" title="Νομικά κείμενα" description="Τα κείμενα τα γράφει ο νομικός σου και αναρτώνται στον ιστότοπό σου. Εδώ μπαίνουν μόνο οι διευθύνσεις τους">
              <form key={[settings.legalVersion, settings.termsUrl, settings.privacyUrl].join()} action={saveLegalSettings} className="grid gap-4 [&>button]:justify-self-end">
                <Field label="Έκδοση" name="legalVersion" maxLength={20} defaultValue={settings.legalVersion ?? ""} placeholder="2026-11" hint="Άλλαξέ την μόνο όταν αλλάζει το περιεχόμενο: όλοι οι χρήστες θα κληθούν να αποδεχτούν ξανά" />
                <Field label="Όροι χρήσης (διεύθυνση)" name="termsUrl" type="url" maxLength={300} defaultValue={settings.termsUrl ?? ""} placeholder="https://gelatosystem.app/terms" />
                <Field label="Πολιτική απορρήτου (διεύθυνση)" name="privacyUrl" type="url" maxLength={300} defaultValue={settings.privacyUrl ?? ""} placeholder="https://gelatosystem.app/privacy" />
                <Submit className={btn("default")}>Αποθήκευση</Submit>
              </form>
            </Modal>
          </div>
          <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-3">
            {[["Έκδοση", settings.legalVersion], ["Όροι χρήσης", settings.termsUrl], ["Πολιτική απορρήτου", settings.privacyUrl]].map(([l, v]) => (
              <div key={l} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{l}</dt><dd className="truncate font-semibold">{v ?? <span className="font-normal text-muted-foreground">Δεν έχει οριστεί</span>}</dd></div>
            ))}
          </dl>
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Τα email που στέλνει η πλατφόρμα</h2>
            <p className="text-sm text-muted-foreground">Όπως θα τα δει ο παραλήπτης, με δείγμα δεδομένων. Άνοιξε ένα για να το δεις.</p>
          </div>
          {previews.map(([key, m], i) => (
            <details key={key} open={i === 0} className="border-b border-border/70 last:border-0">
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-3 px-5 py-3 hover:bg-secondary [&::-webkit-details-marker]:hidden">
                <span className="font-semibold">{TEMPLATE_LABEL[key]}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Θέμα: {m.subject}</span>
              </summary>
              {/* sandbox χωρίς δικαιώματα: το δείγμα δεν τρέχει scripts και δεν ανοίγει συνδέσμους */}
              <iframe title={TEMPLATE_LABEL[key]} srcDoc={m.html} sandbox="" loading="lazy" className="h-[34rem] w-full border-t border-border/70 bg-background" />
            </details>
          ))}
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Τελευταία email</h2></div>
          <DataTable
            id="email-log"
            listing={{ ...list, total, placeholder: "Παραλήπτης ή θέμα", filters: [{ key: "status", label: "Κατάσταση", value: status, options: Object.entries(STATUS).map(([k, v]): [string, string] => [k, v.text]) }] }}
            empty="Δεν έχει σταλεί κανένα email ακόμα"
            columns={[
              { key: "to", label: "Προς", required: true, sortable: true },
              { key: "when", label: "Πότε", sortable: true },
              { key: "template", label: "Email" },
              { key: "subject", label: "Θέμα" },
              { key: "org", label: "Πελάτης" },
              { key: "status", label: "Κατάσταση" },
            ]}
            rows={log.map((l) => ({
              id: l.id,
              cells: {
                to: <span className="font-medium">{l.to}</span>,
                when: l.createdAt.toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" }),
                template: TEMPLATE_LABEL[l.template as keyof typeof TEMPLATE_LABEL] ?? l.template,
                subject: l.subject,
                org: l.org?.name ?? "Πλατφόρμα",
                status: <><Badge tone={STATUS[l.status].tone}>{STATUS[l.status].text}</Badge>{l.error ? <span className="mt-1 block text-xs text-destructive">{l.error}</span> : null}</>,
              },
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
