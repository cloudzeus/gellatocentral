import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { DocumentPdfButton } from "@/components/document-output";
import { Modal } from "@/components/modal";
import { OrderLinesEditor } from "@/components/order-lines-editor";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { createQuote } from "./actions";

const STATUS = {
  DRAFT: ["Πρόχειρη", "neutral"], SENT: ["Απεσταλμένη", "warning"],
  ACCEPTED: ["Αποδεκτή", "success"], REJECTED: ["Απορριφθείσα", "danger"], EXPIRED: ["Ληγμένη", "neutral"],
} as const;

export default async function WholesaleQuotesPage({ searchParams }: PageProps<"/wholesale-orders/quotes">) {
  const ctx = await requireStockContext("wholesale.read");
  const query = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, orderBy: { name: "asc" } });
  const [quotes, parties, stores, generics] = await Promise.all([
    db.wholesaleQuote.findMany({
      where: {
        orgId: ctx.orgId, warehouseId: { in: warehouses.map((row) => row.id) },
        ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}),
      },
      include: { lines: true, order: { select: { id: true, number: true } } },
      orderBy: { createdAt: "desc" }, take: 150,
    }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "customer" } }, orderBy: { name: "asc" } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, include: { baseUnit: true, vatRate: true }, orderBy: { name: "asc" } }),
  ]);
  const customers = parties.filter((party) => party.active);
  const customerNames = new Map(parties.map((row) => [row.id, row.name]));
  const warehouseNames = new Map(warehouses.map((row) => [row.id, row.name]));
  const items = generics.map((item) => ({
    id: item.id, name: item.name, scale: stockCostScale(item.baseUnit.dimension),
    unitLabel: item.baseUnit.dimension === "mass" ? "kg" : item.baseUnit.dimension === "volume" ? "l" : "1000 τεμ.",
    defaultVat: item.vatRate?.rate ?? 24,
  }));
  return <Page section="Πελάτες & πωλήσεις" title="Προσφορές χονδρικής" description="Προσφορές με παγωμένες τιμές και ΦΠΑ, απόφαση πελάτη και μετατροπή σε πρόχειρη παραγγελία" actions={<span className="flex flex-wrap gap-2"><Link href="/wholesale-orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>{ctx.can("wholesale.add") ? <Modal wide label={<><Plus /> Νέα προσφορά</>} title="Νέα προσφορά χονδρικής"><form action={createQuote} className="grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Select label="Πελάτης" name="customerId" required options={customers.map((row): [string, string] => [row.id, row.name])} /><Select label="Κατάστημα" name="storeId" required options={stores.map((row): [string, string] => [row.id, row.name])} /><Select label="Αποθήκη" name="warehouseId" required options={warehouses.map((row): [string, string] => [row.id, row.name])} /><Field label="Ισχύς έως" name="validUntil" type="datetime-local" required /><Field label="Επιθυμητή παράδοση" name="neededAt" type="date" /></div><OrderLinesEditor items={items} /><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default", "default", "justify-self-end")}>Δημιουργία πρόχειρης προσφοράς</Submit></form></Modal> : null}</span>}>
    <div className="grid gap-4">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
      {typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}
      <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Αριθμός</th><th className="p-3">Πελάτης</th><th className="p-3">Αποθήκη</th><th className="p-3">Ισχύς έως</th><th className="p-3 text-right">Σύνολο</th><th className="p-3">Κατάσταση</th><th className="p-3">Παραγγελία</th><th className="p-3">Έντυπο</th></tr></thead><tbody>{quotes.map((quote) => <tr key={quote.id} className="border-b border-border/60 last:border-0"><td className="p-3"><Link href={`/wholesale-orders/quotes/${quote.id}`} className="font-semibold hover:underline">{quote.number}</Link><span className="block text-xs text-muted-foreground">{quote.lines.length} γραμμές</span></td><td className="p-3">{customerNames.get(quote.customerId) ?? "—"}</td><td className="p-3">{warehouseNames.get(quote.warehouseId) ?? "—"}</td><td className="p-3">{new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short" }).format(quote.validUntil)}</td><td className="p-3 text-right font-semibold">{euro(quote.totalCents)}</td><td className="p-3"><Badge tone={STATUS[quote.status][1]}>{STATUS[quote.status][0]}</Badge></td><td className="p-3">{quote.order ? <Link href={`/wholesale-orders/${quote.order.id}`} className="hover:underline">{quote.order.number}</Link> : "—"}</td><td className="p-3"><DocumentPdfButton entityType="wholesale_quote" entityId={quote.id} /></td></tr>)}</tbody></table>{!quotes.length ? <p className="p-8 text-center text-sm text-muted-foreground">Καμία προσφορά χονδρικής ακόμη.</p> : null}</Card>
    </div>
  </Page>;
}
