import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { newDeliveryRoute } from "../actions";

export default async function DeliveryRoutesPage({ searchParams }: PageProps<"/wholesale-orders/routes">) {
  const ctx = await requireStockContext("wholesale.read");
  const query = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true } });
  const scope = { orgId: ctx.orgId, warehouseId: { in: warehouses.map((row) => row.id) }, ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}) };
  const scopedOrders = await db.wholesaleOrder.findMany({ where: scope, select: { id: true } });
  const scopedOrderIds = scopedOrders.map((order) => order.id);
  const [routes, confirmedOrders, stores, existingStops] = await Promise.all([
    db.deliveryRoute.findMany({ where: { orgId: ctx.orgId, stops: { some: { orderId: { in: scopedOrderIds } } } }, include: { stops: { orderBy: { position: "asc" } } }, orderBy: { plannedFor: "desc" }, take: 100 }),
    db.wholesaleOrder.findMany({ where: { ...scope, status: "CONFIRMED" }, orderBy: { neededAt: "asc" } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) }, orderBy: { name: "asc" } }),
    db.deliveryStop.findMany({ where: { orgId: ctx.orgId }, select: { orderId: true } }),
  ]);
  const routedOrderIds = new Set(existingStops.map((stop) => stop.orderId));
  const orders = confirmedOrders.filter((order) => !routedOrderIds.has(order.id));
  const routeOrderIds = routes.flatMap((route) => route.stops.map((stop) => stop.orderId));
  const routeOrders = await db.wholesaleOrder.findMany({ where: { orgId: ctx.orgId, id: { in: routeOrderIds } } });
  const orderById = new Map(routeOrders.map((order) => [order.id, order]));
  const partyIds = [...new Set([...orders.map((order) => order.customerId), ...routeOrders.map((order) => order.customerId)])];
  const parties = await db.party.findMany({ where: { orgId: ctx.orgId, id: { in: partyIds } }, select: { id: true, name: true } });
  const names = new Map(parties.map((party) => [party.id, party.name]));
  const storeOptions: [string, string][] = [...(ctx.storeIds.length || ctx.warehouseIds.length ? [] : [["", "Όλα τα καταστήματα"] as [string, string]]), ...stores.map((row): [string, string] => [row.id, row.name])];
  return <Page section="Πελάτες & πωλήσεις" title="Δρομολόγια παράδοσης" description="Στάσεις, απόδειξη παράδοσης και αυτόματη ολοκλήρωση δρομολογίου" actions={<span className="flex gap-2"><Link href="/wholesale-orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>{ctx.can("wholesale.edit") ? <Modal label={<><Plus /> Νέο δρομολόγιο</>} title="Νέο δρομολόγιο"><form action={newDeliveryRoute} className="grid gap-3"><Field label="Όνομα" name="name" required maxLength={120} /><Select label="Κατάστημα" name="storeId" options={storeOptions} /><Field label="Προγραμματισμένη ημερομηνία" name="plannedFor" type="datetime-local" required /><Field label="Οδηγός" name="driverName" maxLength={120} /><fieldset className="grid gap-2"><legend className="text-sm font-medium">Επιβεβαιωμένες παραγγελίες</legend>{orders.map((order) => <label key={order.id} className="flex items-center gap-2 rounded-lg border border-border/70 p-2 text-sm"><input className="size-4" type="checkbox" name="orderIds" value={order.id} />{order.number} · {names.get(order.customerId) ?? "Πελάτης"}</label>)}{!orders.length ? <p className="text-sm text-muted-foreground">Δεν υπάρχουν διαθέσιμες παραγγελίες.</p> : null}</fieldset><Submit className={btn("default")}>Δημιουργία δρομολογίου</Submit></form></Modal> : null}</span>}>
    <div className="grid gap-4">{typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}{typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}{routes.map((route) => <Card key={route.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{route.name}</h2><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(route.plannedFor)} · {route.driverName ?? "Χωρίς οδηγό"}</p></div><Badge tone={route.status === "COMPLETED" ? "success" : "warning"}>{route.status === "COMPLETED" ? "Ολοκληρωμένο" : "Προγραμματισμένο"}</Badge></div><ol className="mt-3 grid gap-2">{route.stops.map((stop) => { const stopOrder = orderById.get(stop.orderId); return <li key={stop.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/50 p-3 text-sm"><span>{stop.position}. <Link className="font-medium underline" href={`/wholesale-orders/${stop.orderId}`}>{stopOrder?.number ?? "Παραγγελία"}</Link> · {stopOrder ? names.get(stopOrder.customerId) : "—"}</span><span>{stop.deliveredAt ? `Παραδόθηκε σε ${stop.recipientName ?? "παραλήπτη"}` : "Εκκρεμεί"}</span></li>; })}</ol></Card>)}{!routes.length ? <Card className="p-8 text-center text-sm text-muted-foreground">Δεν υπάρχουν δρομολόγια.</Card> : null}</div>
  </Page>;
}
