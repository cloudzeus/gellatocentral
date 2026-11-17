import { CircleAlert, CircleCheck } from "lucide-react";
import { requirePlatform } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { mailConfigured, mailDomain, platformSettings } from "@/lib/mail/send";
import { samples, TEMPLATE_LABEL } from "@/lib/mail/templates";
import { filterParam, listParams } from "@/lib/paging";
import { PLATFORM_PERMISSIONS, PLATFORM_ROLES } from "@/lib/permissions";
import { checkoutConfigured } from "@/lib/viva/checkout";
import { addStaff, removeStaff, savePlatformSettings, sendTestMail, setStaffRole } from "../actions";
import { Submit } from "@/components/submit";

const TEST: Record<string, { ok: boolean; text: string }> = {
  SENT: { ok: true, text: "Το δοκιμαστικό email στάλθηκε. Κοίταξε τα εισερχόμενά σου." },
  SKIPPED: { ok: false, text: "Δεν στάλθηκε: δεν έχουν οριστεί τα κλειδιά του Mailgun." },
  FAILED: { ok: false, text: "Το Mailgun απέρριψε την αποστολή. Δες το σφάλμα στο ιστορικό πιο κάτω." },
};
const STATUS = { SENT: { tone: "success", text: "Στάλθηκε" }, FAILED: { tone: "danger", text: "Απέτυχε" }, SKIPPED: { tone: "warning", text: "Δεν στάλθηκε" } } as const;

