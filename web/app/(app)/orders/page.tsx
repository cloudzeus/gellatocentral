import Link from "next/link";
import { ClipboardList, Plus, Sparkles } from "lucide-react";
import { Modal } from "@/components/modal";
import { OrderLinesEditor } from "@/components/order-lines-editor";
import { Submit } from "@/components/submit";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { btn, Card, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { partyIdsByName } from "@/lib/list-search";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { statusOptions, statusValues } from "@/lib/status";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { createOrder } from "./actions";

const itemOptions = (items: { id: string; name: string; baseUnit: { dimension: string }; vatRate: { rate: number } | null }[]) => items.map((item) => ({ id: item.id, name: item.name, scale: stockCostScale(item.baseUnit.dimension), unitLabel: item.baseUnit.dimension === "mass" ? "kg" : item.baseUnit.dimension === "volume" ? "l" : "1000 τεμ.", defaultVat: item.vatRate?.rate ?? 24 }));

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const ctx = await requireStockContext("orders.read");
  const query = await searchParams;
  const list = listParams(query, 25, ["number", "date", "total"]);
  const status = filterParam(query, "status", statusValues("purchaseOrder"));
  const [scoped, matchingSuppliers] = await Promise.all([
    db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true } }),
    partyIdsByName(ctx.orgId, list.q),
  ]);
  // αναζήτηση: αριθμός παραγγελίας ή όνομα προμηθευτή
  const where = {
    orgId: ctx.orgId, warehouseId: { in: scoped.map((w) => w.id) },
    ...(status ? { status } : {}),
    ...(list.q ? { OR: [{ number: { contains: list.q, mode: "insensitive" as const } }, { supplierId: { in: matchingSuppliers } }] } : {}),
  };
  const orderBy = list.sort === "total" ? [{ totalCents: list.dir }, { id: "desc" as const }] : list.sort === "number" ? [{ number: list.dir }] : [{ createdAt: list.sort === "date" ? list.dir : ("desc" as const) }, { id: "desc" as const }];
  const [orders, total, suppliers, warehouses, generics] = await Promise.all([
    db.purchaseOrder.findMany({ where, include: { _count: { select: { lines: true } } }, orderBy, skip: list.skip, take: list.take }),
    db.purchaseOrder.count({ where }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "supplier" }, active: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true }, include: { baseUnit: true, vatRate: true }, orderBy: { name: "asc" } }),
  ]);
  // τα ονόματα και ανενεργών προμηθευτών/αποθηκών: η γραμμή δεν δείχνει «—» επειδή κάποιος απενεργοποιήθηκε
  const [rowSuppliers, rowWarehouses] = await Promise.all([
    db.party.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set(orders.map((o) => o.supplierId))] } }, select: { id: true, name: true } }),
    db.warehouse.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set(orders.map((o) => o.warehouseId))] } }, select: { id: true, name: true } }),
  ]);
  const day = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens" });
  const supplierNames = new Map(rowSuppliers.map((s) => [s.id, s.name]));
  const warehouseNames = new Map(rowWarehouses.map((w) => [w.id, w.name]));
  const create = ctx.can("orders.add") ? <Modal wide size="sm" label={<><Plus /> Νέα παραγγελία</>} title="Νέα παραγγελία προμηθευτή"><form action={createOrder} className="grid gap-4"><div className="grid gap-3 sm:grid-cols-3"><Select label="Προμηθευτής" name="supplierId" required options={suppliers.map((s): [string, string] => [s.id, s.name])} /><Select label="Αποθήκη" name="warehouseId" required options={warehouses.map((w): [string, string] => [w.id, w.name])} /><Field label="Αναμενόμενη" name="expectedAt" type="date" /></div><OrderLinesEditor items={itemOptions(generics)} /><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default", "default", "justify-self-end")} pendingText="Δημιουργία…">Δημιουργία</Submit></form></Modal> : null;
  return (
    <Page section="Αποθήκη & αγορές" title="Παραγγελίες υλών" description="MRP, αγορές και μερικές παραλαβές με κοινό απόθεμα και κόστος" actions={<span className="flex gap-2"><Link href="/orders/mrp" className={btn("outline", "sm")}><Sparkles /> MRP</Link><Link href="/orders/rfqs" className={btn("outline", "sm")}><ClipboardList /> RFQ</Link>{create}</span>}>
      <div className="grid gap-4">
        {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
        <Card>
          <DataTable
            id="purchase-orders"
            listing={{ ...list, total, placeholder: "Αριθμός ή προμηθευτής", filters: [{ key: "status", label: "Κατάσταση", value: status, options: statusOptions("purchaseOrder") }] }}
            empty={<><p>Εδώ είναι οι παραγγελίες που στέλνεις στους προμηθευτές σου. Δεν έχεις καμία ακόμα.</p>{create ? <div className="mt-3 flex justify-center">{create}</div> : null}</>}
            columns={[
              { key: "number", label: "Αριθμός", required: true, sortable: true },
              { key: "date", label: "Ημερομηνία", sortable: true },
              { key: "supplier", label: "Προμηθευτής" },
              { key: "warehouse", label: "Αποθήκη" },
              { key: "lines", label: "Γραμμές", numeric: true },
              { key: "total", label: "Σύνολο", numeric: true, sortable: true },
              { key: "status", label: "Κατάσταση" },
            ]}
            rows={orders.map((order) => ({
              id: order.id,
              cells: {
                number: <Link className="font-semibold underline-offset-2 hover:underline" href={`/orders/${order.id}`}>{order.number}</Link>,
                date: day.format(order.createdAt),
                supplier: supplierNames.get(order.supplierId) ?? "—",
                warehouse: warehouseNames.get(order.warehouseId) ?? "—",
                lines: order._count.lines,
                total: euro(order.totalCents),
                status: <StatusBadge kind="purchaseOrder" value={order.status} />,
              },
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
