import { Building2, Plus, Store } from "lucide-react";
import { accountStatus, actionLabel } from "@/lib/access";
import { requirePlatform } from "@/lib/auth";
import { Modal } from "@/components/modal";
import { PermissionMatrix } from "@/components/permission-matrix";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { ALL_PERMISSIONS, AREAS, permissionLabel as orgPermLabel, PLATFORM_AREAS, PLATFORM_PERMISSIONS, PLATFORM_ROLES, type PlatformPermission, platformPermissionsOf, type PlatformRoleKey, staffPermissions, staffRoleLabel } from "@/lib/permissions";
import { addStaff, addStaffAccess, deleteStaffGroup, deleteStaffRole, removeStaff, removeStaffAccess, savePlatformRole, saveStaffGroup, saveStaffRole, setStaffActive, setStaffGroups, setStaffRole } from "../actions";

const seen = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });

/** Τα δικαιώματα ενός ρόλου ή ομάδας προσωπικού ως ετικέτες. */
function PermBadges({ permissions }: { permissions: readonly string[] }) {
  return (
    <p className="mt-1 flex flex-wrap gap-1">
      {permissions.length ? permissions.map((p) => <Badge key={p}>{PLATFORM_PERMISSIONS[p as PlatformPermission] ?? p}</Badge>) : <Badge tone="warning">Κανένα δικαίωμα</Badge>}
    </p>
  );
}

