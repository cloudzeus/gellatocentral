import Link from "next/link";
import { Eye } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Badge, Card, cn, menuItem, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { ACTIVE, PRIORITY, type Priority, responseClock, span, STATUS, type Status } from "@/lib/support/rules";

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
const RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

// Η ουρά της υποστήριξης: πρώτα όσα κινδυνεύουν να ξεπεράσουν τον χρόνο πρώτης απάντησης.
export default async function QueuePage({ searchParams }: PageProps<"/platform/support">) {
  const me = await requirePlatform("support.tickets");
  const sp = await searchParams;
  const list = listParams(sp, 25, ["number", "updated"]);
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
  const [found, total, open, answered, solved] = await Promise.all([
    // shortcut: η σειρά «πρώτα ό,τι κινδυνεύει» υπολογίζεται εδώ πάνω σε έως 500 αιτήματα· με μεγαλύτερη ουρά θέλει στήλη προθεσμίας στη βάση
    db.ticket.findMany({ where, orderBy: list.sort === "number" ? { number: list.dir } : { updatedAt: list.sort === "updated" ? list.dir : "desc" }, take: 500, include: { org: { select: { name: true } } } }),
    db.ticket.count({ where }),
    db.ticket.findMany({ where: { status: { in: ACTIVE } }, select: { priority: true, status: true, createdAt: true, firstResponseAt: true, assigneeId: true } }),
    db.ticket.findMany({ where: { firstResponseAt: { gte: daysAgo(30) } }, select: { createdAt: true, firstResponseAt: true } }),
    db.ticket.count({ where: { resolvedAt: { gte: daysAgo(7) } } }),
  ]);
  const now = new Date();
  const clock = (t: (typeof found)[number]) => responseClock({ ...t, priority: t.priority as Priority, status: t.status as Status }, now);
  const sorted = list.sort ? found : [...found].sort((a, b) => (clock(a).minutesLeft ?? 1e9) - (clock(b).minutesLeft ?? 1e9) || RANK[a.priority] - RANK[b.priority] || b.updatedAt.getTime() - a.updatedAt.getTime());
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
                { key: "priority", label: "Προτεραιότητα", value: priority, options: Object.entries(PRIORITY).map(([k, v]): [string, string] => [k, v.label]) },
                { key: "who", label: "Ανάθεση", value: who, options: [["mine", "Δικά μου"], ["none", "Χωρίς ανάθεση"]] },
              ],
            }}
            empty={state === "open" ? "Κανένα ανοιχτό αίτημα" : "Κανένα αίτημα"}
            columns={[
              { key: "ticket", label: "Αίτημα", required: true },
              { key: "org", label: "Πελάτης" },
              { key: "priority", label: "Προτεραιότητα" },
              { key: "status", label: "Κατάσταση" },
              { key: "clock", label: "Χρόνος απάντησης" },
              { key: "who", label: "Ανάθεση" },
            ]}
            rows={sorted.slice(list.skip, list.skip + list.take).map((t) => {
              const c = clock(t);
              return {
                id: t.id,
                cells: {
                  ticket: <Link href={`/platform/support/${t.id}`} className="font-semibold underline-offset-2 hover:underline"><span className="mr-2 rounded-sm border border-dashed border-primary/30 bg-background px-1.5 py-0.5 font-mono text-xs font-medium">#{t.number}</span>{t.subject}</Link>,
                  org: t.org.name,
                  priority: <Badge tone={PRIORITY[t.priority as Priority].tone}>{PRIORITY[t.priority as Priority].label}</Badge>,
                  status: <Badge tone={STATUS[t.status as Status].tone}>{STATUS[t.status as Status].label}</Badge>,
                  clock: <Badge tone={c.tone}>{c.text}</Badge>,
                  who: t.assigneeName ?? <span className="text-muted-foreground">—</span>,
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
