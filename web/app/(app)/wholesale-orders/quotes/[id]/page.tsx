import Link from "next/link";
import { ArrowLeft, Check, Clock, FilePlus2, Pencil, Send, X } from "lucide-react";
import { DocumentPdfButton } from "@/components/document-output";
import { Modal } from "@/components/modal";
import { OrderLinesEditor } from "@/components/order-lines-editor";
import { PrintButton } from "@/components/print-button";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, DetailGrid, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { acceptQuote, convertQuote, expireQuote, rejectQuote, sendQuote, updateQuote } from "../actions";

const STATUS = {
  DRAFT: ["Πρόχειρη", "neutral"], SENT: ["Απεσταλμένη", "warning"],
  ACCEPTED: ["Αποδεκτή", "success"], REJECTED: ["Απορριφθείσα", "danger"], EXPIRED: ["Ληγμένη", "neutral"],
} as const;
const AUDIT: Record<string, string> = {
  "wholesale.quote.create": "Δημιουργία", "wholesale.quote.update": "Επεξεργασία πρόχειρης",
  "wholesale.quote.sent": "Σήμανση ως απεσταλμένη", "wholesale.quote.accepted": "Αποδοχή",
  "wholesale.quote.rejected": "Απόρριψη", "wholesale.quote.expired": "Καταχώριση λήξης",
  "wholesale.quote.convert": "Μετατροπή σε παραγγελία",
};
const dateValue = (value: Date | null) => value ? value.toISOString().slice(0, 16) : "";
const snapshotText = (snapshot: unknown, key: string) => {
  if (!snapshot || typeof snapshot !== "object") return "";
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
};

