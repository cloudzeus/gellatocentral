import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowRight, Boxes, ClipboardCheck } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { createCount } from "./actions";

const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
const th = "px-4 py-3 text-left text-xs font-semibold whitespace-nowrap text-muted-foreground";
const td = "border-t border-border/70 px-4 py-3 align-middle";
const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// STK-05: draft απογραφές εργαστηρίου και ιστορικό αποδίδονται αποκλειστικά στον server.
export default async function CountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const ctx = await requireStockContext("counts.read");
  const warehouses = await db.warehouse.findMany({
    where: warehouseScopeWhere(ctx),
    select: { id: true, name: true, active: true },
    orderBy: { name: "asc" },
  });
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const counts = warehouseIds.length ? await db.stockCount.findMany({
    where: { orgId: ctx.orgId, storeId: null, warehouseId: { in: warehouseIds } },
    include: {
      warehouse: { select: { name: true } },
      _count: { select: { lines: true, movements: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  }) : [];
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.active);
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Athens" }).format(new Date());
  const error = param(q.error);

  return (
    <Page
      section="Αποθήκη & αγορές"
      title="Απογραφές"
      description="Μέτρηση αποθέματος πρώτων υλών στο εργαστήριο, με παγωμένο snapshot και αιτιολογημένες διαφορές"
      actions={<Link href="/inventory/stock" className={btn("outline", "sm")}><Boxes /> Απόθεμα</Link>}
    >
      <div className="grid max-w-[90rem] gap-5">
        {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Η απογραφή δεν δημιουργήθηκε: {error.slice(0, 250)}</p> : null}

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><ClipboardCheck className="size-5" /> Νέα απογραφή</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ξεκινά με όλες τις μη μηδενικές ποσότητες της αποθήκης. Το αναμενόμενο απόθεμα και το κόστος παγώνουν στη δημιουργία.</p>
          </div>
          {!ctx.can("counts.add") ? <p className="px-5 py-5 text-sm text-muted-foreground">Έχεις δικαίωμα προβολής, αλλά όχι δημιουργίας απογραφής.</p> : null}
          {ctx.can("counts.add") && !activeWarehouses.length ? <p className="px-5 py-5 text-sm text-muted-foreground">Δεν υπάρχει ενεργή αποθήκη στην οποία έχεις πρόσβαση.</p> : null}
          {ctx.can("counts.add") && activeWarehouses.length ? (
            <form action={createCount} className="grid gap-4 px-5 py-5 md:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_minmax(11rem,0.7fr)_minmax(16rem,1.5fr)_auto] lg:items-end">
              <input type="hidden" name="clientKey" value={randomUUID()} />
              <label className="space-y-1 text-sm font-medium">Αποθήκη
                <select name="warehouseId" required className={field} defaultValue={activeWarehouses[0]!.id}>
                  {activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">Ημερομηνία απογραφής
                <input name="countedOn" type="date" required defaultValue={today} className={field} />
              </label>
              <label className="space-y-1 text-sm font-medium">Σημείωση (προαιρετική)
                <input name="note" maxLength={500} placeholder="π.χ. Μηνιαία μέτρηση Νοεμβρίου" className={field} />
              </label>
              <Submit className={btn("default")} pendingText="Δημιουργία…">Δημιουργία προσχεδίου</Submit>
            </form>
          ) : null}
        </Card>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[68rem] border-collapse text-sm">
              <caption className="px-4 py-4 text-left"><span className="block text-lg font-semibold">Πρόσφατες απογραφές</span><span className="text-muted-foreground">Οι 50 τελευταίες εγγραφές στις αποθήκες στις οποίες έχεις πρόσβαση</span></caption>
              <thead className="bg-secondary/35"><tr><th className={th} scope="col">Κατάσταση</th><th className={th} scope="col">Ημερομηνία</th><th className={th} scope="col">Αποθήκη</th><th className={th} scope="col">Γραμμές</th><th className={th} scope="col">Διορθώσεις</th><th className={th} scope="col">Δημιουργία</th><th className={th} scope="col"><span className="sr-only">Άνοιγμα</span></th></tr></thead>
              <tbody>
                {counts.map((count) => (
                  <tr key={count.id} className="hover:bg-secondary/20">
                    <td className={td}><Badge tone={count.status === "FINALIZED" ? "success" : "warning"}>{count.status === "FINALIZED" ? "Οριστικοποιημένη" : "Προσχέδιο"}</Badge></td>
                    <td className={`${td} whitespace-nowrap font-medium`}>{day.format(count.countedOn)}</td>
                    <td className={td}>{count.warehouse.name}{count.note ? <span className="mt-1 block max-w-xs truncate text-xs text-muted-foreground">{count.note}</span> : null}</td>
                    <td className={`${td} tabular-nums`}>{count._count.lines}</td>
                    <td className={`${td} tabular-nums`}>{count._count.movements}</td>
                    <td className={td}><span className="whitespace-nowrap">{count.createdByName}</span><span className="mt-1 block whitespace-nowrap text-xs text-muted-foreground">{dateTime.format(count.createdAt)}</span></td>
                    <td className={`${td} text-right`}><Link href={`/counts/${count.id}`} className={btn("outline", "sm")}>Άνοιγμα <ArrowRight /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!counts.length ? <p className="px-4 pb-6 text-sm text-muted-foreground">Δεν υπάρχει ακόμη απογραφή στις επιτρεπτές αποθήκες.</p> : null}
        </Card>
      </div>
    </Page>
  );
}
