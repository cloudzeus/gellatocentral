import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowRight, Boxes, ClipboardCheck, ClipboardList, Scale } from "lucide-react";
import { Modal } from "@/components/modal";
import { DataTable } from "@/components/data-table";
import { OfflineCountCreate, OfflineCountQueue } from "@/components/offline-counts";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Kpi, menuItem, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { statusOptions, statusValues } from "@/lib/status";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { createCount } from "./actions";

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
  const [stores, counts, total, openCount, lastPosted] = await Promise.all([
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
    db.stockCount.count({ where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, status: "DRAFT" } }),
    db.stockCount.findFirst({ where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, status: "FINALIZED" }, orderBy: { countedOn: "desc" }, select: { countedOn: true } }),
  ]);
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.active);
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Athens" }).format(new Date());
  const error = param(q.error);

  const canAdd = ctx.can("counts.add") && activeWarehouses.length > 0;
  const sinceLast = lastPosted ? Math.floor((new Date(`${today}T00:00:00Z`).getTime() - lastPosted.countedOn.getTime()) / 86_400_000) : null;
  const create = canAdd ? <Modal variant="default" size="sm" label={<><ClipboardCheck /> Νέα απογραφή</>} title="Νέα απογραφή" description="Ξεκινά με όλα τα είδη που έχουν υπόλοιπο. Το αναμενόμενο απόθεμα και το κόστος «παγώνουν» τη στιγμή της δημιουργίας.">
    <form id="count-create" action={createCount} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="clientKey" value={randomUUID()} />
      <Select label="Πού μετράς" name="storeId" defaultValue="" hint="Σε κατάστημα, η αποθήκη πρέπει να ανήκει σε αυτό" options={[["", "Εργαστήριο / αποθήκη"], ...stores.map((store): [string, string] => [store.id, `Κατάστημα: ${store.name}`])]} />
      <Select label="Αποθήκη" name="warehouseId" required defaultValue={activeWarehouses[0]?.id} options={activeWarehouses.map((w): [string, string] => [w.id, w.name])} />
      <Field label="Ημερομηνία" name="countedOn" type="date" required defaultValue={today} />
      <div className="sm:col-span-2"><TextareaField label="Σημείωση" name="note" maxLength={500} placeholder="π.χ. Μηνιαία μέτρηση Νοεμβρίου" /></div>
      <div className="flex justify-end sm:col-span-2"><Submit className={btn("default")} pendingText="Δημιουργία…">Δημιουργία προσχεδίου</Submit></div>
      {stores.length ? <OfflineCountCreate identity={{ orgId: ctx.orgId, userId: ctx.userId }} formId="count-create" /> : null}
    </form>
  </Modal> : null;

  return (
    <Page
      section="Αποθήκη & αγορές"
      title="Απογραφές"
      description="Μέτρηση αποθέματος σε εργαστήριο ή κατάστημα· κάθε διαφορά με το σύστημα δικαιολογείται"
      actions={<span className="flex flex-wrap gap-2"><Link href="/inventory/stock" className={btn("outline", "sm")}><Boxes /> Απόθεμα</Link>{create}</span>}
    >
      <div className="grid max-w-[90rem] gap-5">
        {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 font-medium text-destructive">Η απογραφή δεν δημιουργήθηκε: {error.slice(0, 250)}</p> : null}
        {ctx.can("counts.add") && !activeWarehouses.length ? <p className="rounded-lg bg-warning/15 px-4 py-3 text-warning-ink">Δεν υπάρχει ενεργή αποθήκη στην οποία έχεις πρόσβαση, άρα δεν μπορείς να ξεκινήσεις απογραφή.</p> : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi icon={ClipboardList} label="Ανοιχτές απογραφές" value={openCount} tone={openCount ? "warning" : "success"} hint={openCount ? "Ολοκλήρωσέ τες για να διορθωθεί το απόθεμα" : "Καμία μέτρηση σε εκκρεμότητα"} />
          <Kpi icon={Scale} label="Τελευταία ολοκληρωμένη" value={sinceLast == null ? "—" : sinceLast === 0 ? "Σήμερα" : `πριν ${sinceLast} ημ.`} tone={sinceLast == null ? "warning" : sinceLast > 35 ? "danger" : sinceLast > 31 ? "warning" : "success"} hint={sinceLast == null ? "Δεν έχει γίνει ακόμα απογραφή" : sinceLast > 31 ? "Πέρασε ο μήνας· ώρα για νέα μέτρηση" : "Μέτρα τουλάχιστον μία φορά τον μήνα"} />
          <Kpi icon={Boxes} label="Αποθήκες" value={activeWarehouses.length} hint="Ενεργές αποθήκες που μπορείς να μετρήσεις" />
        </div>

        <OfflineCountQueue identity={{ orgId: ctx.orgId, userId: ctx.userId }} />

        <section className="grid gap-3">
          <h2 className="text-base font-semibold">Ιστορικό</h2>
          <Card>
            <DataTable
              id="stock-counts"
              listing={{ ...list, total, placeholder: "Αποθήκη, κατάστημα, σημείωση ή χρήστης", filters: [{ key: "status", label: "Κατάσταση", value: status, options: statusOptions("stockCount") }] }}
              empty={<><p>Εδώ βλέπεις κάθε απογραφή στις αποθήκες στις οποίες έχεις πρόσβαση. Δεν έχει γίνει καμία ακόμα.</p>{create ? <div className="mt-3 flex justify-center">{create}</div> : null}</>}
              columns={[
                { key: "date", label: "Ημερομηνία", required: true, sortable: true },
                { key: "status", label: "Κατάσταση" },
                { key: "place", label: "Χώρος / αποθήκη", wrap: true },
                { key: "lines", label: "Γραμμές", numeric: true },
                { key: "movements", label: "Διορθώσεις", numeric: true },
                { key: "createdBy", label: "Από" },
                { key: "created", label: "Δημιουργία", sortable: true },
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
