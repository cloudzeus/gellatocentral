import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowRight, Boxes, ClipboardCheck } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { OfflineCountCreate, OfflineCountQueue } from "@/components/offline-counts";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, menuItem, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { statusOptions, statusValues } from "@/lib/status";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { createCount } from "./actions";

const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// STK-05/STK-06: εργαστήριο ή έγκυρο ζεύγος store/warehouse, πάντα με server-side scope.
export default async function CountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const ctx = await requireStockContext("counts.read");
  const warehouses = await db.warehouse.findMany({
    where: warehouseScopeWhere(ctx),
    select: { id: true, name: true, active: true },
    orderBy: { name: "asc" },
  });
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const list = listParams(q, 25, ["date", "created"]);
  const status = filterParam(q, "status", statusValues("stockCount"));
  const contains = { contains: list.q, mode: "insensitive" as const };
  // αναζήτηση: αποθήκη, κατάστημα, σημείωση ή όνομα αυτού που τη δημιούργησε
  const where = {
    orgId: ctx.orgId, warehouseId: { in: warehouseIds },
    ...(status ? { status } : {}),
    ...(list.q ? { OR: [{ warehouse: { name: contains } }, { store: { name: contains } }, { note: contains }, { createdByName: contains }] } : {}),
  };
  const orderBy = list.sort === "date" ? [{ countedOn: list.dir }, { id: "desc" as const }] : [{ createdAt: list.sort === "created" ? list.dir : ("desc" as const) }, { id: "desc" as const }];
  const [stores, counts, total] = await Promise.all([
    db.store.findMany({
      where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.stockCount.findMany({
      where,
      include: {
        warehouse: { select: { name: true } },
        store: { select: { name: true } },
        _count: { select: { lines: true, movements: true } },
      },
      orderBy, skip: list.skip, take: list.take,
    }),
    db.stockCount.count({ where }),
  ]);
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.active);
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Athens" }).format(new Date());
  const error = param(q.error);

  return (
    <Page
      section="Αποθήκη & αγορές"
      title="Απογραφές"
      description="Μέτρηση πρώτων υλών σε εργαστήριο ή κατάστημα, με παγωμένο snapshot και αιτιολογημένες διαφορές"
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
            <form id="count-create" action={createCount} className="grid gap-4 px-5 py-5 md:grid-cols-2 lg:grid-cols-[minmax(11rem,1fr)_minmax(11rem,1fr)_minmax(10rem,0.7fr)_minmax(15rem,1.3fr)_auto] lg:items-end">
              <input type="hidden" name="clientKey" value={randomUUID()} />
              <label className="space-y-1 text-sm font-medium">Χώρος απογραφής
                <select name="storeId" className={field} defaultValue="">
                  <option value="">Εργαστήριο / αποθήκη</option>
                  {stores.map((store) => <option key={store.id} value={store.id}>Κατάστημα: {store.name}</option>)}
                </select>
                <span className="block text-xs font-normal text-muted-foreground">Σε κατάστημα, η αποθήκη πρέπει να είναι συνδεδεμένη με αυτό.</span>
              </label>
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
              {stores.length ? <OfflineCountCreate identity={{ orgId: ctx.orgId, userId: ctx.userId }} formId="count-create" /> : null}
            </form>
          ) : null}
        </Card>

        <OfflineCountQueue identity={{ orgId: ctx.orgId, userId: ctx.userId }} />

        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">Απογραφές</h2>
          <Card>
            <DataTable
              id="stock-counts"
              listing={{ ...list, total, placeholder: "Αποθήκη, κατάστημα, σημείωση ή χρήστης", filters: [{ key: "status", label: "Κατάσταση", value: status, options: statusOptions("stockCount") }] }}
              empty="Εδώ βλέπεις κάθε απογραφή στις αποθήκες στις οποίες έχεις πρόσβαση. Δεν έχει γίνει καμία ακόμα: ξεκίνα από τη «Νέα απογραφή» πιο πάνω."
              columns={[
                { key: "date", label: "Ημερομηνία", required: true, sortable: true },
                { key: "place", label: "Χώρος / αποθήκη", wrap: true },
                { key: "lines", label: "Γραμμές", numeric: true },
                { key: "movements", label: "Διορθώσεις", numeric: true },
                { key: "createdBy", label: "Από" },
                { key: "created", label: "Δημιουργία", sortable: true },
                { key: "status", label: "Κατάσταση" },
              ]}
              rows={counts.map((count) => ({
                id: count.id,
                cells: {
                  date: <Link href={`/counts/${count.id}`} className="font-semibold underline-offset-2 hover:underline">{day.format(count.countedOn)}</Link>,
                  place: <><span className="block text-xs text-muted-foreground">{count.store ? `Κατάστημα: ${count.store.name}` : "Εργαστήριο / αποθήκη"}</span>{count.warehouse.name}{count.note ? <span className="mt-1 block text-xs text-muted-foreground">{count.note}</span> : null}</>,
                  lines: count._count.lines,
                  movements: count._count.movements,
                  createdBy: count.createdByName,
                  created: dateTime.format(count.createdAt),
                  status: <StatusBadge kind="stockCount" value={count.status} />,
                },
                menu: <Link href={`/counts/${count.id}`} role="menuitem" className={menuItem}><ArrowRight /> Άνοιγμα</Link>,
              }))}
            />
          </Card>
        </section>
      </div>
    </Page>
  );
}
