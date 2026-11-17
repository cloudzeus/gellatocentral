import { CircleAlert, CircleCheck } from "lucide-react";
import { accountStatus, actionLabel } from "@/lib/access";
import { requirePlatform } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/mail/send";
import { samples, TEMPLATE_LABEL } from "@/lib/mail/templates";
import { filterParam, listParams } from "@/lib/paging";
import { PLATFORM_PERMISSIONS, PLATFORM_ROLES, type PlatformPermission, platformPermissionsOf, type PlatformRoleKey } from "@/lib/permissions";
import { Connections } from "@/components/connections";
import { addStaff, removeStaff, saveLegalSettings, savePlatformRole, savePlatformSettings, setStaffActive, setStaffRole } from "../actions";
import { Submit } from "@/components/submit";

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
  const [staff, settings, log, total, staffHistory] = await Promise.all([
    db.user.findMany({ where: { platformRole: { not: null } }, orderBy: { name: "asc" } }),
    platformSettings(),
    db.emailLog.findMany({ where, orderBy: list.sort === "to" ? { to: list.dir } : { createdAt: list.sort === "when" ? list.dir : "desc" }, skip: list.skip, take: list.take, include: { org: true } }),
    db.emailLog.count({ where }),
    db.accessEvent.findMany({ where: { orgId: null }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const seen = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });
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
                  <p className="text-xs text-muted-foreground">{u.email} · {accountStatus(u) === "disabled" ? "Δεν μπορεί να συνδεθεί" : accountStatus(u) === "pending" ? "Εκκρεμεί η πρόσκληση" : u.lastLoginAt ? `Τελευταία σύνδεση ${seen.format(u.lastLoginAt)}` : "Δεν έχει συνδεθεί ακόμα"}</p>
                </div>
                {u.disabledAt ? <Badge tone="warning">Απενεργοποιημένος</Badge> : null}
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
                    {u.id === admin.id ? null : <form action={setStaffActive.bind(null, u.id, !!u.disabledAt)}><Submit className={btn("ghost", "sm")}>{u.disabledAt ? "Ενεργοποίηση" : "Απενεργοποίηση"}</Submit></form>}
                    <form action={removeStaff.bind(null, u.id)}><Submit className={btn("ghost", "sm")}>Αφαίρεση</Submit></form>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {staffHistory.length ? (
            <details className="border-t border-border/70 px-5 py-3">
              <summary className="cursor-pointer text-sm font-semibold">Ιστορικό αλλαγών στο προσωπικό ({staffHistory.length} πιο πρόσφατες)</summary>
              <ul className="mt-2 space-y-1.5">
                {staffHistory.map((e) => <li key={e.id} className="text-sm"><span className="font-semibold">{actionLabel(e.action)}</span>: {e.target}{e.detail ? ` · ${e.detail}` : ""} <span className="text-xs text-muted-foreground">· {e.actorName} · {seen.format(e.createdAt)}</span></li>)}
              </ul>
            </details>
          ) : null}
          <div className="border-t border-border/70 px-5 py-4">
            <h3 className="text-base font-semibold">Ρόλοι και δικαιώματα προσωπικού</h3>
            <p className="text-sm text-muted-foreground">Τι επιτρέπεται να κάνει κάθε ρόλος στην κονσόλα. Η αλλαγή ισχύει αμέσως για όλους όσοι έχουν τον ρόλο</p>
          </div>
          <ul className="divide-y divide-border/70 border-t border-border/70">
            {(Object.keys(PLATFORM_ROLES) as PlatformRoleKey[]).map((k) => {
              const has = platformPermissionsOf(k);
              const changed = k !== "SUPER_ADMIN" && [...has].sort().join() !== [...PLATFORM_ROLES[k].permissions].sort().join();
              return (
                <li key={k} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 basis-64 flex-1">
                    <p className="font-semibold">{PLATFORM_ROLES[k].label} <span className="font-normal text-muted-foreground">· {staff.filter((u) => u.platformRole === k).length} άτομα{changed ? " · αλλαγμένος" : ""}</span></p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {k === "SUPER_ADMIN" ? <Badge tone="success">Όλα τα δικαιώματα</Badge> : has.length ? (Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[]).filter((p) => has.includes(p)).map((p) => <Badge key={p}>{PLATFORM_PERMISSIONS[p]}</Badge>) : <Badge tone="warning">Κανένα δικαίωμα</Badge>}
                    </p>
                  </div>
                  {k === "SUPER_ADMIN" ? <span className="text-xs text-muted-foreground">Δεν αλλάζει</span> : admin.can("staff.manage") ? (
                    <Modal label="Δικαιώματα" size="sm" title={`Ρόλος: ${PLATFORM_ROLES[k].label}`} description={PLATFORM_ROLES[k].hint}>
                      <form key={has.join()} action={savePlatformRole} className="grid gap-3">
                        <input type="hidden" name="role" value={k} />
                        <fieldset className="rounded-lg border border-border/70 p-3">
                          <legend className="px-1 text-xs font-semibold text-muted-foreground">Δικαιώματα</legend>
                          {(Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[]).map((p) => {
                            const allowed = admin.can(p);
                            return (
                              <label key={p} className={`flex min-h-10 items-center gap-3 rounded-lg px-2 py-1.5 ${allowed ? "cursor-pointer hover:bg-secondary" : "opacity-50"}`}>
                                <input type="checkbox" name="permissions" value={p} defaultChecked={has.includes(p)} disabled={!allowed} className="size-4 accent-[var(--primary)]" />
                                <span>{PLATFORM_PERMISSIONS[p]}{allowed ? "" : " · δεν το έχεις εσύ"}</span>
                              </label>
                            );
                          })}
                        </fieldset>
                        <div className="flex flex-wrap justify-end gap-2">
                          {changed ? <Submit name="reset" value="1" className={btn("ghost")}>Επαναφορά στα αρχικά</Submit> : null}
                          <Submit className={btn("default")}>Αποθήκευση</Submit>
                        </div>
                      </form>
                    </Modal>
                  ) : null}
                </li>
              );
            })}
          </ul>
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
