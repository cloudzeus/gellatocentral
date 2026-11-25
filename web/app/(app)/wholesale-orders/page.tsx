import Link from "next/link";
import { FileText, ListOrdered, Plus, Route, Tags } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { OrderLinesEditor } from "@/components/order-lines-editor";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { partyIdsByName } from "@/lib/list-search";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { statusOptions, statusValues } from "@/lib/status";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { createWholesale } from "./actions";

export default async function WholesaleOrdersPage({ searchParams }: PageProps<"/wholesale-orders">) {
  const ctx = await requireStockContext("wholesale.read");
  const query = await searchParams;
  const list = listParams(query, 25, ["number", "date", "needed", "total"]);
  const status = filterParam(query, "status", statusValues("wholesaleOrder"));
  const [warehouses, matchingCustomers] = await Promise.all([
    db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, orderBy: { name: "asc" } }),
    partyIdsByName(ctx.orgId, list.q),
  ]);
  const warehouseIds = warehouses.map((row) => row.id);
  // αναζήτηση: αριθμός παραγγελίας ή όνομα πελάτη
  const where = {
    orgId: ctx.orgId, warehouseId: { in: warehouseIds }, ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}),
    ...(status ? { status } : {}),
    ...(list.q ? { OR: [{ number: { contains: list.q, mode: "insensitive" as const } }, { customerId: { in: matchingCustomers } }] } : {}),
  };
  const orderBy = list.sort === "total" ? [{ totalCents: list.dir }, { id: "desc" as const }]
    : list.sort === "number" ? [{ number: list.dir }]
    : list.sort === "needed" ? [{ neededAt: { sort: list.dir, nulls: "last" as const } }, { id: "desc" as const }]
    : [{ createdAt: list.sort === "date" ? list.dir : ("desc" as const) }, { id: "desc" as const }];
  const [orders, total, customers, stores, generics] = await Promise.all([
    db.wholesaleOrder.findMany({ where, include: { _count: { select: { lines: true } } }, orderBy, skip: list.skip, take: list.take }),
    db.wholesaleOrder.count({ where }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "customer" }, active: true }, orderBy: { name: "asc" } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, include: { baseUnit: true, vatRate: true }, orderBy: { name: "asc" } }),
  ]);
  const customerIds = [...new Set(orders.map((order) => order.customerId))];
  const orderCustomers = await db.party.findMany({ where: { orgId: ctx.orgId, id: { in: customerIds } }, select: { id: true, name: true } });
  const customerNames = new Map(orderCustomers.map((row) => [row.id, row.name]));
  const warehouseNames = new Map(warehouses.map((row) => [row.id, row.name]));
  const items = generics.map((item) => ({ id: item.id, name: item.name, scale: stockCostScale(item.baseUnit.dimension), unitLabel: item.baseUnit.dimension === "mass" ? "kg" : item.baseUnit.dimension === "volume" ? "l" : "1000 τεμ.", defaultVat: item.vatRate?.rate ?? 24 }));
  const day = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens" });
  const create = ctx.can("wholesale.add") ? <Modal wide label={<><Plus /> Νέα παραγγελία</>} title="Νέα παραγγελία χονδρικής"><form action={createWholesale} className="grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Select label="Πελάτης" name="customerId" required options={customers.map((row): [string, string] => [row.id, row.name])} /><Select label="Κατάστημα" name="storeId" required options={stores.map((row): [string, string] => [row.id, row.name])} /><Select label="Αποθήκη" name="warehouseId" required options={warehouses.map((row): [string, string] => [row.id, row.name])} /><Field label="Επιθυμητή παράδοση" name="neededAt" type="date" /></div><OrderLinesEditor items={items} /><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default", "default", "justify-self-end")}>Δημιουργία παραγγελίας</Submit></form></Modal> : null;
  return (
    <Page section="Πελάτες & πωλήσεις" title="Παραγγελίες χονδρικής" description="Παραγγελίες, FEFO παράδοση και δρομολόγια με κοινό απόθεμα" actions={<span className="flex flex-wrap gap-2"><Link href="/wholesale-orders/quotes" className={btn("outline", "sm")}><FileText /> Προσφορές</Link><Link href="/wholesale-orders/pricelists" className={btn("outline", "sm")}><Tags /> Τιμοκατάλογοι</Link><Link href="/wholesale-orders/routes" className={btn("outline", "sm")}><Route /> Δρομολόγια</Link><Link href="/wholesale-orders/b2b" className={btn("outline", "sm")}><ListOrdered /> B2B</Link>{create}</span>}>
      <div className="grid gap-4">
        {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
        <Card>
          <DataTable
            id="wholesale-orders"
            listing={{ ...list, total, placeholder: "Αριθμός ή πελάτης", filters: [{ key: "status", label: "Κατάσταση", value: status, options: statusOptions("wholesaleOrder") }] }}
            empty={<><p>Εδώ είναι οι παραγγελίες που σου κάνουν οι πελάτες χονδρικής. Δεν υπάρχει καμία ακόμα.</p>{create ? <div className="mt-3 flex justify-center">{create}</div> : null}</>}
            columns={[
              { key: "number", label: "Αριθμός", required: true, sortable: true },
              { key: "date", label: "Ημερομηνία", sortable: true },
              { key: "source", label: "Προέλευση" },
              { key: "customer", label: "Πελάτης" },
              { key: "warehouse", label: "Αποθήκη" },
              { key: "needed", label: "Παράδοση", sortable: true },
              { key: "lines", label: "Γραμμές", numeric: true },
              { key: "total", label: "Σύνολο", numeric: true, sortable: true },
              { key: "status", label: "Κατάσταση" },
            ]}
            rows={orders.map((order) => ({
              id: order.id,
              cells: {
                number: <Link href={`/wholesale-orders/${order.id}`} className="font-semibold underline-offset-2 hover:underline">{order.number}</Link>,
                date: day.format(order.createdAt),
                source: order.source === "b2b" ? "B2B" : "Γραφείο",
                customer: customerNames.get(order.customerId) ?? "—",
                warehouse: warehouseNames.get(order.warehouseId) ?? "—",
                needed: order.neededAt ? day.format(order.neededAt) : "—",
                lines: order._count.lines,
                total: euro(order.totalCents),
                status: <StatusBadge kind="wholesaleOrder" value={order.status} />,
              },
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
