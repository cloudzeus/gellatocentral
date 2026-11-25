import { KeyRound, Pencil, Plus, UserCheck, UserMinus, UserX, UsersRound } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { PermissionMatrix } from "@/components/permission-matrix";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Badge, btn, Card, Field, menuItem, Page, Select } from "@/components/ui";
import { accountStatus, actionLabel } from "@/lib/access";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { AREAS, canGrant, orgPermissionsOf, permissionLabel } from "@/lib/permissions";
import { deleteGroup, deleteRole, inviteUser, removeMember, saveGroup, saveRole, sendResetLink, setMemberActive, updateMember } from "./actions";
import { Submit } from "@/components/submit";

const SAVED: Record<string, string> = { invited: "Η πρόσκληση στάλθηκε με email", member: "Ο χρήστης ενημερώθηκε", removed: "Η πρόσβαση αφαιρέθηκε", disabled: "Ο χρήστης απενεργοποιήθηκε και αποσυνδέθηκε από παντού", enabled: "Ο χρήστης ενεργοποιήθηκε ξανά", reset: "Στάλθηκε email για ορισμό κωδικού", role: "Οι ρόλοι ενημερώθηκαν", group: "Οι ομάδες ενημερώθηκαν" };
const form = "grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end";
const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });
const STATUS = { active: ["success", "Ενεργός"], pending: ["warning", "Εκκρεμεί η πρόσκληση"], disabled: ["neutral", "Απενεργοποιημένος"] } as const;

/** Κουτάκια επιλογής (καταστήματα ή ομάδες). Κανένα τσεκαρισμένο κατάστημα = όλα. */
function CheckList({ name, options, selected, emptyNote }: { name: string; options: [string, string][]; selected: string[]; emptyNote?: string }) {
  return (
    <fieldset className="rounded-lg border border-border/70 p-3 sm:col-span-2">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">{emptyNote}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {options.map(([value, label]) => (
          <label key={value} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <Checkbox name={name} value={value} defaultChecked={selected.includes(value)} />
            {label}
          </label>
        ))}
        {!options.length ? <p className="text-sm text-muted-foreground">Τίποτα διαθέσιμο ακόμα</p> : null}
      </div>
    </fieldset>
  );
}

