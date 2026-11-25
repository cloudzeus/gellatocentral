import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowLeft, Check, Send, X } from "lucide-react";
import { DocumentPdfButton } from "@/components/document-output";
import { PurchaseInvoiceMatch } from "@/components/purchase-invoice-match";
import { PurchaseReceiptReview } from "@/components/purchase-receipt-review";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, DetailGrid, Field, Page, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { cancelOrder, invoiceReceipt, receiveOrder, reverseReceipt, reviewInvoiceReceipt, reviewReceipt, sendOrder } from "../actions";

const STATUS = { DRAFT: "Πρόχειρο", SENT: "Στάλθηκε", PARTIAL: "Μερική παραλαβή", RECEIVED: "Παραλήφθηκε", CANCELLED: "Ακυρωμένο" } as const;
const displayQty = (quantity: number, dimension: string) => new Intl.NumberFormat("el-GR", { maximumFractionDigits: 6 }).format(quantity / stockCostScale(dimension));
const unit = (dimension: string) => dimension === "mass" ? "kg" : dimension === "volume" ? "l" : "1000 τεμ.";
const amount = (cents: number) => (cents / 100).toFixed(2);

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireStockContext("orders.read");
  const order = await db.purchaseOrder.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { lines: true, receipts: { include: { lines: true, discrepancies: true, invoiceDiscrepancies: true } } },
  });
  if (!order) return <Page section="Αποθήκη & αγορές" title="Παραγγελία"><p>Η παραγγελία δεν βρέθηκε.</p></Page>;
  await requireStockContext("orders.read", { warehouseId: order.warehouseId });
  const [supplier, warehouse, generics] = await Promise.all([
    db.party.findFirst({ where: { id: order.supplierId, orgId: ctx.orgId } }),
    db.warehouse.findFirst({ where: { id: order.warehouseId, orgId: ctx.orgId } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: order.lines.map((line) => line.genericItemId) } }, include: { baseUnit: true } }),
  ]);
  const items = new Map(generics.map((item) => [item.id, item]));
  const orderLines = new Map(order.lines.map((line) => [line.id, line]));

  return (
    <Page section="Αποθήκη & αγορές" title={order.number} description={`${supplier?.name ?? "Προμηθευτής"} · ${warehouse?.name ?? "Αποθήκη"}`} actions={<span className="flex flex-wrap gap-2"><DocumentPdfButton entityType="purchase_order" entityId={order.id} /><Link href="/orders" className={btn("outline", "sm")}><ArrowLeft /> Πίσω</Link></span>}>
      <div className="grid gap-4">
        {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
        {typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}
        <Card className="p-4"><DetailGrid className="sm:grid-cols-4"><div><dt>Κατάσταση</dt><dd><Badge tone={order.status === "RECEIVED" ? "success" : order.status === "CANCELLED" ? "danger" : "warning"}>{STATUS[order.status]}</Badge></dd></div><div><dt>Καθαρή αξία</dt><dd>{euro(order.netCents)}</dd></div><div><dt>ΦΠΑ</dt><dd>{euro(order.vatCents)}</dd></div><div><dt>Σύνολο</dt><dd>{euro(order.totalCents)}</dd></div></DetailGrid></Card>
        <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Είδος</th><th className="p-3 text-right">Παραγγελία</th><th className="p-3 text-right">Παραλήφθηκε</th><th className="p-3 text-right">Τιμή</th><th className="p-3 text-right">ΦΠΑ</th></tr></thead><tbody>{order.lines.map((line) => {
          const item = items.get(line.genericItemId)!;
          return <tr key={line.id} className="border-b border-border/60 last:border-0"><td className="p-3 font-medium">{item.name}</td><td className="p-3 text-right">{displayQty(line.orderedBaseQty, item.baseUnit.dimension)} {unit(item.baseUnit.dimension)}</td><td className="p-3 text-right">{displayQty(line.receivedBaseQty, item.baseUnit.dimension)} {unit(item.baseUnit.dimension)}</td><td className="p-3 text-right">{euro(line.unitPriceCents)}</td><td className="p-3 text-right">{line.vatRate}%</td></tr>;
        })}</tbody></table></Card>

        {ctx.can("orders.edit") && order.status === "DRAFT" ? <div className="flex flex-wrap justify-end gap-2"><form action={sendOrder}><input type="hidden" name="orderId" value={order.id} /><Submit className={btn("default")} pendingText="Καταγραφή…"><Send /> Καταγραφή αποστολής</Submit></form><form action={cancelOrder} className="flex gap-2"><input type="hidden" name="orderId" value={order.id} /><Field label="Αιτιολογία ακύρωσης" name="reason" required maxLength={300} /><Submit className={btn("destructive")} pendingText="Ακύρωση…"><X /> Ακύρωση</Submit></form></div> : null}

        {ctx.can("orders.edit") && ["SENT", "PARTIAL"].includes(order.status) ? <Card className="p-4"><h2 className="mb-3 font-semibold">Νέα παραλαβή</h2><form action={receiveOrder} className="grid gap-3"><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="clientKey" value={randomUUID()} />{order.lines.filter((line) => line.receivedBaseQty < line.orderedBaseQty).map((line) => {
          const item = items.get(line.genericItemId)!;
          const remaining = line.orderedBaseQty - line.receivedBaseQty;
          return <div key={line.id} className="grid items-end gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-4"><p className="text-sm font-medium">{item.name}<span className="block text-xs text-muted-foreground">Υπόλοιπο {displayQty(remaining, item.baseUnit.dimension)} {unit(item.baseUnit.dimension)} · ποσότητα σε βασικές μονάδες</span></p><Field label={`Ποσότητα (${item.baseUnit.code})`} name={`receipt:${line.id}`} type="number" min={0} max={remaining} step={1} defaultValue={remaining} required /><Field label="Παρτίδα" name={`batch:${line.id}`} maxLength={80} /><Field label="Λήξη" name={`expiry:${line.id}`} type="date" /></div>;
        })}<Submit className={btn("success", "default", "justify-self-end")} pendingText="Καταχώριση αποθέματος…"><Check /> Καταχώριση παραλαβής</Submit></form></Card> : null}

        {order.receipts.length ? <Card className="p-4"><h2 className="mb-2 font-semibold">Ιστορικό παραλαβών</h2><ul className="grid gap-3 text-sm">{order.receipts.map((receipt) => <li key={receipt.id} className="grid gap-3 border-b border-border/60 pb-4 last:border-0">
          <div className="flex flex-wrap items-center justify-between gap-2"><span>{new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(receipt.createdAt)}{receipt.reversedAt ? " · αναιρέθηκε" : ""}</span><span className="flex gap-3"><Link href={`/purchases/${receipt.purchaseDocId}`} className="underline">Παραστατικό παραλαβής</Link>{receipt.invoiceDocId ? <Link href={`/purchases/${receipt.invoiceDocId}`} className="underline">Συνδεδεμένο τιμολόγιο</Link> : null}</span></div>
          <PurchaseReceiptReview reviewStatus={receipt.reviewStatus} reviewedAt={receipt.reviewedAt} reviewedByName={receipt.reviewedByName} reviewNote={receipt.reviewNote} discrepancies={receipt.discrepancies} />
          {ctx.can("orders.edit") && receipt.reviewStatus !== "REVIEWED" && !receipt.reversedAt ? <form action={reviewReceipt} className="grid items-end gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[1fr_auto]"><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="receiptId" value={receipt.id} /><TextareaField label="Σχόλιο τιμολογιακού ελέγχου" name="note" required={receipt.discrepancies.length > 0} minLength={receipt.discrepancies.length ? 3 : undefined} maxLength={500} placeholder={receipt.discrepancies.length ? "Αιτιολόγησε την αποδοχή των ασυμφωνιών" : "Προαιρετικό σχόλιο"} /><Submit className={btn("default", "sm")} pendingText="Αποδοχή…">Αποδοχή ελέγχου</Submit></form> : null}

          {ctx.can("orders.edit") && receipt.reviewStatus === "REVIEWED" && !receipt.reversedAt && !receipt.invoiceDocId ? <form action={invoiceReceipt} className="grid gap-4 rounded-lg bg-muted/40 p-3">
            <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="receiptId" value={receipt.id} />
            <div><h3 className="text-sm font-semibold">Πραγματικό τιμολόγιο & τριπλός έλεγχος</h3><p className="text-xs text-muted-foreground">Καταχώρισε κάθε γραμμή όπως τιμολογήθηκε. Ποσότητα σε base units και τιμή προ εκπτώσεως ανά kg/l/1.000 τεμ. Μία παραλαβή συνδέεται με ένα μόνο τιμολόγιο.</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Αριθμός τιμολογίου προμηθευτή" name="number" required maxLength={100} /><Field label="Ημερομηνία έκδοσης" name="issuedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
            {receipt.lines.map((line) => {
              const item = items.get(line.genericItemId)!;
              const ordered = orderLines.get(line.orderLineId)!;
              return <fieldset key={line.id} className="grid items-end gap-3 rounded-lg border border-border/70 bg-card p-3 md:grid-cols-4"><legend className="px-1 text-sm font-semibold">{item.name}</legend><Field label={`Ποσότητα τιμολογίου (${item.baseUnit.code})`} name={`invoiceQty:${line.id}`} type="number" min={1} step={1} defaultValue={line.quantityBase} required /><Field label={`Τιμή προ έκπτωσης / ${unit(item.baseUnit.dimension)} (€)`} name={`invoicePrice:${line.id}`} inputMode="decimal" defaultValue={amount(ordered.unitPriceCents)} required /><Field label="Έκπτωση (%)" name={`invoiceDiscount:${line.id}`} type="number" min={0} max={100} step={0.01} defaultValue={ordered.discountBps / 100} required /><Field label="ΦΠΑ (%)" name={`invoiceVat:${line.id}`} type="number" min={0} max={100} step={1} defaultValue={ordered.vatRate} required /></fieldset>;
            })}
            <Submit className={btn("default", "sm", "justify-self-end")} pendingText="Τριπλός έλεγχος…">Καταχώριση & τριπλός έλεγχος</Submit>
            <p className="text-xs text-muted-foreground">Δεν δημιουργείται νέα κίνηση αποθέματος, παρτίδα ή αλλαγή κόστους. Αν βρεθεί απόκλιση, απαιτείται ξεχωριστή αιτιολογημένη αποδοχή πριν από την οφειλή.</p>
          </form> : null}

          {receipt.invoiceDocId ? <PurchaseInvoiceMatch status={receipt.invoiceMatchStatus} reviewedAt={receipt.invoiceReviewedAt} reviewedByName={receipt.invoiceReviewedByName} reviewNote={receipt.invoiceReviewNote} discrepancies={receipt.invoiceDiscrepancies} /> : null}
          {ctx.can("orders.edit") && receipt.invoiceMatchStatus === "DISCREPANCY" && !receipt.reversedAt ? <form action={reviewInvoiceReceipt} className="grid items-end gap-2 rounded-lg border border-gold/40 bg-gold/5 p-3 sm:grid-cols-[1fr_auto]"><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="receiptId" value={receipt.id} /><TextareaField label="Τεκμηριωμένη αιτιολογία αποκλίσεων" name="note" required minLength={3} maxLength={500} placeholder="Π.χ. επιβεβαίωση πιστωτικού ή εγκεκριμένη διαφορά προμηθευτή" /><Submit className={btn("default", "sm")} pendingText="Οριστική αποδοχή…">Αποδοχή & οικονομική καταχώριση</Submit></form> : null}
          {receipt.invoiceDocId ? <p className="text-xs text-muted-foreground">Η αναίρεση της παραλαβής είναι κλειδωμένη επειδή υπάρχει συνδεδεμένο τιμολόγιο.</p> : ctx.can("orders.edit") && !receipt.reversedAt ? <form action={reverseReceipt} className="flex flex-wrap items-end gap-2"><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="receiptId" value={receipt.id} /><Field label="Αιτιολογία αναίρεσης" name="reason" required minLength={3} maxLength={300} /><Submit className={btn("destructive", "sm")} pendingText="Αναίρεση…">Αναίρεση παραλαβής</Submit></form> : receipt.reversalReason ? <p className="text-xs text-muted-foreground">{receipt.reversalReason}</p> : null}
        </li>)}</ul></Card> : null}
      </div>
    </Page>
  );
}
