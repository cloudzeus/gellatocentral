import { KeyRound, Pencil, Plus, UserMinus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Badge, btn, Card, Field, menuItem, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { listParams } from "@/lib/paging";
import { ALL_PERMISSIONS, canGrant, PERMISSIONS } from "@/lib/permissions";
import { deleteRole, inviteUser, removeMember, saveRole, sendResetLink, updateMember } from "./actions";

const SAVED: Record<string, string> = { invited: "Η πρόσκληση στάλθηκε με email.", member: "Ο χρήστης ενημερώθηκε.", removed: "Η πρόσβαση αφαιρέθηκε.", reset: "Στάλθηκε email για ορισμό κωδικού.", role: "Οι ρόλοι ενημερώθηκαν." };
const form = "grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end";
const GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];

/** Τα δικαιώματα ως πλαίσια επιλογής, ομαδοποιημένα όπως το μενού. Όσα δεν έχει ο ίδιος ο χρήστης δεν επιλέγονται. */
function PermissionBoxes({ selected, mine }: { selected: string[]; mine: string[] }) {
  return (
    <div className="space-y-3 sm:col-span-2">
      {GROUPS.map((g) => (
        <fieldset key={g} className="rounded-xl border border-border/70 p-3">
          <legend className="px-1 text-xs font-bold text-muted-foreground">{g}</legend>
          {PERMISSIONS.filter((p) => p.group === g).map((p) => {
            const allowed = mine.includes(p.key);
            return (
              <label key={p.key} className={`flex min-h-10 items-start gap-3 rounded-lg px-2 py-1.5 ${allowed ? "cursor-pointer hover:bg-secondary" : "opacity-50"}`}>
                <input type="checkbox" name="permissions" value={p.key} defaultChecked={selected.includes(p.key)} disabled={!allowed} className="mt-0.5 size-4 accent-[var(--primary)]" />
                <span><span className="font-bold">{p.label}</span><span className="block text-xs text-muted-foreground">{p.hint}{allowed ? "" : " · δεν το έχεις εσύ"}</span></span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const { org, permissions: mine, membership: me } = await currentOrg("users.manage");
  const q = await searchParams;
  const list = listParams(q);
  const where = { orgId: org.id, ...(list.q ? { user: { OR: [{ name: { contains: list.q, mode: "insensitive" as const } }, { email: { contains: list.q, mode: "insensitive" as const } }] } } : {}) };
  const [members, total, roles, stores] = await Promise.all([
    db.membership.findMany({ where, orderBy: { user: { name: "asc" } }, skip: list.skip, take: list.take, include: { user: true, role: true, store: true } }),
    db.membership.count({ where }),
    db.orgRole.findMany({ where: { orgId: org.id }, orderBy: [{ locked: "desc" }, { system: "desc" }, { name: "asc" }], include: { _count: { select: { members: true } } } }),
    db.store.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" } }),
  ]);
  const perms = (r: { locked: boolean; permissions: string[] }) => (r.locked ? ALL_PERMISSIONS : r.permissions);
  // μόνο ρόλοι που δικαιούται να δώσει όποιος βλέπει τη σελίδα
  const roleOptions = roles.filter((r) => canGrant(mine, perms(r))).map((r): [string, string] => [r.id, r.name]);
  const storeOptions: [string, string][] = [["", "Όλα τα καταστήματα"], ...stores.map((s): [string, string] => [s.id, s.name])];

  return (
    <Page
      section="Ρυθμίσεις" title="Χρήστες & ρόλοι" description="Ποιος μπαίνει στην εφαρμογή και τι επιτρέπεται να κάνει"
      actions={
        <Modal label={<><Plus /> Νέος χρήστης</>} variant="gold" title="Πρόσκληση χρήστη" description="Παίρνει email με σύνδεσμο και ορίζει μόνος του τον κωδικό του (ισχύει 72 ώρες)">
          <form action={inviteUser} className={form}>
            <Field label="Ονοματεπώνυμο" name="name" required minLength={2} maxLength={60} />
            <Field label="Email" name="email" type="email" required autoComplete="off" />
            <Select label="Ρόλος" name="roleId" options={roleOptions} />
            <Select label="Κατάστημα" name="storeId" options={storeOptions} />
            <button className={btn("default")}>Αποστολή πρόσκλησης</button>
          </form>
        </Modal>
      }
    >
      <div className="mx-auto max-w-5xl space-y-4">
        {q.error ? <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">Δεν έγινε: {String(q.error)}</p> : null}
        {typeof q.saved === "string" && SAVED[q.saved] ? <p role="status" className="rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-success">{SAVED[q.saved]}</p> : null}

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Χρήστες</h2></div>
          <DataTable
            id="users"
            listing={{ ...list, total, placeholder: "Όνομα ή email" }}
            empty="Κανένας χρήστης ακόμα."
            columns={[
              { key: "user", label: "Χρήστης", required: true },
              { key: "role", label: "Ρόλος" },
              { key: "store", label: "Κατάστημα" },
              { key: "status", label: "Κατάσταση" },
              { key: "edit", label: "Αλλαγή", required: true },
            ]}
            rows={members.map((m) => ({
              id: m.id,
              cells: {
                user: <><span className="font-bold">{m.user.name}{m.id === me.id ? " (εσύ)" : ""}</span><span className="block text-xs text-muted-foreground">{m.user.email}</span></>,
                role: <Badge tone={m.role.locked ? "success" : "neutral"}>{m.role.name}</Badge>,
                store: m.store?.name ?? "Όλα",
                status: m.user.passwordHash ? <Badge tone="success">Ενεργός</Badge> : <Badge tone="warning">Εκκρεμεί η πρόσκληση</Badge>,
                edit: (
                  <Modal label={<><Pencil /> Ρόλος</>} size="sm" title={m.user.name} description={m.user.email}>
                    <form key={`${m.roleId}-${m.storeId}`} action={updateMember} className={form}>
                      <input type="hidden" name="membershipId" value={m.id} />
                      <Select label="Ρόλος" name="roleId" defaultValue={m.roleId} options={roleOptions.some(([v]) => v === m.roleId) ? roleOptions : [[m.roleId, m.role.name], ...roleOptions]} />
                      <Select label="Κατάστημα" name="storeId" defaultValue={m.storeId ?? ""} options={storeOptions} />
                      <button className={btn("default")}>Αποθήκευση</button>
                    </form>
                  </Modal>
                ),
              },
              menu: (
                <>
                  <form action={sendResetLink.bind(null, m.id)}><button role="menuitem" className={menuItem}><KeyRound /> Email για ορισμό κωδικού</button></form>
                  <form action={removeMember.bind(null, m.id)}><button role="menuitem" className={`${menuItem} text-destructive`}><UserMinus /> Αφαίρεση πρόσβασης</button></form>
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
            <Modal label={<><Plus /> Νέος ρόλος</>} title="Νέος ρόλος">
              <form action={saveRole} className={form}>
                <input type="hidden" name="roleId" value="" />
                <Field label="Όνομα ρόλου" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Υπεύθυνος βάρδιας" />
                <PermissionBoxes selected={[]} mine={mine} />
                <button className={btn("default")}>Δημιουργία ρόλου</button>
              </form>
            </Modal>
          </div>
          <ul className="divide-y divide-border/70">
            {roles.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{r.name} <span className="font-normal text-muted-foreground">· {r._count.members} {r._count.members === 1 ? "χρήστης" : "χρήστες"}</span></p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {r.locked ? <Badge tone="success">Όλα τα δικαιώματα</Badge> : perms(r).length ? PERMISSIONS.filter((p) => r.permissions.includes(p.key)).map((p) => <Badge key={p.key}>{p.label}</Badge>) : <Badge tone="warning">Κανένα δικαίωμα</Badge>}
                  </p>
                </div>
                {r.locked ? <span className="text-xs text-muted-foreground">Δεν αλλάζει</span> : (
                  <Modal label={<><Pencil /> Δικαιώματα</>} size="sm" title={`Ρόλος: ${r.name}`} description={`${r._count.members} χρήστες θα αποκτήσουν αμέσως τα νέα δικαιώματα`}>
                    <form key={r.permissions.join()} action={saveRole} className={form}>
                      <input type="hidden" name="roleId" value={r.id} />
                      <Field label="Όνομα ρόλου" name="name" required minLength={2} maxLength={60} defaultValue={r.name} />
                      <PermissionBoxes selected={r.permissions} mine={mine} />
                      <button className={btn("default")}>Αποθήκευση</button>
                    </form>
                  </Modal>
                )}
                {!r.system && !r.locked ? <form action={deleteRole.bind(null, r.id)}><button className={btn("ghost", "sm")}>Διαγραφή</button></form> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