export default async function PlatformSettingsPage({ searchParams }: PageProps<"/platform/settings">) {
  const admin = await requirePlatform("settings.manage");
  const q = await searchParams;
  const list = listParams(q, 15, ["to", "when"]);
  const status = filterParam(q, "status", ["SENT", "FAILED", "SKIPPED"]);
  const where = {
    ...(list.q ? { OR: [{ to: { contains: list.q, mode: "insensitive" as const } }, { subject: { contains: list.q, mode: "insensitive" as const } }] } : {}),
    ...(status ? { status } : {}),
  };
  const roleOptions = Object.entries(PLATFORM_ROLES).map(([k, r]): [string, string] => [k, r.label]);
  const [staff, settings, log, total] = await Promise.all([
    db.user.findMany({ where: { platformRole: { not: null } }, orderBy: { name: "asc" } }),
    platformSettings(),
    db.emailLog.findMany({ where, orderBy: list.sort === "to" ? { to: list.dir } : { createdAt: list.sort === "when" ? list.dir : "desc" }, skip: list.skip, take: list.take, include: { org: true } }),
    db.emailLog.count({ where }),
  ]);
  const ready = mailConfigured();
  const test = typeof q.test === "string" ? TEST[q.test] : undefined;
  const previews = Object.entries(samples(settings)) as [keyof typeof TEMPLATE_LABEL, ReturnType<typeof samples>["test"]][];

  return (
    <Page section="Πλατφόρμα" title="Ρυθμίσεις & email" description="Ισχύουν για όλη την πλατφόρμα και όλους τους πελάτες">
      <div className="max-w-7xl space-y-4">
        {q.error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{String(q.error)}</p> : null}

        <Card className="flex flex-wrap items-center gap-4 p-5">
          {ready ? <CircleCheck className="size-6 shrink-0 text-success" /> : <CircleAlert className="size-6 shrink-0 text-gold" />}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg">Mailgun</h2>
            <p className="text-sm text-muted-foreground">
              {ready
                ? `Συνδεδεμένο · τομέας αποστολής ${mailDomain()} · περιοχή ${process.env.MAILGUN_REGION === "us" ? "ΗΠΑ" : "ΕΕ"}. Κάθε πελάτης στέλνει ως υποτομέας@${mailDomain()}, με το δικό του όνομα και email απαντήσεων.`
                : "Δεν έχει συνδεθεί. Γράψε MAILGUN_API_KEY και MAILGUN_DOMAIN (και MAILGUN_REGION=eu ή us) στο .env του server και ξεκίνα τον ξανά. Μέχρι τότε τα email μόνο καταγράφονται, δεν φεύγουν."}
            </p>
            {test ? <p role="status" className={`mt-1 text-sm font-semibold ${test.ok ? "text-success" : "text-destructive"}`}>{test.text}</p> : null}
          </div>
          <form action={sendTestMail}><Submit className={btn("outline")}>Δοκιμαστικό email σε {admin.email}</Submit></form>
        </Card>

        <Card className="flex flex-wrap items-center gap-4 p-5">
          {checkoutConfigured() ? <CircleCheck className="size-6 shrink-0 text-success" /> : <CircleAlert className="size-6 shrink-0 text-gold" />}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg">Λογαριασμός Viva για τις συνδρομές</h2>
            <p className="text-sm text-muted-foreground">
              {checkoutConfigured()
                ? `Συνδεδεμένος · περιβάλλον ${process.env.VIVA_ENV === "production" ? "παραγωγής" : "demo"}. Οι συνδρομητές πληρώνουν με κάρτα από τη σελίδα «Συνδρομή» και τα χρήματα πιστώνονται σε αυτόν τον λογαριασμό. Στην πηγή πληρωμών της Viva, το Success URL πρέπει να είναι η διεύθυνση της εφαρμογής + /billing/paid.`
                : "Δεν έχει συνδεθεί. Γράψε VIVA_PLATFORM_CLIENT_ID και VIVA_PLATFORM_CLIENT_SECRET (Smart Checkout) στο .env του server. Μέχρι τότε οι χρεώσεις εξοφλούνται μόνο χειροκίνητα, από την καρτέλα του συνδρομητή."}
            </p>
          </div>
        </Card>

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

        <Card id="staff" className="scroll-mt-28">
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Προσωπικό πλατφόρμας {q.saved === "staff" ? <span role="status" className="ml-2 text-sm font-semibold text-success">Αποθηκεύτηκε</span> : null}</h2>
              <p className="text-sm text-muted-foreground">Όσοι δουλεύουν στην κονσόλα. Δεν ανήκουν σε συνδρομητή.</p>
            </div>
            {admin.can("staff.manage") ? (
              <Modal label="Νέο μέλος" title="Νέο μέλος προσωπικού" description="Παίρνει email πρόσκλησης και ορίζει μόνος του τον κωδικό του">
                <form action={addStaff} className="grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end">
                  <Field label="Ονοματεπώνυμο" name="name" required minLength={2} maxLength={60} />
                  <Field label="Email" name="email" type="email" required autoComplete="off" />
                  <Select label="Ρόλος" name="platformRole" defaultValue="SUPPORT" options={roleOptions} />
                  <Submit className={btn("default")}>Αποστολή πρόσκλησης</Submit>
                </form>
              </Modal>
            ) : null}
          </div>
          <ul className="divide-y divide-border/70">
            {staff.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{u.name}{u.id === admin.id ? " (εσύ)" : ""}</p>
                  <p className="text-xs text-muted-foreground">{u.email} · {PLATFORM_ROLES[u.platformRole!].hint}</p>
                </div>
                <Badge tone={u.platformRole === "SUPER_ADMIN" ? "success" : "neutral"}>{PLATFORM_ROLES[u.platformRole!].label}</Badge>
                {admin.can("staff.manage") ? (
                  <>
                    <Modal label="Ρόλος" size="sm" title={u.name} description={u.email}>
                      <form key={u.platformRole} action={setStaffRole} className="grid gap-4 [&>button]:justify-self-end">
                        <input type="hidden" name="userId" value={u.id} />
                        <Select label="Ρόλος" name="platformRole" defaultValue={u.platformRole!} options={roleOptions} />
                        <Submit className={btn("default")}>Αποθήκευση</Submit>
                      </form>
                    </Modal>
                    <form action={removeStaff.bind(null, u.id)}><Submit className={btn("ghost", "sm")}>Αφαίρεση</Submit></form>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <dl className="grid gap-x-6 gap-y-2 border-t border-border/70 p-5 sm:grid-cols-2">
            {Object.values(PLATFORM_ROLES).map((r) => (
              <div key={r.label}><dt className="text-xs font-semibold">{r.label}</dt><dd className="text-xs text-muted-foreground">{r.permissions.map((p) => PLATFORM_PERMISSIONS[p]).join(" · ")}</dd></div>
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
