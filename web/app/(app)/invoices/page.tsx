import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { outstandingCents } from "@/lib/wholesale";

const TYPE = { "1.1": "Τιμολόγιο", "5.1": "Πιστωτικό", "9.3": "Δελτίο παράδοσης" } as const;

export default async function InvoicesPage() {
  const ctx = await requireStockContext("invoices.read");
  const warehouses = await db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true, name: true } });
  const documents = await db.salesDocument.findMany({
    where: { orgId: ctx.orgId, warehouseId: { in: warehouses.map((row) => row.id) }, ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}) },
    include: { allocations: true, order: { select: { number: true } } }, orderBy: { issuedAt: "desc" }, take: 200,
  });
  const customers = await db.party.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set(documents.map((document) => document.customerId))] } }, select: { id: true, name: true } });
  const names = new Map(customers.map((customer) => [customer.id, customer.name]));
  return <Page section="Πελάτες & πωλήσεις" title="Παραστατικά χονδρικής" description="Τιμολόγια, πιστωτικά και δελτία παράδοσης με ανεξόφλητα και myDATA ιστορικό" actions={<Link href="/wholesale-orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>}>
    <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Παραστατικό</th><th className="p-3">Πελάτης / παραγγελία</th><th className="p-3">Ημερομηνία</th><th className="p-3 text-right">Σύνολο</th><th className="p-3 text-right">Ανεξόφλητο</th><th className="p-3">Κατάσταση</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id} className="border-b border-border/60 last:border-0"><td className="p-3"><Link href={`/invoices/${document.id}`} className="font-semibold hover:underline">{document.series}-{document.aa}</Link><span className="block text-xs text-muted-foreground">{TYPE[document.docType as keyof typeof TYPE] ?? document.docType}</span></td><td className="p-3">{names.get(document.customerId) ?? "—"}<Link href={`/wholesale-orders/${document.orderId}`} className="block text-xs text-muted-foreground hover:underline">{document.order.number}</Link></td><td className="p-3">{new Intl.DateTimeFormat("el-GR").format(document.issuedAt)}</td><td className="p-3 text-right font-semibold">{euro(document.totalCents)}</td><td className="p-3 text-right">{document.docType === "1.1" ? euro(outstandingCents(document, document.allocations)) : "—"}</td><td className="p-3"><Badge tone={document.status === "CANCELLED" ? "danger" : "success"}>{document.status === "CANCELLED" ? "Ακυρωμένο" : "Ενεργό"}</Badge></td></tr>)}</tbody></table>{!documents.length ? <p className="p-8 text-center text-sm text-muted-foreground">Δεν έχουν εκδοθεί παραστατικά χονδρικής.</p> : null}</Card>
  </Page>;
}