/** Τα δικαιώματα ρόλου ή ομάδας ως ετικέτες. */
function PermBadges({ permissions }: { permissions: string[] }) {
  return (
    <p className="mt-1 flex flex-wrap gap-1">
      {permissions.length ? permissions.map((p) => <Badge key={p}>{permissionLabel(p)}</Badge>) : <Badge tone="warning">Κανένα δικαίωμα</Badge>}
    </p>
  );
}

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const { org, permissions: mine, membership: me, can } = await currentOrg("users.read");
  const q = await searchParams;
  const list = listParams(q, 25, ["user", "role"]);
  const roleIds = (await db.orgRole.findMany({ where: { orgId: org.id }, select: { id: true } })).map((r) => r.id);
  const role = filterParam(q, "role", roleIds);
  const where = { orgId: org.id, ...(role ? { roleId: role } : {}), ...(list.q ? { user: { OR: [{ name: { contains: list.q, mode: "insensitive" as const } }, { email: { contains: list.q, mode: "insensitive" as const } }] } } : {}) };
  const [members, total, roles, groups, stores, history, historyTotal] = await Promise.all([
    db.membership.findMany({ where, orderBy: list.sort === "role" ? { role: { name: list.dir } } : { user: { name: list.sort === "user" ? list.dir : "asc" } }, skip: list.skip, take: list.take, include: { user: true, role: true, stores: { include: { store: true } }, groups: { include: { group: true } } } }),
    db.membership.count({ where }),
    db.orgRole.findMany({ where: { orgId: org.id }, orderBy: [{ locked: "desc" }, { system: "desc" }, { name: "asc" }], include: { _count: { select: { members: true } } } }),
    db.orgGroup.findMany({ where: { orgId: org.id }, orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } }),
    db.store.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" } }),
    db.accessEvent.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.accessEvent.count({ where: { orgId: org.id } }),
  ]);
  // μόνο ρόλοι και ομάδες που δικαιούται να δώσει όποιος βλέπει τη σελίδα
  const roleOptions = roles.filter((r) => canGrant(mine, orgPermissionsOf(r))).map((r): [string, string] => [r.id, r.name]);
  const groupOptions = groups.filter((g) => canGrant(mine, g.permissions)).map((g): [string, string] => [g.id, g.name]);
  const storeOptions = stores.map((s): [string, string] => [s.id, s.name]);

  return (
    <Page
      section="Ρυθμίσεις" title="Χρήστες & ρόλοι" description="Ποιος μπαίνει στην εφαρμογή και τι επιτρέπεται να κάνει"
      actions={
        can("users.add") ? (
          <Modal label={<><Plus /> Νέος χρήστης</>} variant="default" title="Πρόσκληση χρήστη" description="Παίρνει email με σύνδεσμο και ορίζει μόνος του τον κωδικό του (ισχύει 72 ώρες)">
            <form action={inviteUser} className={form}>
              <Field label="Ονοματεπώνυμο" name="name" required minLength={2} maxLength={60} />
              <Field label="Email" name="email" type="email" required autoComplete="off" />
              <Select label="Ρόλος" name="roleId" options={roleOptions} />
              <CheckList name="storeIds" options={storeOptions} selected={[]} emptyNote="Καταστήματα — κανένα τσεκαρισμένο = όλα" />
              <CheckList name="groupIds" options={groupOptions} selected={[]} emptyNote="Ομάδες — προσθέτουν δικαιώματα πάνω στον ρόλο" />
              <Submit className={btn("default")}>Αποστολή πρόσκλησης</Submit>
            </form>
          </Modal>
        ) : null
      }
    >
      <div className="max-w-7xl space-y-4">
        {q.error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε: {String(q.error)}</p> : null}
        {typeof q.saved === "string" && SAVED[q.saved] ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success">{SAVED[q.saved]}</p> : null}

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Χρήστες</h2></div>
          <DataTable
            id="users"
            listing={{ ...list, total, placeholder: "Όνομα ή email", filters: [{ key: "role", label: "Ρόλος", value: role, options: roles.map((r): [string, string] => [r.id, r.name]) }] }}
            empty="Κανένας χρήστης ακόμα"
            columns={[
              { key: "user", label: "Χρήστης", required: true, sortable: true },
              { key: "role", label: "Ρόλος", sortable: true },
              { key: "groups", label: "Ομάδες" },
              { key: "store", label: "Καταστήματα" },
              { key: "status", label: "Κατάσταση" },
              { key: "seen", label: "Τελευταία σύνδεση" },
              { key: "edit", label: "Αλλαγή", required: true },
            ]}
            rows={members.map((m) => ({
              id: m.id,
              cells: {
                user: <><span className="font-semibold">{m.user.name}{m.id === me.id ? " (εσύ)" : ""}</span><span className="block text-xs text-muted-foreground">{m.user.email}</span></>,
                role: <Badge tone={m.role.locked ? "success" : "neutral"}>{m.role.name}</Badge>,
                groups: m.groups.length ? m.groups.map((g) => <Badge key={g.groupId} tone="neutral">{g.group.name}</Badge>) : <span className="text-muted-foreground">—</span>,
                store: m.stores.length ? m.stores.map((s) => s.store.name).join(", ") : "Όλα",
                status: <Badge tone={STATUS[accountStatus(m.user)][0]}>{STATUS[accountStatus(m.user)][1]}</Badge>,
                seen: m.user.lastLoginAt ? when.format(m.user.lastLoginAt) : <span className="text-muted-foreground">Ποτέ</span>,
                edit: can("users.edit") ? (
                  <Modal label={<><Pencil /> Ρόλος</>} size="sm" title={m.user.name} description={m.user.email}>
                    <form key={`${m.roleId}-${m.stores.map((s) => s.storeId).join()}-${m.groups.map((g) => g.groupId).join()}`} action={updateMember} className={form}>
                      <input type="hidden" name="membershipId" value={m.id} />
                      <Select label="Ρόλος" name="roleId" defaultValue={m.roleId} options={roleOptions.some(([v]) => v === m.roleId) ? roleOptions : [[m.roleId, m.role.name], ...roleOptions]} />
                      <CheckList name="storeIds" options={storeOptions} selected={m.stores.map((s) => s.storeId)} emptyNote="Καταστήματα — κανένα τσεκαρισμένο = όλα" />
                      <CheckList name="groupIds" options={groupOptions} selected={m.groups.map((g) => g.groupId)} emptyNote="Ομάδες — προσθέτουν δικαιώματα πάνω στον ρόλο" />
                      <Submit className={btn("default")}>Αποθήκευση</Submit>
                    </form>
                  </Modal>
                ) : null,
              },
              menu: (
                <>
                  {can("users.edit") ? <form action={sendResetLink.bind(null, m.id)}><Submit role="menuitem" className={menuItem}><KeyRound /> Email για ορισμό κωδικού</Submit></form> : null}
                  {m.id === me.id || !can("users.edit") ? null : <form action={setMemberActive.bind(null, m.id, !!m.user.disabledAt)}><Submit role="menuitem" className={menuItem}>{m.user.disabledAt ? <><UserCheck /> Ενεργοποίηση</> : <><UserX /> Απενεργοποίηση</>}</Submit></form>}
                  {can("users.delete") ? <form action={removeMember.bind(null, m.id)}><Submit role="menuitem" className={`${menuItem} text-destructive`}><UserMinus /> Αφαίρεση πρόσβασης</Submit></form> : null}
                </>
              ),
            }))}
          />
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Ρόλοι</h2>
              <p className="text-sm text-muted-foreground">Κάθε ρόλος είναι ένα σύνολο δικαιωμάτων. Φτιάξε δικούς σου, π.χ. «Υπεύθυνος βάρδιας».</p>
            </div>
            {can("users.edit") ? (
              <Modal label={<><Plus /> Νέος ρόλος</>} title="Νέος ρόλος">
                <form action={saveRole} className={form}>
                  <input type="hidden" name="rowId" value="" />
                  <Field label="Όνομα ρόλου" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Υπεύθυνος βάρδιας" />
                  <PermissionMatrix areas={AREAS} selected={[]} mine={mine} />
                  <Submit className={btn("default")}>Δημιουργία ρόλου</Submit>
                </form>
              </Modal>
            ) : null}
          </div>
          <ul className="divide-y divide-border/70">
            {roles.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.name} <span className="font-normal text-muted-foreground">· {r._count.members} {r._count.members === 1 ? "χρήστης" : "χρήστες"}</span></p>
                  {r.locked ? <p className="mt-1"><Badge tone="success">Όλα τα δικαιώματα</Badge></p> : <PermBadges permissions={orgPermissionsOf(r)} />}
                </div>
                {r.locked ? <span className="text-xs text-muted-foreground">Δεν αλλάζει</span> : can("users.edit") ? (
                  <Modal label={<><Pencil /> Δικαιώματα</>} size="sm" title={`Ρόλος: ${r.name}`} description={`${r._count.members} χρήστες θα αποκτήσουν αμέσως τα νέα δικαιώματα`}>
                    <form key={r.permissions.join()} action={saveRole} className={form}>
                      <input type="hidden" name="rowId" value={r.id} />
                      <Field label="Όνομα ρόλου" name="name" required minLength={2} maxLength={60} defaultValue={r.name} />
                      <PermissionMatrix areas={AREAS} selected={orgPermissionsOf(r)} mine={mine} />
                      <Submit className={btn("default")}>Αποθήκευση</Submit>
                    </form>
                  </Modal>
                ) : null}
                {!r.system && !r.locked && can("users.delete") ? <form action={deleteRole.bind(null, r.id)}><Submit className={btn("ghost", "sm")}>Διαγραφή</Submit></form> : null}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg"><UsersRound className="mr-1 inline size-5" /> Ομάδες</h2>
              <p className="text-sm text-muted-foreground">Η ομάδα προσθέτει δικαιώματα σε όσους ανήκουν σε αυτήν, πάνω στον ρόλο τους. Π.χ. «Απογραφές»: όσοι είναι μέλη βλέπουν και την αποθήκη.</p>
            </div>
            {can("users.edit") ? (
              <Modal label={<><Plus /> Νέα ομάδα</>} title="Νέα ομάδα">
                <form action={saveGroup} className={form}>
                  <input type="hidden" name="rowId" value="" />
                  <Field label="Όνομα ομάδας" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Απογραφές" />
                  <PermissionMatrix areas={AREAS} selected={[]} mine={mine} />
                  <Submit className={btn("default")}>Δημιουργία ομάδας</Submit>
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
                  {can("users.edit") ? (
                    <Modal label={<><Pencil /> Δικαιώματα</>} size="sm" title={`Ομάδα: ${g.name}`} description="Ισχύει αμέσως για όλα τα μέλη της">
                      <form key={g.permissions.join()} action={saveGroup} className={form}>
                        <input type="hidden" name="rowId" value={g.id} />
                        <Field label="Όνομα ομάδας" name="name" required minLength={2} maxLength={60} defaultValue={g.name} />
                        <PermissionMatrix areas={AREAS} selected={g.permissions} mine={mine} />
                        <Submit className={btn("default")}>Αποθήκευση</Submit>
                      </form>
                    </Modal>
                  ) : null}
                  {!g._count.members && can("users.delete") ? <form action={deleteGroup.bind(null, g.id)}><Submit className={btn("ghost", "sm")}>Διαγραφή</Submit></form> : null}
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία ομάδα ακόμα. Οι χρήστες παίρνουν δικαιώματα από τον ρόλο τους· με ομάδες μπορείς να δίνεις έξτρα σε όσους τις χρειάζονται.</p>}
        </Card>

        <Card id="history" className="scroll-mt-28">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Ιστορικό αλλαγών</h2>
            <p className="text-sm text-muted-foreground">Ποιος άλλαξε χρήστη, ρόλο ή δικαίωμα και πότε</p>
          </div>
          {history.length ? (
            <ul className="divide-y divide-border/70">
              {history.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5">
                  <p className="min-w-0 flex-1"><span className="font-semibold">{actionLabel(e.action)}</span>: {e.target}{e.detail ? <span className="block text-xs text-muted-foreground">{e.detail}</span> : null}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{e.actorName} · {when.format(e.createdAt)}</p>
                </li>
              ))}
              {historyTotal > history.length ? <li className="px-5 py-2.5 text-xs text-muted-foreground">Εμφανίζονται οι {history.length} πιο πρόσφατες από {historyTotal}</li> : null}
            </ul>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία αλλαγή ακόμα. Κάθε πρόσκληση, αλλαγή ρόλου ή απενεργοποίηση θα φαίνεται εδώ</p>}
        </Card>
      </div>
    </Page>
  );
}