export default async function WholesaleQuotePage({ params, searchParams }: PageProps<"/wholesale-orders/quotes/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireStockContext("wholesale.read");
  const quote = await db.wholesaleQuote.findFirst({ where: { id, orgId: ctx.orgId }, include: { lines: true, order: { select: { id: true, number: true, status: true } } } });
  if (!quote) return <Page section="Πελάτες & πωλήσεις" title="Προσφορά χονδρικής"><p>Η προσφορά δεν βρέθηκε.</p></Page>;
  await requireStockContext("wholesale.read", { storeId: quote.storeId, warehouseId: quote.warehouseId });
  const [store, warehouse, org, customers, stores, warehouses, generics, history] = await Promise.all([
    db.store.findFirst({ where: { id: quote.storeId, orgId: ctx.orgId }, select: { name: true } }),
    db.warehouse.findFirst({ where: { id: quote.warehouseId, orgId: ctx.orgId }, select: { name: true } }),
    db.organization.findFirstOrThrow({ where: { id: ctx.orgId }, select: { name: true, legalName: true, vatNumber: true, address: true, city: true, postalCode: true } }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "customer" }, active: true }, orderBy: { name: "asc" } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, include: { baseUnit: true, vatRate: true }, orderBy: { name: "asc" } }),
    db.auditEvent.findMany({ where: { orgId: ctx.orgId, entityType: "wholesale_quote", entityId: quote.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const customerName = snapshotText(quote.customerSnapshot, "name") || "Πελάτης";
  const items = generics.map((item) => ({
    id: item.id, name: item.name, scale: stockCostScale(item.baseUnit.dimension),
    unitLabel: item.baseUnit.dimension === "mass" ? "kg" : item.baseUnit.dimension === "volume" ? "l" : "1000 τεμ.",
    defaultVat: item.vatRate?.rate ?? 24,
  }));
  return <Page section="Πελάτες & πωλήσεις" title={quote.number} description={`${customerName} · ${store?.name ?? "Κατάστημα"} · ${warehouse?.name ?? "Αποθήκη"}`} actions={<span className="flex flex-wrap gap-2"><Link href="/wholesale-orders/quotes" className={btn("outline", "sm")}><ArrowLeft /> Προσφορές</Link><DocumentPdfButton entityType="wholesale_quote" entityId={quote.id} /><PrintButton /></span>}>
    <div className="mx-auto grid max-w-5xl gap-4">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive print:hidden">{query.error}</p> : null}
      {typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink print:hidden">{query.saved}</p> : null}
      <Card className="p-5 print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4 print:border-black"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-black">{org.legalName || org.name} · ΑΦΜ {org.vatNumber}</p><h2 className="mt-1 text-xl font-bold">Προσφορά χονδρικής {quote.number}</h2><p className="mt-1 text-sm">Πελάτης: {customerName}{snapshotText(quote.customerSnapshot, "vatNumber") ? ` · ΑΦΜ ${snapshotText(quote.customerSnapshot, "vatNumber")}` : ""}</p>{snapshotText(quote.customerSnapshot, "address") ? <p className="text-sm text-muted-foreground print:text-black">{[snapshotText(quote.customerSnapshot, "address"), snapshotText(quote.customerSnapshot, "postalCode"), snapshotText(quote.customerSnapshot, "city")].filter(Boolean).join(", ")}</p> : null}</div><Badge tone={STATUS[quote.status][1]}>{STATUS[quote.status][0]}</Badge></div>
        <DetailGrid className="mt-4 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-6"><div><dt>Ισχύς έως</dt><dd>{new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short" }).format(quote.validUntil)}</dd></div><div><dt>Παράδοση</dt><dd>{quote.neededAt ? new Intl.DateTimeFormat("el-GR").format(quote.neededAt) : "—"}</dd></div><div><dt>Κατάστημα</dt><dd>{store?.name ?? "—"}</dd></div><div><dt>Καθαρή αξία</dt><dd>{euro(quote.netCents)}</dd></div><div><dt>ΦΠΑ</dt><dd>{euro(quote.vatCents)}</dd></div><div><dt>Σύνολο</dt><dd>{euro(quote.totalCents)}</dd></div></DetailGrid>
      </Card>
      {quote.note ? <Card className="whitespace-pre-wrap p-4 text-sm print:border-0 print:shadow-none">{quote.note}</Card> : null}
      <Card className="overflow-x-auto print:border-0 print:shadow-none"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground print:border-black print:text-black"><tr><th className="p-3">Είδος</th><th className="p-3 text-right">Ποσότητα</th><th className="p-3 text-right">Τιμή προ ΦΠΑ</th><th className="p-3 text-right">ΦΠΑ</th><th className="p-3 text-right">Καθαρή αξία</th></tr></thead><tbody>{quote.lines.map((line) => <tr key={line.id} className="border-b border-border/60 last:border-0 print:border-black"><td className="p-3 font-medium">{line.description}</td><td className="p-3 text-right">{(line.quantityBase / line.unitScale).toLocaleString("el-GR", { maximumFractionDigits: 6 })} {line.unitLabel}</td><td className="p-3 text-right">{euro(line.unitPriceCents)} / {line.unitLabel}</td><td className="p-3 text-right">{line.vatRate}%</td><td className="p-3 text-right">{euro(Math.round(line.quantityBase * line.unitPriceCents / line.unitScale))}</td></tr>)}</tbody></table></Card>
      {quote.rejectionReason ? <Card className="border-destructive/30 p-4 text-sm print:hidden"><strong>Αιτιολογία απόρριψης:</strong> {quote.rejectionReason}</Card> : null}
      {quote.order ? <Card className="flex flex-wrap items-center justify-between gap-3 p-4 print:hidden"><div><h2 className="font-semibold">Έχει μετατραπεί σε παραγγελία</h2><p className="text-sm text-muted-foreground">Η προσφορά παραμένει αποδεκτή και ο αριθμός/το ιστορικό της δεν άλλαξαν.</p></div><Link href={`/wholesale-orders/${quote.order.id}`} className={btn("outline")}>Παραγγελία {quote.order.number}</Link></Card> : null}
      {ctx.can("wholesale.edit") && quote.status === "DRAFT" ? <Card className="flex flex-wrap items-center justify-end gap-2 p-4 print:hidden"><Modal wide label={<><Pencil /> Επεξεργασία</>} title={`Επεξεργασία ${quote.number}`}><form action={updateQuote} className="grid gap-4"><input type="hidden" name="quoteId" value={quote.id} /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Select label="Πελάτης" name="customerId" required defaultValue={quote.customerId} options={customers.map((row): [string, string] => [row.id, row.name])} /><Select label="Κατάστημα" name="storeId" required defaultValue={quote.storeId} options={stores.map((row): [string, string] => [row.id, row.name])} /><Select label="Αποθήκη" name="warehouseId" required defaultValue={quote.warehouseId} options={warehouses.map((row): [string, string] => [row.id, row.name])} /><Field label="Ισχύς έως" name="validUntil" type="datetime-local" defaultValue={dateValue(quote.validUntil)} required /><Field label="Επιθυμητή παράδοση" name="neededAt" type="date" defaultValue={quote.neededAt?.toISOString().slice(0, 10)} /></div><OrderLinesEditor items={items} initialLines={quote.lines.map((line) => ({ genericItemId: line.genericItemId, quantity: String(line.quantityBase / line.unitScale), unitPrice: String(line.unitPriceCents / 100), vatRate: line.vatRate }))} /><TextareaField label="Σημείωση" name="note" defaultValue={quote.note ?? ""} maxLength={500} /><Submit className={btn("default", "default", "justify-self-end")}>Αποθήκευση αλλαγών</Submit></form></Modal><form action={sendQuote}><input type="hidden" name="quoteId" value={quote.id} /><Submit className={btn("default")}><Send /> Σήμανση ως απεσταλμένη</Submit></form></Card> : null}
      {ctx.can("wholesale.edit") && quote.status === "SENT" ? <Card className="flex flex-wrap items-end justify-end gap-2 p-4 print:hidden"><form action={acceptQuote}><input type="hidden" name="quoteId" value={quote.id} /><Submit className={btn("success")}><Check /> Αποδοχή</Submit></form><form action={rejectQuote} className="flex flex-wrap items-end gap-2"><input type="hidden" name="quoteId" value={quote.id} /><Field label="Αιτιολογία απόρριψης" name="reason" required minLength={3} maxLength={300} /><Submit className={btn("destructive")}><X /> Απόρριψη</Submit></form>{quote.validUntil <= new Date() ? <form action={expireQuote}><input type="hidden" name="quoteId" value={quote.id} /><Submit className={btn("outline")}><Clock /> Καταχώριση λήξης</Submit></form> : null}</Card> : null}
      {ctx.can("wholesale.edit") && quote.status === "ACCEPTED" && !quote.order ? <Card className="flex flex-wrap items-center justify-between gap-3 p-4 print:hidden"><div><h2 className="font-semibold">Μετατροπή σε παραγγελία</h2><p className="text-sm text-muted-foreground">Αντιγράφονται οι παγωμένες τιμές/ΦΠΑ. Η παραγγελία μένει πρόχειρη, χωρίς αυτόματη επιβεβαίωση, παράδοση ή τιμολόγηση.</p></div><form action={convertQuote}><input type="hidden" name="quoteId" value={quote.id} /><Submit className={btn("default")}><FilePlus2 /> Μετατροπή</Submit></form></Card> : null}
      <Card className="p-4 print:hidden"><h2 className="mb-3 font-semibold">Ιστορικό</h2><ol className="grid gap-3">{history.map((event) => <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3 text-sm last:border-0 last:pb-0"><span><strong>{AUDIT[event.action] ?? event.action}</strong><span className="ml-2 text-muted-foreground">{event.actorName}</span>{event.reason ? <span className="block text-muted-foreground">{event.reason}</span> : null}</span><time className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short" }).format(event.createdAt)}</time></li>)}</ol></Card>
    </div>
  </Page>;
}