// Οι χρήστες της ίδιας της πλατφόρμας (όχι των συνδρομητών), οι ρόλοι, οι ομάδες τους και η πρόσβασή τους σε πελάτες.
export default async function PlatformStaffPage({ searchParams }: PageProps<"/platform/staff">) {
  const admin = await requirePlatform("staff.read");
  const q = await searchParams;
  const mine = staffPermissions(admin);
  const [staff, customRoles, groups, orgs, staffHistory] = await Promise.all([
    db.user.findMany({ where: { platformRole: { not: null } }, orderBy: { name: "asc" }, include: { staffRole: true, staffGroups: { include: { group: true } }, storeAccesses: { include: { org: { select: { name: true } }, store: { select: { name: true } } } } } }),
    db.staffRole.findMany({ orderBy: { name: "asc" } }),
    db.staffGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } }),
    db.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, stores: { where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } } } }),
    db.accessEvent.findMany({ where: { orgId: null }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const roleOptions: [string, string][] = [...Object.entries(PLATFORM_ROLES).map(([k, r]): [string, string] => [k, r.label]), ...customRoles.map((r): [string, string] => [`custom:${r.id}`, r.name])];
  const roleValue = (u: { platformRole: PlatformRoleKey | null; staffRoleId: string | null }) => (u.staffRoleId && u.platformRole !== "SUPER_ADMIN" ? `custom:${u.staffRoleId}` : u.platformRole!);
  // επιλογές «επιχείρηση» ή «επιχείρηση — κατάστημα» για την πρόσβαση σε πελάτες
  const targetOptions: [string, string][] = orgs.flatMap((o): [string, string][] => [[o.id, `${o.name} — όλα τα καταστήματα`], ...o.stores.map((s): [string, string] => [`${o.id}:${s.id}`, `${o.name} — ${s.name}`])]);

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
            {admin.can("staff.add") ? (
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
              <li key={u.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{u.name}{u.id === admin.id ? " (εσύ)" : ""}</p>
                    <p className="text-xs text-muted-foreground">{u.email} · {accountStatus(u) === "disabled" ? "Δεν μπορεί να συνδεθεί" : accountStatus(u) === "pending" ? "Εκκρεμεί η πρόσκληση" : u.lastLoginAt ? `Τελευταία σύνδεση ${seen.format(u.lastLoginAt)}` : "Δεν έχει συνδεθεί ακόμα"}</p>
                  </div>
                  {u.disabledAt ? <Badge tone="warning">Απενεργοποιημένος</Badge> : null}
                  <Badge tone={u.platformRole === "SUPER_ADMIN" ? "success" : "neutral"}>{staffRoleLabel(u)}</Badge>
                  {u.staffGroups.map((g) => <Badge key={g.groupId} tone="neutral">{g.group.name}</Badge>)}
                  {admin.can("staff.edit") ? (
                    <>
                      <Modal label="Ρόλος" size="sm" title={u.name} description={u.email}>
                        <form key={roleValue(u)} action={setStaffRole} className="grid gap-4 [&>button]:justify-self-end">
                          <input type="hidden" name="userId" value={u.id} />
                          <Select label="Ρόλος" name="platformRole" defaultValue={roleValue(u)} options={roleOptions} />
                          <Submit className={btn("default")}>Αποθήκευση</Submit>
                        </form>
                      </Modal>
                      <Modal label="Ομάδες" size="sm" title={u.name} description="Οι ομάδες προσθέτουν δικαιώματα πάνω στον ρόλο — δεν αφαιρούν ποτέ">
                        <form key={u.staffGroups.map((g) => g.groupId).join()} action={setStaffGroups} className="grid gap-3 [&>button]:justify-self-end">
                          <input type="hidden" name="userId" value={u.id} />
                          {groups.length ? groups.map((g) => (
                            <label key={g.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-secondary">
                              <input type="checkbox" name="groupIds" value={g.id} defaultChecked={u.staffGroups.some((x) => x.groupId === g.id)} className="size-4 accent-[var(--primary)]" />
                              <span className="text-sm font-medium">{g.name}</span>
                            </label>
                          )) : <p className="text-sm text-muted-foreground">Δεν υπάρχουν ομάδες ακόμα — φτιάξτε μία πιο κάτω</p>}
                          {groups.length ? <Submit className={btn("default")}>Αποθήκευση</Submit> : null}
                        </form>
                      </Modal>
                      {u.id === admin.id ? null : <form action={setStaffActive.bind(null, u.id, !!u.disabledAt)}><Submit className={btn("ghost", "sm")}>{u.disabledAt ? "Ενεργοποίηση" : "Απενεργοποίηση"}</Submit></form>}
                    </>
                  ) : null}
                  {admin.can("staff.delete") && u.id !== admin.id ? <form action={removeStaff.bind(null, u.id)}><Submit className={btn("ghost", "sm")}>Αφαίρεση</Submit></form> : null}
                </div>
                {(u.storeAccesses.length > 0 || admin.can("staff.edit")) && (
                  <div className="mt-2 rounded-lg border border-border/50 bg-secondary/40 px-3 py-2">
                    <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground"><Store className="size-3.5" /> Πρόσβαση σε δεδομένα συνδρομητών
                      {admin.can("staff.edit") ? (
                        <Modal label={<><Plus className="size-3.5" /> Προσθήκη</>} size="sm" title={`Πρόσβαση σε πελάτη: ${u.name}`} description="Δικαιώματα της πλευράς της επιχείρησης (π.χ. προβολή συναλλασσόμενων), μόνο για την επιχείρηση ή το κατάστημα που διαλέγεις">
                          <form action={addStaffAccess} className="grid gap-4">
                            <input type="hidden" name="userId" value={u.id} />
                            <Select label="Επιχείρηση / κατάστημα" name="target" options={targetOptions} />
                            <PermissionMatrix areas={AREAS} selected={[]} mine={ALL_PERMISSIONS} />
                            <Submit className={`${btn("default")} justify-self-end`}>Παραχώρηση</Submit>
                          </form>
                        </Modal>
                      ) : null}
                    </p>
                    {u.storeAccesses.length ? (
                      <ul className="mt-1.5 space-y-1">
                        {u.storeAccesses.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                            <Building2 className="size-3.5 text-muted-foreground" />
                            <span className="font-medium">{a.org.name} · {a.store?.name ?? "όλα τα καταστήματα"}</span>
                            <span className="text-muted-foreground">{a.permissions.map(orgPermLabel).join(", ")}</span>
                            {admin.can("staff.delete") ? <form action={removeStaffAccess.bind(null, a.id)}><Submit className="text-destructive underline underline-offset-2">αφαίρεση</Submit></form> : null}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-1 text-xs text-muted-foreground">Καμία ειδική παραχώρηση</p>}
                  </div>
                )}
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
            {admin.can("staff.edit") ? (
              <Modal label="Νέος ρόλος" title="Νέος ρόλος προσωπικού">
                <form action={saveStaffRole} className="grid gap-3">
                  <input type="hidden" name="roleId" value="" />
                  <Field label="Όνομα ρόλου" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Λογιστήριο" />
                  <PermissionMatrix areas={PLATFORM_AREAS} selected={[]} mine={mine} />
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
                    {k === "SUPER_ADMIN" ? <p className="mt-1"><Badge tone="success">Όλα τα δικαιώματα</Badge></p> : <PermBadges permissions={has} />}
                  </div>
                  {k === "SUPER_ADMIN" ? <span className="text-xs text-muted-foreground">Δεν αλλάζει</span> : admin.can("staff.edit") ? (
                    <Modal label="Δικαιώματα" title={`Ρόλος: ${PLATFORM_ROLES[k].label}`} description={PLATFORM_ROLES[k].hint}>
                      <form key={has.join()} action={savePlatformRole} className="grid gap-3">
                        <input type="hidden" name="role" value={k} />
                        <PermissionMatrix areas={PLATFORM_AREAS} selected={has} mine={mine} />
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
                    <PermBadges permissions={r.permissions} />
                  </div>
                  {admin.can("staff.edit") ? (
                    <Modal label="Δικαιώματα" title={`Ρόλος: ${r.name}`} description={`${members} άτομα θα αποκτήσουν αμέσως τα νέα δικαιώματα`}>
                      <form key={r.permissions.join()} action={saveStaffRole} className="grid gap-3">
                        <input type="hidden" name="roleId" value={r.id} />
                        <Field label="Όνομα ρόλου" name="name" required minLength={2} maxLength={60} defaultValue={r.name} />
                        <PermissionMatrix areas={PLATFORM_AREAS} selected={r.permissions} mine={mine} />
                        <Submit className={`${btn("default")} justify-self-end`}>Αποθήκευση</Submit>
                      </form>
                    </Modal>
                  ) : null}
                  {!members && admin.can("staff.delete") ? <form action={deleteStaffRole.bind(null, r.id)}><Submit className={btn("ghost", "sm")}>Διαγραφή</Submit></form> : null}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Ομάδες προσωπικού</h2>
              <p className="text-sm text-muted-foreground">Η ομάδα προσθέτει δικαιώματα στα μέλη της, πάνω στον ρόλο τους. Π.χ. «Βάρδια Σαββάτου»: βλέπει και τη βάση γνώσεων.</p>
            </div>
            {admin.can("staff.edit") ? (
              <Modal label="Νέα ομάδα" title="Νέα ομάδα προσωπικού">
                <form action={saveStaffGroup} className="grid gap-3">
                  <input type="hidden" name="groupId" value="" />
                  <Field label="Όνομα ομάδας" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Βάρδια Σαββάτου" />
                  <PermissionMatrix areas={PLATFORM_AREAS} selected={[]} mine={mine} />
                  <Submit className={`${btn("default")} justify-self-end`}>Δημιουργία ομάδας</Submit>
                </form>
              </Modal>
            ) : null}
          </div>
          {groups.length ? (
            <ul className="divide-y divide-border/70">
              {groups.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{g.name} <span className="font-normal text-muted-foreground">· {g._count.members} {g._count.members === 1 ? "μέλος" : "μέλη"}</span></p>
                    <PermBadges permissions={g.permissions} />
                  </div>
                  {admin.can("staff.edit") ? (
                    <Modal label="Δικαιώματα" title={`Ομάδα: ${g.name}`} description="Ισχύει αμέσως για όλα τα μέλη της">
                      <form key={g.permissions.join()} action={saveStaffGroup} className="grid gap-3">
                        <input type="hidden" name="groupId" value={g.id} />
                        <Field label="Όνομα ομάδας" name="name" required minLength={2} maxLength={60} defaultValue={g.name} />
                        <PermissionMatrix areas={PLATFORM_AREAS} selected={g.permissions} mine={mine} />
                        <Submit className={`${btn("default")} justify-self-end`}>Αποθήκευση</Submit>
                      </form>
                    </Modal>
                  ) : null}
                  {admin.can("staff.delete") ? <form action={deleteStaffGroup.bind(null, g.id)}><Submit className={btn("ghost", "sm")}>Διαγραφή</Submit></form> : null}
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία ομάδα ακόμα</p>}
        </Card>
      </div>
    </Page>
  );
}
