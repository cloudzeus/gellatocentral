import Link from "next/link";
import { ArrowLeft, RotateCcw, Send, WalletCards } from "lucide-react";
import { DocumentPdfButton } from "@/components/document-output";
import { Submit } from "@/components/submit";
import { btn, Card, DetailGrid, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { outstandingCents } from "@/lib/wholesale";
import { creditInvoice, customerPayment, reverseDelivery, transmitInvoice } from "../../wholesale-orders/actions";
import { StatusBadge } from "@/components/status-badge";

const TYPE = { "1.1": "Τιμολόγιο πώλησης", "5.1": "Πιστωτικό τιμολόγιο", "9.3": "Δελτίο αποστολής" } as const;
const dateTime = (value: Date) => value.toISOString().slice(0, 16);

export default async function InvoicePage({ params, searchParams }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireStockContext("invoices.read");
  const document = await db.salesDocument.findFirst({ where: { id, orgId: ctx.orgId }, include: { lines: true, allocations: true, order: { select: { number: true, status: true } } } });
  if (!document) return <Page section="Πελάτες & πωλήσεις" title="Παραστατικό"><p>Το παραστατικό δεν βρέθηκε.</p></Page>;
  await requireStockContext("invoices.read", { storeId: document.storeId, warehouseId: document.warehouseId });
  const [customer, generics, fiscal, accounts] = await Promise.all([
    db.party.findFirst({ where: { id: document.customerId, orgId: ctx.orgId } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: document.lines.map((line) => line.genericItemId) } }, include: { baseUnit: true } }),
    document.fiscalDocumentId ? db.fiscalDocument.findFirst({ where: { id: document.fiscalDocumentId, orgId: ctx.orgId } }) : null,
    db.financeAccount.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}) }, orderBy: { name: "asc" } }),
  ]);
  const items = new Map(generics.map((item) => [item.id, item]));
  const outstanding = outstandingCents(document, document.allocations);
  const response = fiscal?.response && typeof fiscal.response === "object" && !Array.isArray(fiscal.response) ? fiscal.response as Record<string, unknown> : null;
  const mark = typeof response?.mark === "string" ? response.mark : null;
  return <Page section="Πελάτες & πωλήσεις" title={`${document.series}-${document.aa}`} description={`${TYPE[document.docType as keyof typeof TYPE] ?? document.docType} · ${customer?.name ?? "Πελάτης"} · παραγγελία ${document.order.number}`} actions={<span className="flex flex-wrap gap-2"><DocumentPdfButton entityType="sales_document" entityId={document.id} /><Link href="/invoices" className={btn("outline", "sm")}><ArrowLeft /> Παραστατικά</Link></span>}>
    <div className="grid gap-4">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
      <Card className="p-4"><DetailGrid className="sm:grid-cols-5"><div><dt>Κατάσταση</dt><dd><StatusBadge kind="salesDocument" value={document.status} /></dd></div><div><dt>Έκδοση</dt><dd>{new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(document.issuedAt)}</dd></div><div><dt>Καθαρή αξία</dt><dd>{euro(document.netCents)}</dd></div><div><dt>ΦΠΑ</dt><dd>{euro(document.vatCents)}</dd></div><div><dt>Σύνολο</dt><dd>{euro(document.totalCents)}</dd></div></DetailGrid></Card>
      <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Είδος</th><th className="p-3">Παρτίδα</th><th className="p-3 text-right">Ποσότητα</th><th className="p-3 text-right">Τιμή</th><th className="p-3 text-right">ΦΠΑ</th></tr></thead><tbody>{document.lines.map((line) => { const item = items.get(line.genericItemId); const dimension = item?.baseUnit.dimension ?? "count"; return <tr key={line.id} className="border-b border-border/60 last:border-0"><td className="p-3 font-medium">{item?.name ?? "Είδος"}</td><td className="p-3 font-mono text-xs">{line.lotId?.slice(-10) ?? "—"}</td><td className="p-3 text-right">{(line.quantityBase / stockCostScale(dimension)).toLocaleString("el-GR", { maximumFractionDigits: 6 })} {dimension === "mass" ? "kg" : dimension === "volume" ? "l" : "1000 τεμ."}</td><td className="p-3 text-right">{euro(line.unitPriceCents)}</td><td className="p-3 text-right">{line.vatRate}%</td></tr>; })}</tbody></table></Card>
      <Card className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Διαβίβαση myDATA</h2><p className="mt-1 text-sm text-muted-foreground">{fiscal?.status === "SIGNED" ? `Στάλθηκε${mark ? ` · MARK ${mark}` : ""}` : fiscal?.status === "PENDING" ? "Σε εξέλιξη" : fiscal?.status === "FAILED" ? `Απέτυχε: ${fiscal.error ?? "άγνωστο σφάλμα"}` : "Δεν έχει γίνει διαβίβαση"}</p></div>{ctx.can("invoices.edit") && document.status === "ISSUED" && fiscal?.status !== "SIGNED" && fiscal?.status !== "PENDING" ? <form action={transmitInvoice}><input type="hidden" name="documentId" value={document.id} /><Submit className={btn("outline")}><Send /> {fiscal?.status === "FAILED" ? "Επανάληψη" : "Διαβίβαση"}</Submit></form> : null}</div></Card>
      {document.docType === "1.1" ? <Card className="p-4"><h2 className="font-semibold">Εξόφληση</h2><p className="mt-1 text-sm text-muted-foreground">Απλήρωτο: <strong className="text-foreground">{euro(outstanding)}</strong> · {document.allocations.length} αντιστοιχίσεις</p>{ctx.can("finance.edit") && outstanding > 0 ? <form action={customerPayment} className="mt-4 grid items-end gap-3 md:grid-cols-3"><input type="hidden" name="clientKey" value={crypto.randomUUID()} /><input type="hidden" name="documentId" value={document.id} /><input type="hidden" name="customerId" value={document.customerId} /><Select label="Λογαριασμός" name="accountId" options={[["", "Χωρίς ταμειακή κίνηση"], ...accounts.map((account): [string, string] => [account.id, account.name])]} /><Field label="Πραγματική είσπραξη €" name="amount" inputMode="decimal" defaultValue={(outstanding / 100).toFixed(2)} required /><Field label="Αντιστοίχιση στο τιμολόγιο €" name="allocatedAmount" inputMode="decimal" defaultValue={(outstanding / 100).toFixed(2)} required /><Field label="Ημερομηνία" name="paidAt" type="datetime-local" defaultValue={dateTime(new Date())} required /><Field label="Αναφορά" name="reference" maxLength={100} /><Submit className={btn("success")}><WalletCards /> Καταχώριση είσπραξης</Submit><div className="md:col-span-3"><TextareaField label="Σημείωση" name="note" maxLength={500} /></div></form> : null}</Card> : null}
      {ctx.can("invoices.cancel") && document.docType === "1.1" && document.status === "ISSUED" && !document.allocations.length ? <Card className="p-4"><h2 className="mb-3 font-semibold">Πιστωτικό 5.1 και επιστροφή αποθέματος</h2><form action={creditInvoice} className="grid items-end gap-3 md:grid-cols-[10rem_1fr_auto]"><input type="hidden" name="documentId" value={document.id} /><Field label="Σειρά πιστωτικού" name="series" defaultValue="ΠΙΣΤ" required maxLength={30} /><TextareaField label="Αιτιολογία" name="reason" required minLength={3} maxLength={300} /><Submit className={btn("destructive")}><RotateCcw /> Έκδοση πιστωτικού</Submit></form></Card> : null}
      {ctx.can("wholesale.edit") && document.docType === "9.3" && document.status === "ISSUED" ? <Card className="p-4"><h2 className="mb-3 font-semibold">Αναίρεση παράδοσης</h2><form action={reverseDelivery} className="grid items-end gap-3 md:grid-cols-[1fr_auto]"><input type="hidden" name="documentId" value={document.id} /><Field label="Αιτιολογία" name="reason" required minLength={3} maxLength={300} /><Submit className={btn("destructive")}><RotateCcw /> Αντίθετες κινήσεις</Submit></form></Card> : null}
    </div>
  </Page>;
}
