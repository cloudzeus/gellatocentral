import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Check, FileText, PackageCheck, ReceiptText, Send, X } from "lucide-react";
import { DocumentPdfButton } from "@/components/document-output";
import { PurchaseInvoiceMatch } from "@/components/purchase-invoice-match";
import { PurchaseReceiptReview } from "@/components/purchase-receipt-review";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Kpi, Page, Select, TextareaField } from "@/components/ui";
import { creditAwaitedCents, lineValueCents, missingQty } from "@/lib/backorders";
import { calculatePurchaseDocument } from "@/lib/purchase-document";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { cancelOrder, invoiceReceipt, orderInvoice, receiveOrder, reverseReceipt, reviewInvoiceReceipt, reviewReceipt, sendOrder, shortfallOrder } from "../actions";
import { StatusBadge } from "@/components/status-badge";

const displayQty = (quantity: number, dimension: string) => new Intl.NumberFormat("el-GR", { maximumFractionDigits: 6 }).format(quantity / stockCostScale(dimension));
const unit = (dimension: string) => dimension === "mass" ? "kg" : dimension === "volume" ? "l" : "1000 τεμ.";
const amount = (cents: number) => (cents / 100).toFixed(2);
const day = (d: Date) => new Intl.DateTimeFormat("el-GR", { dateStyle: "short" }).format(d);
// αναμενόμενο που η ημερομηνία του πέρασε (από χθες και πίσω)
const pastDue = (d: Date, today: Date) => d.getTime() < today.getTime() - 86_400_000;
const SHORT_OPTIONS = (hasInvoice: boolean): [string, string][] => [["wait", "Τα περιμένουμε"], ["close", hasInvoice ? "Ζητάμε πιστωτικό" : "Δεν τα θέλουμε πια"]];

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
  const invoice = order.invoiceDocId ? await db.purchaseDoc.findFirst({ where: { id: order.invoiceDocId, orgId: ctx.orgId }, include: { lines: true, derived: { where: { kind: "CREDIT", status: "POSTED", stockMode: "value" }, include: { lines: true } } } }) : null;
  const credited = invoice?.derived.reduce((sum, c) => sum + calculatePurchaseDocument(c.lines).totalCents, 0) ?? 0;
  const creditAwaited = creditAwaitedCents(order.creditRequestedCents, credited);
  const rows = order.lines.map((line) => {
    const item = items.get(line.genericItemId)!;
    const scale = stockCostScale(item.baseUnit.dimension);
    const missing = missingQty(line);
    const pct = (q: number) => line.orderedBaseQty ? Math.round(q / line.orderedBaseQty * 100) : 0;
    return { line, item, missing, receivedCents: lineValueCents(line.receivedBaseQty, line, scale), missingCents: lineValueCents(missing, line, scale), closedCents: lineValueCents(line.closedBaseQty, line, scale), pct: { received: pct(line.receivedBaseQty), closed: pct(line.closedBaseQty), missing: pct(missing) } };
  });
  const sum = (key: "receivedCents" | "missingCents") => rows.reduce((total, row) => total + row[key], 0);
  const openRows = rows.filter((row) => row.missing > 0);
  const today = new Date();
  const latestExpected = openRows.map((row) => row.line.expectedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
  const late = ["SENT", "PARTIAL"].includes(order.status) && openRows.some((row) => row.line.expectedAt && pastDue(row.line.expectedAt, today));
  const canEdit = ctx.can("orders.edit");
  const open = ["SENT", "PARTIAL"].includes(order.status);
  const shortOptions = SHORT_OPTIONS(Boolean(invoice));

  return (
    <Page section="Αποθήκη & αγορές" title={order.number} description={`${supplier?.name ?? "Προμηθευτής"} · ${warehouse?.name ?? "Αποθήκη"}`} actions={<span className="flex flex-wrap gap-2"><DocumentPdfButton entityType="purchase_order" entityId={order.id} /><Link href="/orders" className={btn("outline", "sm")}><ArrowLeft /> Πίσω</Link></span>}>
      <div className="grid gap-4">
        {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={ReceiptText} label={invoice ? "Τιμολόγιο παραγγελίας" : "Αξία παραγγελίας"} value={euro(invoice ? calculatePurchaseDocument(invoice.lines).totalCents : order.totalCents)} hint={invoice ? <span className="flex flex-wrap items-center gap-2"><Link href={`/purchases/${invoice.id}`} className="underline">{invoice.number} · {invoice.issuedAt ? day(invoice.issuedAt) : ""}</Link><StatusBadge kind="purchaseOrder" value={order.status} /></span> : <span className="flex items-center gap-2">Χωρίς τιμολόγιο ακόμα <StatusBadge kind="purchaseOrder" value={order.status} /></span>} />
          <Kpi icon={PackageCheck} tone="success" label="Ήρθαν" value={euro(sum("receivedCents"))} hint={`${order.receipts.filter((r) => !r.reversedAt).length} δελτία αποστολής`} />
          <Kpi icon={CalendarClock} tone={sum("missingCents") ? (late ? "danger" : "warning") : "neutral"} label="Περιμένουμε" value={euro(sum("missingCents"))} hint={sum("missingCents") ? (late ? "Καθυστερεί· ζήτα πιστωτικό ή νέα ημερομηνία" : latestExpected ? `έως ${day(latestExpected)} · ${openRows.length} είδη` : `${openRows.length} είδη χωρίς ημερομηνία`) : "Δεν λείπει τίποτα"} />
          <Kpi icon={FileText} tone={creditAwaited ? "warning" : "neutral"} label="Αίτημα πιστωτικού" value={euro(order.creditRequestedCents)} hint={order.creditRequestedCents ? (creditAwaited ? <>Αναμένεται 5.1 {euro(creditAwaited)}{invoice ? <> · <Link href={`/purchases/${invoice.id}`} className="underline">καταχώρισέ το</Link></> : null}</> : "Το πιστωτικό ήρθε") : "Κανένα"} />
        </div>
        <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Είδος</th><th className="p-3 text-right">Παραγγελία</th><th className="p-3 text-right">Ήρθαν</th><th className="p-3 text-right">Λείπουν</th><th className="p-3">Πρόοδος</th><th className="p-3">Τι γίνεται με όσα λείπουν</th></tr></thead><tbody>{rows.map(({ line, item, missing, closedCents, pct }) => {
          const q = (n: number) => `${displayQty(n, item.baseUnit.dimension)} ${unit(item.baseUnit.dimension)}`;
          return <tr key={line.id} className="border-b border-border/60 last:border-0"><td className="p-3 font-medium">{item.name}<span className="block text-xs font-normal text-muted-foreground">{euro(line.unitPriceCents)} / {unit(item.baseUnit.dimension)} · ΦΠΑ {line.vatRate}%</span></td><td className="p-3 text-right tabular-nums">{q(line.orderedBaseQty)}</td><td className="p-3 text-right tabular-nums">{q(line.receivedBaseQty)}</td><td className="p-3 text-right tabular-nums">{missing ? q(missing) : "—"}</td>
            <td className="p-3"><div className="flex h-2.5 min-w-32 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Ήρθαν ${pct.received}%, πιστωτικό ${pct.closed}%, λείπουν ${pct.missing}%`}><span className="bg-success" style={{ width: `${pct.received}%` }} /><span className="bg-primary/45" style={{ width: `${pct.closed}%` }} /><span className="bg-warning" style={{ width: `${pct.missing}%` }} /></div></td>
            <td className="p-3">{missing ? (line.expectedAt ? <Badge tone={pastDue(line.expectedAt, today) ? "danger" : "warning"} icon={CalendarClock}>Αναμένεται έως {day(line.expectedAt)}</Badge> : <Badge tone="warning">Λείπουν</Badge>) : line.closedBaseQty ? <Badge icon={FileText}>{invoice ? `Πιστωτικό ${euro(closedCents)}` : `Κλείστηκαν ${q(line.closedBaseQty)}`}</Badge> : <Badge tone="success" icon={Check}>Ήρθαν όλα</Badge>}</td></tr>;
        })}</tbody></table>
          <p className="flex flex-wrap gap-4 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-success" />Ήρθαν</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-primary/45" />{invoice ? "Πιστωτικό" : "Κλείστηκαν"}</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-warning" />Λείπουν</span></p>
        </Card>

        {canEdit && open && !invoice && !order.receipts.some((r) => r.invoiceDocId) ? <Card className="p-4"><details className="group"><summary className="cursor-pointer font-semibold">Ήρθε τιμολόγιο για όλη την παραγγελία;</summary><p className="mt-1 text-xs text-muted-foreground">Όταν ο προμηθευτής τιμολογεί όλη την παραγγελία πριν φέρει τα είδη (π.χ. προπληρωμή). Το τιμολόγιο γράφεται με τις τιμές της παραγγελίας και δεν αλλάζει το απόθεμα· το απόθεμα το γράφουν τα δελτία αποστολής. Μετά δεν τιμολογείται κάθε δελτίο χωριστά.</p><form action={orderInvoice} className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"><input type="hidden" name="orderId" value={order.id} /><Field label="Αριθμός τιμολογίου" name="number" required maxLength={100} /><Field label="Ημερομηνία" name="issuedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /><Field label="MARK (αν το έχει)" name="mark" maxLength={30} inputMode="numeric" /><Submit className={btn("default")} pendingText="Καταχώριση…"><ReceiptText /> Καταχώριση τιμολογίου</Submit></form></details></Card> : null}

        {ctx.can("orders.edit") && order.status === "DRAFT" ? <div className="flex flex-wrap justify-end gap-2"><form action={sendOrder}><input type="hidden" name="orderId" value={order.id} /><Submit className={btn("default")} pendingText="Καταγραφή…"><Send /> Καταγραφή αποστολής</Submit></form><form action={cancelOrder} className="flex gap-2"><input type="hidden" name="orderId" value={order.id} /><Field label="Αιτιολογία ακύρωσης" name="reason" required maxLength={300} /><Submit className={btn("destructive")} pendingText="Ακύρωση…"><X /> Ακύρωση</Submit></form></div> : null}

        {canEdit && open ? <Card className="p-4"><h2 className="font-semibold">Νέο δελτίο αποστολής</h2><p className="mb-3 text-xs text-muted-foreground">Γράψε το δελτίο του προμηθευτή και πόσα ήρθαν (σε βασικές μονάδες). Για όσα δεν ήρθαν διάλεξε αν τα περιμένουμε ή αν {invoice ? "ζητάμε πιστωτικό" : "δεν τα θέλουμε πια"}.</p><form action={receiveOrder} className="grid gap-3"><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="clientKey" value={randomUUID()} />
          <div className="grid gap-3 sm:grid-cols-3"><Field label="Αριθμός δελτίου αποστολής" name="deliveryNoteNumber" maxLength={60} /><Field label="Ημερομηνία δελτίου" name="deliveryNoteDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><Field label="MARK δελτίου (αν το έχει)" name="deliveryNoteMark" maxLength={30} inputMode="numeric" /></div>
          {openRows.map(({ line, item, missing }) => <div key={line.id} className="grid items-end gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr]"><p className="text-sm font-medium">{item.name}<span className="block text-xs text-muted-foreground">Αναμένονται {displayQty(missing, item.baseUnit.dimension)} {unit(item.baseUnit.dimension)}</span></p><Field label={`Ήρθαν τώρα (${item.baseUnit.code})`} name={`receipt:${line.id}`} type="number" min={0} max={missing} step={1} defaultValue={missing} required /><Field label="Παρτίδα" name={`batch:${line.id}`} maxLength={80} /><Field label="Λήξη" name={`expiry:${line.id}`} type="date" /><Select label="Αν λείπουν" name={`short:${line.id}`} options={shortOptions} defaultValue="wait" /></div>)}
          <div className="flex flex-wrap items-end justify-between gap-3"><Field label="Τα υπόλοιπα αναμένονται έως" name="expectedAt" type="date" defaultValue={(latestExpected ?? order.expectedAt)?.toISOString().slice(0, 10)} /><Submit className={btn("success")} pendingText="Καταχώριση αποθέματος…"><Check /> Καταχώριση δελτίου</Submit></div>
          <p className="text-xs text-muted-foreground">Ό,τι ήρθε μπαίνει στην αποθήκη τώρα, με παρτίδα και λήξη.{invoice ? ` Το τιμολόγιο ${invoice.number} δεν αλλάζει.` : ""}</p>
        </form></Card> : null}

        {canEdit && open && openRows.length && order.receipts.length ? <Card className="p-4"><h2 className="font-semibold">Όσα λείπουν</h2><p className="mb-3 text-xs text-muted-foreground">{late ? "Πέρασε η ημερομηνία και κάποια είδη δεν ήρθαν. " : ""}Άλλαξε την ημερομηνία που τα περιμένουμε ή {invoice ? "ζήτα πιστωτικό για την αξία τους. Το αίτημα κλείνει όταν καταχωρίσεις το 5.1 του προμηθευτή «Μόνο αξία» στο τιμολόγιο." : "κλείσε τα χωρίς να έρθουν."}</p><form action={shortfallOrder} className="grid gap-2"><input type="hidden" name="orderId" value={order.id} />
          {openRows.map(({ line, item, missing, missingCents }) => <div key={line.id} className="grid items-end gap-3 rounded-lg border border-border/70 p-3 sm:grid-cols-[1fr_14rem]"><p className="text-sm font-medium">{item.name}<span className="block text-xs text-muted-foreground">{displayQty(missing, item.baseUnit.dimension)} {unit(item.baseUnit.dimension)} · {euro(missingCents)}</span></p><Select label="Τι κάνουμε" name={`short:${line.id}`} options={shortOptions} defaultValue="wait" /></div>)}
          <div className="flex flex-wrap items-end justify-between gap-3"><Field label="Αναμένονται έως" name="expectedAt" type="date" defaultValue={latestExpected?.toISOString().slice(0, 10)} /><Submit className={btn("default")} pendingText="Αποθήκευση…">Αποθήκευση</Submit></div>
        </form></Card> : null}

        {order.receipts.length ? <Card className="p-4"><h2 className="mb-2 font-semibold">Δελτία αποστολής</h2><ul className="grid gap-3 text-sm">{order.receipts.map((receipt) => <li key={receipt.id} className="grid gap-3 border-b border-border/60 pb-4 last:border-0">
          <div className="flex flex-wrap items-center justify-between gap-2"><span><b className="font-semibold">{receipt.deliveryNoteNumber ? `Δελτίο ${receipt.deliveryNoteNumber}` : "Παραλαβή"}</b>{receipt.deliveryNoteDate ? ` της ${day(receipt.deliveryNoteDate)}` : ""} · {new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(receipt.createdAt)}{receipt.reversedAt ? " · αναιρέθηκε" : ""}</span><span className="flex gap-3"><Link href={`/purchases/${receipt.purchaseDocId}`} className="underline">Παραστατικό παραλαβής</Link>{receipt.invoiceDocId ? <Link href={`/purchases/${receipt.invoiceDocId}`} className="underline">Συνδεδεμένο τιμολόγιο</Link> : null}</span></div>
          <PurchaseReceiptReview reviewStatus={receipt.reviewStatus} reviewedAt={receipt.reviewedAt} reviewedByName={receipt.reviewedByName} reviewNote={receipt.reviewNote} discrepancies={receipt.discrepancies} />
          {ctx.can("orders.edit") && receipt.reviewStatus !== "REVIEWED" && !receipt.reversedAt ? <form action={reviewReceipt} className="grid items-end gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[1fr_auto]"><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="receiptId" value={receipt.id} /><TextareaField label="Σχόλιο τιμολογιακού ελέγχου" name="note" required={receipt.discrepancies.length > 0} minLength={receipt.discrepancies.length ? 3 : undefined} maxLength={500} placeholder={receipt.discrepancies.length ? "Αιτιολόγησε την αποδοχή των ασυμφωνιών" : "Προαιρετικό σχόλιο"} /><Submit className={btn("default", "sm")} pendingText="Αποδοχή…">Αποδοχή ελέγχου</Submit></form> : null}

          {ctx.can("orders.edit") && !invoice && receipt.reviewStatus === "REVIEWED" && !receipt.reversedAt && !receipt.invoiceDocId ? <form action={invoiceReceipt} className="grid gap-4 rounded-lg bg-muted/40 p-3">
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
          {ctx.can("orders.edit") && receipt.invoiceMatchStatus === "DISCREPANCY" && !receipt.reversedAt ? <form action={reviewInvoiceReceipt} className="grid items-end gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 sm:grid-cols-[1fr_auto]"><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="receiptId" value={receipt.id} /><TextareaField label="Τεκμηριωμένη αιτιολογία αποκλίσεων" name="note" required minLength={3} maxLength={500} placeholder="Π.χ. επιβεβαίωση πιστωτικού ή εγκεκριμένη διαφορά προμηθευτή" /><Submit className={btn("default", "sm")} pendingText="Οριστική αποδοχή…">Αποδοχή & οικονομική καταχώριση</Submit></form> : null}
          {receipt.invoiceDocId ? <p className="text-xs text-muted-foreground">Η αναίρεση της παραλαβής είναι κλειδωμένη επειδή υπάρχει συνδεδεμένο τιμολόγιο.</p> : ctx.can("orders.edit") && !receipt.reversedAt ? <form action={reverseReceipt} className="flex flex-wrap items-end gap-2"><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="receiptId" value={receipt.id} /><Field label="Αιτιολογία αναίρεσης" name="reason" required minLength={3} maxLength={300} /><Submit className={btn("destructive", "sm")} pendingText="Αναίρεση…">Αναίρεση παραλαβής</Submit></form> : receipt.reversalReason ? <p className="text-xs text-muted-foreground">{receipt.reversalReason}</p> : null}
        </li>)}</ul></Card> : null}
      </div>
    </Page>
  );
}
