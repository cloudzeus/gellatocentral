import { accountStatus, actionLabel } from "@/lib/access";
import { requirePlatform } from "@/lib/auth";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { PLATFORM_PERMISSIONS, PLATFORM_ROLES, type PlatformPermission, platformPermissionsOf, type PlatformRoleKey, staffRoleLabel } from "@/lib/permissions";
import { addStaff, deleteStaffRole, removeStaff, savePlatformRole, saveStaffRole, setStaffActive, setStaffRole } from "../actions";

/** Τα δικαιώματα της κονσόλας ως κουτάκια. Όσα δεν έχει ο ίδιος ο χρήστης δεν επιλέγονται. */
function PermBoxes({ selected, can }: { selected: readonly string[]; can: (p: PlatformPermission) => boolean }) {
  return (
    <fieldset className="rounded-lg border border-border/70 p-3">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">Δικαιώματα</legend>
      {(Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[]).map((p) => {
        const allowed = can(p);
        return (
          <label key={p} className={`flex min-h-10 items-center gap-3 rounded-lg px-2 py-1.5 ${allowed ? "cursor-pointer hover:bg-secondary" : "opacity-50"}`}>
            <input type="checkbox" name="permissions" value={p} defaultChecked={selected.includes(p)} disabled={!allowed} className="size-4 accent-[var(--primary)]" />
            <span>{PLATFORM_PERMISSIONS[p]}{allowed ? "" : " · δεν το έχεις εσύ"}</span>
          </label>
        );
      })}
    </fieldset>
  );
}


