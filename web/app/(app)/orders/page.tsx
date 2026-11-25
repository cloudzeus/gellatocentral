import Link from "next/link";
import { ClipboardList, Plus, Sparkles } from "lucide-react";
import { Modal } from "@/components/modal";
import { OrderLinesEditor } from "@/components/order-lines-editor";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { createOrder } from "./actions";

const STATUS = { DRAFT: ["Πρόχειρο", "neutral"], SENT: ["Στάλθηκε", "warning"], PARTIAL: ["Μερική παραλαβή", "warning"], RECEIVED: ["Παραλήφθηκε", "success"], CANCELLED: ["Ακυρωμένο", "danger"] } as const;
const itemOptions = (items: { id: string; name: string; baseUnit: { dimension: string }; vatRate: { rate: number } | null }[]) => items.map((item) => ({ id: item.id, name: item.name, scale: stockCostScale(item.baseUnit.dimension), unitLabel: item.baseUnit.dimension === "mass" ? "kg" : item.baseUnit.dimension === "volume" ? "l" : "1000 τεμ.", defaultVat: item.vatRate?.rate ?? 24 }));

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const ctx = await requireStockContext("orders.read");
  const query = await searchParams;
  const [orders, suppliers, warehouses, generics] = await Promise.all([
    db.purchaseOrder.findMany({ where: { orgId: ctx.orgId, AND: [{ warehouseId: { in: (await db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true } })).map((w) => w.id) } }] }, include: { lines: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "supplier" }, active: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true }, include: { baseUnit: true, vatRate: true }, orderBy: { name: "asc" } }),
  ]);
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));
  const warehouseNames = new Map(warehouses.map((w) => [w.id, w.name]));
  return (
    <Page section="Αποθήκη & αγορές" title="Παραγγελίες υλών" description="MRP, αγορές και μερικές παραλαβές με κοινό απόθεμα και κόστος" actions={<span className="flex gap-2"><Link href="/orders/mrp" className={btn("outline", "sm")}><Sparkles /> MRP</Link><Link href="/orders/rfqs" className={btn("outline", "sm")}><ClipboardList /> RFQ</Link>{ctx.can("orders.add") ? <Modal wide size="sm" label={<><Plus /> Νέα παραγγελία</>} title="Νέα παραγγελία προμηθευτή"><form action={createOrder} className="grid gap-4"><div className="grid gap-3 sm:grid-cols-3"><Select label="Προμηθευτής" name="supplierId" required options={suppliers.map((s): [string, string] => [s.id, s.name])} /><Select label="Αποθήκη" name="warehouseId" required options={warehouses.map((w): [string, string] => [w.id, w.name])} /><Field label="Αναμενόμενη" name="expectedAt" type="date" /></div><OrderLinesEditor items={itemOptions(generics)} /><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default", "default", "justify-self-end")} pendingText="Δημιουργία…">Δημιουργία</Submit></form></Modal> : null}</span>}>
      <div className="grid gap-4">
        {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
        <Card className="overflow-x-auto">
          <table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Αριθμός</th><th className="p-3">Προμηθευτής</th><th className="p-3">Αποθήκη</th><th className="p-3">Γραμμές</th><th className="p-3 text-right">Σύνολο</th><th className="p-3">Κατάσταση</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b border-border/60 last:border-0"><td className="p-3"><Link className="font-semibold hover:underline" href={`/orders/${order.id}`}>{order.number}</Link><span className="block text-xs text-muted-foreground">{new Intl.DateTimeFormat("el-GR").format(order.createdAt)}</span></td><td className="p-3">{supplierNames.get(order.supplierId) ?? "—"}</td><td className="p-3">{warehouseNames.get(order.warehouseId) ?? "—"}</td><td className="p-3">{order.lines.length}</td><td className="p-3 text-right font-semibold">{euro(order.totalCents)}</td><td className="p-3"><Badge tone={STATUS[order.status][1]}>{STATUS[order.status][0]}</Badge></td></tr>)}</tbody></table>
          {!orders.length ? <p className="p-8 text-center text-sm text-muted-foreground">Καμία παραγγελία ακόμα.</p> : null}
        </Card>
      </div>
    </Page>
  );
}
