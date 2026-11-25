import Link from "next/link";
import { Eye } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Card, cn, menuItem, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { look, statusOptions } from "@/lib/status";
import { ACTIVE, type Priority, responseClock, span, type Status } from "@/lib/support/rules";

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);

// Η ουρά της υποστήριξης: πρώτα όσα κινδυνεύουν να ξεπεράσουν τον χρόνο πρώτης απάντησης.
export default async function QueuePage({ searchParams }: PageProps<"/platform/support">) {
  const me = await requirePlatform("support.tickets");
  const sp = await searchParams;
  const list = listParams(sp, 25, ["number", "priority", "created", "updated"]);
  const state = filterParam(sp, "state", ["open", "done", "all"]) ?? "open";
  const priority = filterParam(sp, "priority", ["CRITICAL", "HIGH", "NORMAL", "LOW"]);
  const who = filterParam(sp, "who", ["mine", "none"]);
  const number = Number(list.q.replace("#", ""));
  const where = {
    ...(state === "all" ? {} : { status: state === "open" ? { in: ACTIVE } : { notIn: ACTIVE } }),
    ...(priority ? { priority } : {}),
    ...(who === "mine" ? { assigneeId: me.id } : who === "none" ? { assigneeId: null } : {}),
    ...(list.q ? { OR: [{ subject: { contains: list.q, mode: "insensitive" as const } }, { org: { name: { contains: list.q, mode: "insensitive" as const } } }, ...(Number.isInteger(number) && number > 0 ? [{ number }] : [])] } : {}),
  };
  const orderBy = list.sort === "number" ? [{ number: list.dir }]
    : list.sort === "priority" ? [{ priority: list.dir === "desc" ? ("asc" as const) : ("desc" as const) }, { id: "desc" as const }]
    : list.sort === "created" ? [{ createdAt: list.dir }, { id: "desc" as const }]
    : list.sort === "updated" ? [{ updatedAt: list.dir }, { id: "desc" as const }]
    : [{ firstResponseAt: { sort: "asc" as const, nulls: "first" as const } }, { priority: "asc" as const }, { createdAt: "asc" as const }, { id: "desc" as const }];
  const [found, total, open, answered, solved] = await Promise.all([
    // Προεπιλεγμένη σειρά μέσα στη βάση: πρώτα όσα δεν έχουν πάρει ακόμα πρώτη απάντηση, μετά η προτεραιότητα (το enum είναι δηλωμένο
    // CRITICAL→LOW, άρα asc = πρώτα τα κρίσιμα) και μέσα της τα παλαιότερα. Είναι η ίδια ιδέα με το ρολόι, όχι ακριβώς τα λεπτά που μένουν:
    // shortcut: ακριβής σειρά «λεπτά ως την προθεσμία» θέλει στήλη προθεσμίας (firstResponseDueAt) στο Ticket
    db.ticket.findMany({ where, orderBy, skip: list.skip, take: list.take, include: { org: { select: { name: true } } } }),
    db.ticket.count({ where }),
    db.ticket.findMany({ where: { status: { in: ACTIVE } }, select: { priority: true, status: true, createdAt: true, firstResponseAt: true, assigneeId: true } }),
    db.ticket.findMany({ where: { firstResponseAt: { gte: daysAgo(30) } }, select: { createdAt: true, firstResponseAt: true } }),
    db.ticket.count({ where: { resolvedAt: { gte: daysAgo(7) } } }),
  ]);
  const now = new Date();
  const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
  const clock = (t: (typeof found)[number]) => responseClock({ ...t, priority: t.priority as Priority, status: t.status as Status }, now);
  const atRisk = open.filter((t) => { const c = responseClock({ ...t, priority: t.priority as Priority, status: t.status as Status }, now); return c.minutesLeft !== null && c.tone !== "neutral"; }).length;
  const avg = answered.length ? Math.round(answered.reduce((s, t) => s + (t.firstResponseAt!.getTime() - t.createdAt.getTime()), 0) / answered.length / 60000) : null;
  const tiles = [
    { label: "Ανοιχτά", value: String(open.length), hint: `${open.filter((t) => t.assigneeId === me.id).length} δικά σου · ${open.filter((t) => !t.assigneeId).length} χωρίς ανάθεση`, bad: false },
    { label: "Κινδυνεύουν", value: String(atRisk), hint: atRisk ? "Ο χρόνος πρώτης απάντησης λήγει ή έληξε: απάντησε πρώτα σε αυτά" : "Κανένα δεν κινδυνεύει να ξεπεράσει τον χρόνο απάντησης", bad: atRisk > 0 },
    { label: "Μέση πρώτη απάντηση", value: avg === null ? "—" : span(avg), hint: avg === null ? "Δεν έχει απαντηθεί αίτημα τις τελευταίες 30 ημέρες" : `Σε ${answered.length} αιτήματα · 30 ημέρες`, bad: false },
    { label: "Λύθηκαν αυτή την εβδομάδα", value: String(solved), hint: "Τις τελευταίες 7 ημέρες", bad: false },
  ];

  return (
    <Page section="Υποστήριξη πελατών" title="Αιτήματα" description="Τα αιτήματα υποστήριξης όλων των πελατών. Πρώτα όσα κινδυνεύουν να ξεπεράσουν τον χρόνο απάντησης">
      <div className="max-w-7xl space-y-4">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {tiles.map((t) => (
            <Card key={t.label} className="px-5 py-4">
              <p className="font-medium text-muted-foreground">{t.label}</p>
              <p className={cn("mt-1.5 text-3xl leading-tight font-semibold tabular-nums", t.bad && "text-destructive")}>{t.value}</p>
              <p className="mt-1.5 text-muted-foreground">{t.hint}</p>
            </Card>
          ))}
        </div>
        <Card>
          <DataTable
            id="support-queue"
            listing={{
              ...list, total, placeholder: "Αριθμός, θέμα ή πελάτης",
              filters: [
                { key: "state", label: "Κατάσταση", value: state === "open" ? undefined : state, options: [["done", "Λυμένα και κλειστά"], ["all", "Όλα"]] },
                { key: "priority", label: "Προτεραιότητα", value: priority, options: statusOptions("ticketPriority") },
                { key: "who", label: "Ανάθεση", value: who, options: [["mine", "Δικά μου"], ["none", "Χωρίς ανάθεση"]] },
              ],
            }}
            empty={state === "open" ? "Εδώ έρχονται τα αιτήματα υποστήριξης των πελατών. Αυτή τη στιγμή δεν υπάρχει κανένα ανοιχτό." : "Εδώ έρχονται τα αιτήματα υποστήριξης των πελατών. Δεν υπάρχει κανένα ακόμα."}
            columns={[
              { key: "number", label: "Αίτημα", required: true, sortable: true },
              { key: "org", label: "Πελάτης" },
              { key: "priority", label: "Προτεραιότητα", sortable: true },
              { key: "status", label: "Κατάσταση" },
              { key: "clock", label: "Χρόνος απάντησης" },
              { key: "who", label: "Ανάθεση" },
              { key: "created", label: "Άνοιξε", sortable: true },
              { key: "updated", label: "Τελευταία αλλαγή", sortable: true },
            ]}
            rows={found.map((t) => {
              const c = clock(t);
              return {
                id: t.id,
                cells: {
                  number: <Link href={`/platform/support/${t.id}`} className="font-semibold underline-offset-2 hover:underline"><span className="mr-2 rounded-sm border border-dashed border-primary/30 bg-background px-1.5 py-0.5 font-mono text-xs font-medium">#{t.number}</span>{t.subject}</Link>,
                  org: t.org.name,
                  priority: <StatusBadge kind="ticketPriority" value={t.priority} />,
                  status: <StatusBadge kind="ticket" value={t.status} />,
                  clock: <StatusBadge look={look(c.tone, c.text)} />,
                  who: t.assigneeName ?? <span className="text-muted-foreground">—</span>,
                  created: when.format(t.createdAt),
                  updated: when.format(t.updatedAt),
                },
                menu: <Link href={`/platform/support/${t.id}`} role="menuitem" className={menuItem}><Eye /> Άνοιγμα αιτήματος</Link>,
              };
            })}
          />
        </Card>
      </div>
    </Page>
  );
}
