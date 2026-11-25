import { Eye, Plus } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { TicketSubject } from "@/components/ticket-subject";
import { btn, Card, menuItem, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { memberScope } from "@/lib/support";
import { ACTIVE, CATEGORIES, URGENCY } from "@/lib/support/rules";
import { createTicket } from "./actions";
import { StatusBadge } from "@/components/status-badge";

const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });

// Τα αιτήματα του χρήστη προς την υποστήριξη (ή όλης της επιχείρησης, αν έχει το δικαίωμα).
export default async function SupportPage({ searchParams }: PageProps<"/support">) {
  const { org, user } = await currentOrg();
  const scope = memberScope(user)!;
  const sp = await searchParams;
  const list = listParams(sp, 20, ["number", "updated"]);
  const state = filterParam(sp, "state", ["open", "done"]);
  const where = {
    orgId: org.id,
    ...(scope.all ? {} : { openedById: user.id }),
    ...(state ? { status: state === "open" ? { in: ACTIVE } : { notIn: ACTIVE } } : {}),
    ...(list.q ? { OR: [{ subject: { contains: list.q, mode: "insensitive" as const } }, ...(Number.isInteger(Number(list.q.replace("#", ""))) ? [{ number: Number(list.q.replace("#", "")) }] : [])] } : {}),
  };
  const [rows, total, devices, waiting] = await Promise.all([
    db.ticket.findMany({ where, orderBy: list.sort === "number" ? { number: list.dir } : { updatedAt: list.sort === "updated" ? list.dir : "desc" }, skip: list.skip, take: list.take, include: { messages: { where: { internal: false }, orderBy: { createdAt: "desc" }, take: 1 } } }),
    db.ticket.count({ where }),
    db.device.findMany({ where: { store: { orgId: org.id }, active: true }, orderBy: { name: "asc" }, include: { store: true } }),
    db.ticket.count({ where: { orgId: org.id, ...(scope.all ? {} : { openedById: user.id }), status: "WAITING_CUSTOMER" } }),
  ]);

  return (
    <Page section="Υποστήριξη" title="Υποστήριξη" description={scope.all ? `Τα αιτήματα της ${org.name} προς την υποστήριξη και πού βρίσκονται` : "Ό,τι έχεις ρωτήσει την υποστήριξη και πού βρίσκεται"}
      actions={
        <Modal label={<><Plus /> Νέο αίτημα</>} variant="default" title="Νέο αίτημα" description="Πες μας τι συμβαίνει με δικά σου λόγια">
          <form action={createTicket} className="grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end">
            <div className="sm:col-span-2"><TicketSubject /></div>
            <Select label="Τι αφορά" name="category" options={Object.entries(CATEGORIES)} />
            <Select label="Ποια συσκευή αφορά" name="deviceId" options={[["", "Καμία συγκεκριμένη"], ...devices.map((d): [string, string] => [d.id, `${d.name} · ${d.store.name}`])]} />
            <div className="sm:col-span-2"><Select label="Πόσο επείγει" name="urgency" defaultValue="hard" options={Object.entries(URGENCY)} /></div>
            <label className="block space-y-1 text-sm font-medium sm:col-span-2">Περιέγραψε τι βλέπεις<span className="text-destructive"> *</span>
              <textarea name="body" required minLength={10} maxLength={4000} rows={5} className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-normal" placeholder="Από πότε, σε ποια οθόνη, τι μήνυμα βγάζει" />
              <span className="block text-xs font-normal text-muted-foreground">Φωτογραφία της οθόνης προσθέτεις στο επόμενο βήμα</span>
            </label>
            <Submit className={btn("default")}>Αποστολή αιτήματος</Submit>
          </form>
        </Modal>
      }>
      <div className="max-w-7xl space-y-4">
        {typeof sp.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{sp.error.slice(0, 200)}</p> : null}
        {waiting > 0 ? <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 font-medium">{waiting === 1 ? "Ένα αίτημα περιμένει" : `${waiting} αιτήματα περιμένουν`} τη δική σου απάντηση</p> : null}
        <Card>
          <DataTable
            id="my-tickets"
            listing={{ ...list, total, placeholder: "Θέμα ή αριθμός αιτήματος", filters: [{ key: "state", label: "Κατάσταση", value: state, options: [["open", "Ανοιχτά"], ["done", "Λυμένα και κλειστά"]] }] }}
            empty="Κανένα αίτημα ακόμα. Αν κάτι δεν δουλεύει ή δεν το βρίσκεις, πάτα «Νέο αίτημα»"
            columns={[
              { key: "ticket", label: "Αίτημα", required: true, sortable: false },
              { key: "status", label: "Κατάσταση" },
              { key: "last", label: "Τελευταία ενέργεια" },
              { key: "by", label: "Το άνοιξε" },
            ]}
            rows={rows.map((t) => {
              const last = t.messages[0];
              return {
                id: t.id,
                cells: {
                  ticket: <Link href={`/support/${t.id}`} className="font-semibold underline-offset-2 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"><span className="mr-2 rounded-sm border border-dashed border-primary/30 bg-background px-1.5 py-0.5 font-mono text-xs font-medium">#{t.number}</span>{t.subject}</Link>,
                  status: <StatusBadge kind="ticketCustomer" value={t.status} />,
                  last: last ? `${last.authorKind === "support" ? `${last.authorName} από την υποστήριξη` : last.authorKind === "system" ? "Ενημέρωση" : last.authorName} · ${when.format(last.createdAt)}` : "—",
                  by: t.openedByName,
                },
                menu: <Link href={`/support/${t.id}`} role="menuitem" className={menuItem}><Eye /> Άνοιγμα αιτήματος</Link>,
              };
            })}
          />
        </Card>
      </div>
    </Page>
  );
}
