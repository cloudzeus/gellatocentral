import Link from "next/link";
import { FileText, ListOrdered, Plus, Route, Tags } from "lucide-react";
import { Modal } from "@/components/modal";
import { OrderLinesEditor } from "@/components/order-lines-editor";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { createWholesale } from "./actions";

const STATUS = { DRAFT: ["Πρόχειρη", "neutral"], CONFIRMED: ["Επιβεβαιωμένη", "warning"], DELIVERED: ["Παραδόθηκε", "success"], INVOICED: ["Τιμολογήθηκε", "success"], CANCELLED: ["Ακυρωμένη", "danger"] } as const;

export default async function WholesaleOrdersPage({ searchParams }: PageProps<"/wholesale-orders">) {
  const ctx = await requireStockContext("wholesale.read");
  const query = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, orderBy: { name: "asc" } });
  const warehouseIds = warehouses.map((row) => row.id);
  const [orders, customers, stores, generics] = await Promise.all([
    db.wholesaleOrder.findMany({ where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}) }, include: { lines: true }, orderBy: { createdAt: "desc" }, take: 150 }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "customer" }, active: true }, orderBy: { name: "asc" } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, include: { baseUnit: true, vatRate: true }, orderBy: { name: "asc" } }),
  ]);
  const customerIds = [...new Set(orders.map((order) => order.customerId))];
  const orderCustomers = await db.party.findMany({ where: { orgId: ctx.orgId, id: { in: customerIds } }, select: { id: true, name: true } });
  const customerNames = new Map(orderCustomers.map((row) => [row.id, row.name]));
  const warehouseNames = new Map(warehouses.map((row) => [row.id, row.name]));
  const items = generics.map((item) => ({ id: item.id, name: item.name, scale: stockCostScale(item.baseUnit.dimension), unitLabel: item.baseUnit.dimension === "mass" ? "kg" : item.baseUnit.dimension === "volume" ? "l" : "1000 τεμ.", defaultVat: item.vatRate?.rate ?? 24 }));
  return <Page section="Πελάτες & πωλήσεις" title="Παραγγελίες χονδρικής" description="Παραγγελίες, FEFO παράδοση και δρομολόγια με κοινό απόθεμα" actions={<span className="flex flex-wrap gap-2"><Link href="/wholesale-orders/quotes" className={btn("outline", "sm")}><FileText /> Προσφορές</Link><Link href="/wholesale-orders/pricelists" className={btn("outline", "sm")}><Tags /> Τιμοκατάλογοι</Link><Link href="/wholesale-orders/routes" className={btn("outline", "sm")}><Route /> Δρομολόγια</Link><Link href="/wholesale-orders/b2b" className={btn("outline", "sm")}><ListOrdered /> B2B</Link>{ctx.can("wholesale.add") ? <Modal wide label={<><Plus /> Νέα παραγγελία</>} title="Νέα παραγγελία χονδρικής"><form action={createWholesale} className="grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Select label="Πελάτης" name="customerId" required options={customers.map((row): [string, string] => [row.id, row.name])} /><Select label="Κατάστημα" name="storeId" required options={stores.map((row): [string, string] => [row.id, row.name])} /><Select label="Αποθήκη" name="warehouseId" required options={warehouses.map((row): [string, string] => [row.id, row.name])} /><Field label="Επιθυμητή παράδοση" name="neededAt" type="date" /></div><OrderLinesEditor items={items} /><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default", "default", "justify-self-end")}>Δημιουργία παραγγελίας</Submit></form></Modal> : null}</span>}>
    <div className="grid gap-4">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
      {typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}
      <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Αριθμός</th><th className="p-3">Πελάτης</th><th className="p-3">Αποθήκη</th><th className="p-3">Παράδοση</th><th className="p-3 text-right">Σύνολο</th><th className="p-3">Κατάσταση</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b border-border/60 last:border-0"><td className="p-3"><Link href={`/wholesale-orders/${order.id}`} className="font-semibold hover:underline">{order.number}</Link><span className="block text-xs text-muted-foreground">{order.source === "b2b" ? "B2B" : "Back office"} · {order.lines.length} γραμμές</span></td><td className="p-3">{customerNames.get(order.customerId) ?? "—"}</td><td className="p-3">{warehouseNames.get(order.warehouseId) ?? "—"}</td><td className="p-3">{order.neededAt ? new Intl.DateTimeFormat("el-GR").format(order.neededAt) : "—"}</td><td className="p-3 text-right font-semibold">{euro(order.totalCents)}</td><td className="p-3"><Badge tone={STATUS[order.status][1]}>{STATUS[order.status][0]}</Badge></td></tr>)}</tbody></table>{!orders.length ? <p className="p-8 text-center text-sm text-muted-foreground">Καμία παραγγελία χονδρικής ακόμη.</p> : null}</Card>
    </div>
  </Page>;
}