// Οι χρήστες της ίδιας της πλατφόρμας (όχι των συνδρομητών), οι ρόλοι τους και τι επιτρέπει ο καθένας.
export default async function PlatformStaffPage({ searchParams }: PageProps<"/platform/staff">) {
  const admin = await requirePlatform("staff.manage");
  const q = await searchParams;
  const [staff, customRoles, staffHistory] = await Promise.all([
    db.user.findMany({ where: { platformRole: { not: null } }, orderBy: { name: "asc" }, include: { staffRole: true } }),
    db.staffRole.findMany({ orderBy: { name: "asc" } }),
    db.accessEvent.findMany({ where: { orgId: null }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const roleOptions: [string, string][] = [...Object.entries(PLATFORM_ROLES).map(([k, r]): [string, string] => [k, r.label]), ...customRoles.map((r): [string, string] => [`custom:${r.id}`, r.name])];
  const roleValue = (u: { platformRole: PlatformRoleKey | null; staffRoleId: string | null }) => (u.staffRoleId && u.platformRole !== "SUPER_ADMIN" ? `custom:${u.staffRoleId}` : u.platformRole!);
  const seen = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });

  return (
    <Page section="Πλατφόρμα" title="Χρήστες & δικαιώματα" description="Ποιος δουλεύει στην κονσόλα της πλατφόρμας και τι επιτρέπεται να κάνει. Οι χρήστες κάθε συνδρομητή είναι στη σελίδα του">
      <div className="max-w-7xl space-y-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε: {q.error.slice(0, 200)}</p> : null}
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
                <Badge tone={u.platformRole === "SUPER_ADMIN" ? "success" : "neutral"}>{staffRoleLabel(u)}</Badge>
                {admin.can("staff.manage") ? (
                  <>
                    <Modal label="Ρόλος" size="sm" title={u.name} description={u.email}>
                      <form key={roleValue(u)} action={setStaffRole} className="grid gap-4 [&>button]:justify-self-end">
                        <input type="hidden" name="userId" value={u.id} />
                        <Select label="Ρόλος" name="platformRole" defaultValue={roleValue(u)} options={roleOptions} />
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
          <div className="flex flex-wrap items-center gap-3 border-t border-border/70 px-5 py-4">
            <div className="min-w-0 basis-64 flex-1">
              <h3 className="text-base font-semibold">Ρόλοι και δικαιώματα προσωπικού</h3>
              <p className="text-sm text-muted-foreground">Τι επιτρέπεται να κάνει κάθε ρόλος στην κονσόλα. Η αλλαγή ισχύει αμέσως για όλους όσοι έχουν τον ρόλο. Φτιάξε και δικούς σου, π.χ. «Λογιστήριο»</p>
            </div>
            {admin.can("staff.manage") ? (
              <Modal label="Νέος ρόλος" size="sm" title="Νέος ρόλος προσωπικού">
                <form action={saveStaffRole} className="grid gap-3">
                  <input type="hidden" name="roleId" value="" />
                  <Field label="Όνομα ρόλου" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Λογιστήριο" />
                  <PermBoxes selected={[]} can={admin.can} />
                  <Submit className={`${btn("default")} justify-self-end`}>Δημιουργία ρόλου</Submit>
                </form>
              </Modal>
            ) : null}
          </div>
          <ul className="divide-y divide-border/70 border-t border-border/70">
            {(Object.keys(PLATFORM_ROLES) as PlatformRoleKey[]).map((k) => {
              const has = platformPermissionsOf(k);
              const changed = k !== "SUPER_ADMIN" && [...has].sort().join() !== [...PLATFORM_ROLES[k].permissions].sort().join();
              return (
                <li key={k} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 basis-64 flex-1">
                    <p className="font-semibold">{PLATFORM_ROLES[k].label} <span className="font-normal text-muted-foreground">· {staff.filter((u) => roleValue(u) === k).length} άτομα{changed ? " · αλλαγμένος" : ""}</span></p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {k === "SUPER_ADMIN" ? <Badge tone="success">Όλα τα δικαιώματα</Badge> : has.length ? (Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[]).filter((p) => has.includes(p)).map((p) => <Badge key={p}>{PLATFORM_PERMISSIONS[p]}</Badge>) : <Badge tone="warning">Κανένα δικαίωμα</Badge>}
                    </p>
                  </div>
                  {k === "SUPER_ADMIN" ? <span className="text-xs text-muted-foreground">Δεν αλλάζει</span> : admin.can("staff.manage") ? (
                    <Modal label="Δικαιώματα" size="sm" title={`Ρόλος: ${PLATFORM_ROLES[k].label}`} description={PLATFORM_ROLES[k].hint}>
                      <form key={has.join()} action={savePlatformRole} className="grid gap-3">
                        <input type="hidden" name="role" value={k} />
                        <PermBoxes selected={has} can={admin.can} />
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
            {customRoles.map((r) => {
              const members = staff.filter((u) => roleValue(u) === `custom:${r.id}`).length;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 basis-64 flex-1">
                    <p className="font-semibold">{r.name} <span className="font-normal text-muted-foreground">· {members} άτομα · δικός σας ρόλος</span></p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {r.permissions.length ? (Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[]).filter((p) => r.permissions.includes(p)).map((p) => <Badge key={p}>{PLATFORM_PERMISSIONS[p]}</Badge>) : <Badge tone="warning">Κανένα δικαίωμα</Badge>}
                    </p>
                  </div>
                  {admin.can("staff.manage") ? (
                    <>
                      <Modal label="Δικαιώματα" size="sm" title={`Ρόλος: ${r.name}`} description={`${members} άτομα θα αποκτήσουν αμέσως τα νέα δικαιώματα`}>
                        <form key={r.permissions.join()} action={saveStaffRole} className="grid gap-3">
                          <input type="hidden" name="roleId" value={r.id} />
                          <Field label="Όνομα ρόλου" name="name" required minLength={2} maxLength={60} defaultValue={r.name} />
                          <PermBoxes selected={r.permissions} can={admin.can} />
                          <Submit className={`${btn("default")} justify-self-end`}>Αποθήκευση</Submit>
                        </form>
                      </Modal>
                      {members ? null : <form action={deleteStaffRole.bind(null, r.id)}><Submit className={btn("ghost", "sm")}>Διαγραφή</Submit></form>}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
