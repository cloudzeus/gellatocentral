import Link from "next/link";
import { ArrowLeft, Check, FilePlus2, Truck, X } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, DetailGrid, Field, Page, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { cancelWholesale, confirmWholesale, deliverWholesale, invoiceWholesale } from "../actions";

const STATUS = { DRAFT: "Πρόχειρη", CONFIRMED: "Επιβεβαιωμένη", DELIVERED: "Παραδόθηκε", INVOICED: "Τιμολογήθηκε", CANCELLED: "Ακυρωμένη" } as const;
const dateValue = (value: Date | null) => value ? value.toISOString().slice(0, 16) : "";

export default async function WholesaleOrderPage({ params, searchParams }: PageProps<"/wholesale-orders/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireStockContext("wholesale.read");
  const order = await db.wholesaleOrder.findFirst({ where: { id, orgId: ctx.orgId }, include: { lines: true, quote: { select: { id: true, number: true } }, documents: { orderBy: { createdAt: "desc" } } } });
  if (!order) return <Page section="Πελάτες & πωλήσεις" title="Παραγγελία χονδρικής"><p>Η παραγγελία δεν βρέθηκε.</p></Page>;
  await requireStockContext("wholesale.read", { storeId: order.storeId, warehouseId: order.warehouseId });
  const [customer, store, warehouse, generics, deliveryStop] = await Promise.all([
    db.party.findFirst({ where: { id: order.customerId, orgId: ctx.orgId } }),
    db.store.findFirst({ where: { id: order.storeId, orgId: ctx.orgId }, select: { name: true } }),
    db.warehouse.findFirst({ where: { id: order.warehouseId, orgId: ctx.orgId }, select: { name: true } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: order.lines.map((line) => line.genericItemId) } }, include: { baseUnit: true } }),
    db.deliveryStop.findFirst({ where: { orgId: ctx.orgId, orderId: order.id } }),
  ]);
  const items = new Map(generics.map((item) => [item.id, item]));
  const delivery = order.documents.find((document) => document.docType === "9.3" && document.status === "ISSUED");
  const invoice = order.documents.find((document) => document.docType === "1.1" && document.status === "ISSUED");
  return <Page section="Πελάτες & πωλήσεις" title={order.number} description={`${customer?.name ?? "Πελάτης"} · ${store?.name ?? "Κατάστημα"} · ${warehouse?.name ?? "Αποθήκη"}`} actions={<Link href="/wholesale-orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>}>
    <div className="grid gap-4">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
      {typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}
      <Card className="p-4"><DetailGrid className="sm:grid-cols-5"><div><dt>Κατάσταση</dt><dd><Badge tone={order.status === "CANCELLED" ? "danger" : ["DELIVERED", "INVOICED"].includes(order.status) ? "success" : "warning"}>{STATUS[order.status]}</Badge></dd></div><div><dt>Πηγή</dt><dd>{order.quote ? <Link href={`/wholesale-orders/quotes/${order.quote.id}`} className="hover:underline">Προσφορά {order.quote.number}</Link> : order.source === "b2b" ? "B2B portal" : "Back office"}</dd></div><div><dt>Καθαρή αξία</dt><dd>{euro(order.netCents)}</dd></div><div><dt>ΦΠΑ</dt><dd>{euro(order.vatCents)}</dd></div><div><dt>Σύνολο</dt><dd>{euro(order.totalCents)}</dd></div></DetailGrid></Card>
      {order.note ? <Card className="whitespace-pre-wrap p-4 text-sm">{order.note}</Card> : null}
      <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Είδος</th><th className="p-3 text-right">Ποσότητα</th><th className="p-3 text-right">Τιμή μονάδας</th><th className="p-3 text-right">ΦΠΑ</th></tr></thead><tbody>{order.lines.map((line) => { const item = items.get(line.genericItemId); const dimension = item?.baseUnit.dimension ?? "count"; return <tr key={line.id} className="border-b border-border/60 last:border-0"><td className="p-3 font-medium">{item?.name ?? "Είδος"}</td><td className="p-3 text-right">{(line.quantityBase / stockCostScale(dimension)).toLocaleString("el-GR", { maximumFractionDigits: 6 })} {dimension === "mass" ? "kg" : dimension === "volume" ? "l" : "1000 τεμ."}</td><td className="p-3 text-right">{euro(line.unitPriceCents)}</td><td className="p-3 text-right">{line.vatRate}%</td></tr>; })}</tbody></table></Card>
      {order.documents.length ? <Card className="p-4"><h2 className="mb-3 font-semibold">Παραστατικά</h2><div className="grid gap-2">{order.documents.map((document) => <Link key={document.id} href={`/invoices/${document.id}`} className="flex items-center justify-between rounded-lg border border-border/70 p-3 text-sm hover:bg-secondary/60"><span>{document.docType} · {document.series}-{document.aa}<span className="ml-2 text-muted-foreground">{document.status === "CANCELLED" ? "Ακυρωμένο" : "Ενεργό"}</span></span><strong>{euro(document.totalCents)}</strong></Link>)}</div></Card> : null}
      {ctx.can("wholesale.edit") && order.status === "DRAFT" ? <Card className="flex flex-wrap items-end justify-end gap-2 p-4"><form action={confirmWholesale}><input type="hidden" name="orderId" value={order.id} /><Submit className={btn("success")}><Check /> Επιβεβαίωση</Submit></form><form action={cancelWholesale} className="flex flex-wrap items-end gap-2"><input type="hidden" name="orderId" value={order.id} /><Field label="Αιτιολογία ακύρωσης" name="reason" required minLength={3} maxLength={300} /><Submit className={btn("destructive")}><X /> Ακύρωση</Submit></form></Card> : null}
      {ctx.can("wholesale.edit") && order.status === "CONFIRMED" ? <Card className="p-4"><h2 className="mb-3 font-semibold">Παράδοση και FEFO έξοδος</h2><form action={deliverWholesale} className="grid items-end gap-3 md:grid-cols-3"><input type="hidden" name="orderId" value={order.id} />{deliveryStop ? <input type="hidden" name="stopId" value={deliveryStop.id} /> : null}<Field label="Σειρά δελτίου 9.3" name="series" defaultValue="ΔΑ" required maxLength={30} /><Field label="Ημερομηνία παράδοσης" name="deliveredAt" type="datetime-local" required /><Field label="Παραλήπτης" name="recipientName" defaultValue={deliveryStop ? customer?.name ?? "" : ""} maxLength={120} /><div className="md:col-span-2"><TextareaField label="Απόδειξη / σημείωση παράδοσης" name="proofNote" maxLength={500} /></div><Submit className={btn("success")}><Truck /> Ολοκλήρωση παράδοσης</Submit></form></Card> : null}
      {ctx.can("wholesale.edit") && order.status === "CONFIRMED" ? <form action={cancelWholesale} className="flex flex-wrap items-end justify-end gap-2"><input type="hidden" name="orderId" value={order.id} /><Field label="Αιτιολογία ακύρωσης" name="reason" required minLength={3} maxLength={300} /><Submit className={btn("destructive")}><X /> Ακύρωση παραγγελίας</Submit></form> : null}
      {ctx.can("invoices.add") && order.status === "DELIVERED" && delivery && !invoice ? <Card className="p-4"><h2 className="mb-3 font-semibold">Έκδοση τιμολογίου 1.1</h2><p className="mb-3 text-sm text-muted-foreground">Αντιγράφονται οι παρτίδες της παράδοσης· δεν ξαναχρεώνεται το απόθεμα.</p><form action={invoiceWholesale} className="grid items-end gap-3 md:grid-cols-4"><input type="hidden" name="orderId" value={order.id} /><Field label="Σειρά τιμολογίου" name="series" defaultValue="ΤΙΜ" required maxLength={30} /><Field label="Ημερομηνία έκδοσης" name="issuedAt" type="datetime-local" defaultValue={dateValue(new Date())} required /><Field label="Εξόφληση έως" name="dueAt" type="date" /><Submit className={btn("default")}><FilePlus2 /> Έκδοση τιμολογίου</Submit></form></Card> : null}
    </div>
  </Page>;
}
