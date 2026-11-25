import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Plus, Settings2, Trash2, X } from "lucide-react";
import { BarcodeField } from "@/components/barcode-field";
import { DataTable } from "@/components/data-table";
import { Files } from "@/components/files";
import { PrintButton } from "@/components/print-button";
import { PurchaseDocument } from "@/components/purchase-document";
import { PurchaseInvoiceMatch } from "@/components/purchase-invoice-match";
import { PurchaseReceiptReview } from "@/components/purchase-receipt-review";
import { Submit } from "@/components/submit";
import { DetailGrid, btn, Card, Field, menuItem, Page, Select, TextareaField } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { listParams } from "@/lib/paging";
import { calculatePurchaseDocument, documentParty, partySnapshot } from "@/lib/purchase-document";
import { priceCheck } from "@/lib/purchase-pricing";
import { perPackCents } from "@/lib/purchases";
import { addLine, cancelDoc, postDoc, rematchLine, removeLine, removeLines, updateDoc } from "../actions";
import { reviewInvoiceReceipt } from "../../orders/actions";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("el-GR", { timeZone: "UTC" }).format(d) : "—");
const inputDay = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "";
const amount = (cents: number) => (cents / 100).toFixed(2);
const MATCH_LABEL: Record<string, string> = { code: "κωδικός", ean: "barcode", manual: "χειροκίνητα", "three-way-receipt": "τριπλός έλεγχος" };

// Καρτέλα τιμολογίου αγοράς: το ίδιο server-rendered έγγραφο για οθόνη και εκτύπωση, με ξεχωριστή ζώνη εργασίας.
export default async function PurchaseDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, can } = await currentOrg("purchases.read");
  const { id } = await params;
  const q = await searchParams;
  const list = listParams(q, 50, ["description", "quantity", "price", "mapping", "batch", "receipt"]);
  const doc = await db.purchaseDoc.findFirst({
    where: { id, orgId: org.id },
    include: {
      supplier: true,
      warehouse: true,
      lines: { orderBy: { id: "asc" }, include: { tradeItem: true, genericItem: true, supplierItem: { include: { prices: { orderBy: { validFrom: "desc" } } } } } },
      receiptInvoice: { include: { discrepancies: true, invoiceDiscrepancies: true } },
    },
  });
  if (!doc) notFound();
  const isReceipt = doc.kind === "RECEIPT";
  const receiptReview = isReceipt
    ? await db.purchaseReceipt.findFirst({ where: { purchaseDocId: doc.id, orgId: org.id }, include: { discrepancies: true, invoiceDiscrepancies: true } })
    : doc.receiptInvoice;
  // Το DRAFT συνδεδεμένου invoice κλειδώνει· δεν περνά από τον generic stock writer ή τις γενικές φόρμες.
  const draft = doc.status === "DRAFT" && !doc.receiptInvoice;
  const [supplierItems, vatRates] = await Promise.all([
    draft ? db.supplierItem.findMany({ where: { orgId: org.id, supplierId: doc.supplierId, active: true }, include: { tradeItem: true }, orderBy: { tradeItem: { name: "asc" } } }) : [],
    db.vatRate.findMany({ where: { active: true }, orderBy: { rate: "desc" } }),
  ]);
  const suggestedIds = doc.lines.map((l) => l.matchNote?.match(/^suggest:(.+)$/)?.[1]).filter((x): x is string => !!x);
  const suggested = suggestedIds.length ? await db.tradeItem.findMany({ where: { id: { in: suggestedIds } } }) : [];
  const suggestedName = (l: (typeof doc.lines)[number]) => suggested.find((t) => t.id === l.matchNote?.slice(8))?.name;
  const unmatched = doc.lines.filter((l) => !l.genericItemId);
  const totals = calculatePurchaseDocument(doc.lines, doc);

  const at = doc.issuedAt ?? doc.createdAt;
  const checkOf = (l: (typeof doc.lines)[number]) =>
    l.supplierItem ? priceCheck(perPackCents(l.unitPriceCents, l.supplierItem.packQty, l.discountBps), l.supplierItem.prices, l.quantity * l.supplierItem.packQty, at) : undefined;
  const offAgreement = doc.lines.filter((l) => { const c = checkOf(l); return c?.agreement && c.diffCents !== 0; });

  const metadataForm = draft && can("purchases.edit") ? (
    <details className="group rounded-xl border border-border bg-card shadow-[var(--shadow-card)] print:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold"><Settings2 className="size-4 text-muted-foreground" /> Στοιχεία παραστατικού, πληρωμή & αποστολή <span className="ml-auto text-xs font-normal text-muted-foreground">Άνοιγμα για επεξεργασία</span></summary>
      <form action={updateDoc} className="grid gap-4 border-t border-border/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="documentId" value={doc.id} />
        <Field label="Αριθμός τιμολογίου" name="number" defaultValue={doc.number ?? ""} maxLength={40} />
        <Field label="Ημερομηνία έκδοσης" name="issuedAt" type="date" defaultValue={inputDay(doc.issuedAt)} />
        <Field label="Τρόπος πληρωμής" name="paymentMethod" defaultValue={doc.paymentMethod ?? ""} maxLength={120} />
        <Field label="Όροι πληρωμής" name="paymentTerms" defaultValue={doc.paymentTerms ?? ""} maxLength={120} placeholder="π.χ. Πίστωση 30 ημερών" />
        <Field label="Τρόπος αποστολής / μεταφορέας" name="shippingMethod" defaultValue={doc.shippingMethod ?? ""} maxLength={120} />
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Διεύθυνση παράδοσης" name="shippingAddress" defaultValue={doc.shippingAddress ?? ""} maxLength={300} /></div>
        <Field label="Μεταφορικά προ ΦΠΑ (€)" name="shippingCost" defaultValue={amount(doc.shippingCostCents)} inputMode="decimal" />
        <Field label="Λοιπά έξοδα προ ΦΠΑ (€)" name="otherExpenses" defaultValue={amount(doc.otherExpensesCents)} inputMode="decimal" />
        <Select label="ΦΠΑ εξόδων" name="expensesVatRate" defaultValue={String(doc.expensesVatRate)} options={vatRates.map((v): [string, string] => [String(v.rate), `${v.name} · ${v.rate}%`])} />
        <div className="sm:col-span-2 lg:col-span-4"><TextareaField label="Σημειώσεις" name="note" defaultValue={doc.note ?? ""} maxLength={500} rows={2} /></div>
        <div className="sm:col-span-2 lg:col-span-4 lg:justify-self-end"><Submit className={btn("default")}>Αποθήκευση στοιχείων</Submit></div>
      </form>
    </details>
  ) : null;

  const lineForm = (
    <Card className="print:hidden">
      <div className="border-b border-border/70 px-4 py-3"><h2 className="text-sm font-semibold">Νέα γραμμή τιμολογίου</h2><p className="text-xs text-muted-foreground">Η τιμή είναι πριν από την έκπτωση και τον ΦΠΑ. Η ποσότητα δηλώνεται στη μονάδα του παραστατικού.</p></div>
      <form action={addLine} className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="documentId" value={doc.id} />
        <div className="sm:col-span-2"><Field label="Περιγραφή (όπως στο τιμολόγιο)" name="description" required minLength={2} maxLength={120} /></div>
        <Field label="Ποσότητα" name="quantity" required inputMode="numeric" />
        <Field label="Τιμή μονάδας (€)" name="unitPrice" required inputMode="decimal" />
        <Field label="Έκπτωση γραμμής (%)" name="discountPercent" defaultValue="0" inputMode="decimal" />
        <Select label="ΦΠΑ γραμμής" name="vatRate" defaultValue={String(vatRates.find((v) => v.rate === 24)?.rate ?? vatRates[0]?.rate ?? 24)} options={vatRates.map((v): [string, string] => [String(v.rate), `${v.name} · ${v.rate}%`])} />
        <Field label="Κωδικός προμηθευτή" name="supplierCode" maxLength={40} />
        <BarcodeField label="Barcode / GS1" name="ean" hint="EAN-13, GTIN-14 ή GS1 — γεμίζει και παρτίδα/λήξη" />
        <Field label="Παρτίδα" name="batchNumber" maxLength={20} />
        <Field label="Λήξη" name="expiresAt" type="date" />
        <Field label="Θερμοκρασία παραλαβής (°C)" name="receiptTempC" inputMode="decimal" />
        <Field label="Παρατήρηση παραλαβής" name="receiptIssue" maxLength={120} hint="π.χ. σχισμένη συσκευασία" />
        <div className="sm:col-span-2 lg:col-span-4 lg:justify-self-end"><Submit className={btn("default")}><Plus /> Προσθήκη γραμμής</Submit></div>
      </form>
    </Card>
  );

  const rematchForm = (l: (typeof doc.lines)[number]) => (
    <form action={rematchLine} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="lineId" value={l.id} />
      <input type="hidden" name="documentId" value={doc.id} />
      <Select label="Είδος προμηθευτή" name="supplierItemId" required defaultValue={l.supplierItemId ?? ""}
        options={[["", "— Επιλογή —"], ...supplierItems.map((s): [string, string] => [s.id, `${s.tradeItem.name}${s.supplierCode ? ` · ${s.supplierCode}` : ""} (×${s.packQty})`])]} />
      <Submit className={btn("default")}>Εφαρμογή αντιστοίχισης</Submit>
    </form>
  );

  const lines = [...doc.lines];
  if (list.sort) lines.sort((a, b) => {
    const value = (l: (typeof lines)[number]) => list.sort === "description" ? l.description
      : list.sort === "quantity" ? l.quantity
        : list.sort === "price" ? l.unitPriceCents
          : list.sort === "mapping" ? l.tradeItem?.name ?? suggestedName(l) ?? ""
            : list.sort === "batch" ? l.batchNumber ?? ""
              : l.receiptIssue ?? "";
    const av = value(a), bv = value(b);
    const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
    return list.dir === "asc" ? result : -result;
  });

  const view = {
    number: doc.number, issuedAt: day(doc.issuedAt), status: doc.status, source: doc.source, mydataMark: doc.mydataMark, warehouse: doc.warehouse.name,
    supplier: documentParty(doc.supplierSnapshot, partySnapshot(doc.supplier)), buyer: documentParty(doc.buyerSnapshot, partySnapshot({ name: org.name, vatNumber: org.vatNumber, countryCode: "GR" })),
    paymentMethod: doc.paymentMethod, paymentTerms: doc.paymentTerms, shippingMethod: doc.shippingMethod, shippingAddress: doc.shippingAddress,
    shippingCostCents: doc.shippingCostCents, otherExpensesCents: doc.otherExpensesCents, expensesVatRate: doc.expensesVatRate, note: doc.note,
    lines: doc.lines.map((l) => ({ id: l.id, description: l.description, supplierCode: l.supplierCode, quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountBps: l.discountBps, vatRate: l.vatRate, batchNumber: l.batchNumber, expiresAt: l.expiresAt ? day(l.expiresAt) : null })),
  };

  return (
    <Page section="Αποθήκη & αγορές" title={`${isReceipt ? "Παραλαβή" : "Τιμολόγιο αγοράς"} ${doc.number ?? ""}`}
      description={`${doc.supplier.name} · ${day(doc.issuedAt)} · ${doc.status === "DRAFT" ? "πρόχειρο" : doc.status === "POSTED" ? "καταχωρημένο" : "ακυρωμένο"} από ${doc.createdByName}`}
      actions={<span className="flex flex-wrap gap-2 print:hidden"><PrintButton />{draft && can("purchases.edit") ? <><form action={cancelDoc.bind(null, doc.id)}><Submit className={btn("ghost")}><X /> Ακύρωση</Submit></form>{doc.lines.length && !unmatched.length ? <form action={postDoc.bind(null, doc.id)}><Submit className={btn("default")}><Check /> Αποδοχή αποθέματος · {euro(totals.totalCents)}</Submit></form> : null}</> : null}</span>}>
      <div className="grid max-w-7xl gap-4 print:max-w-none print:gap-0">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive print:hidden">Δεν αποθηκεύτηκε: {q.error.slice(0, 300)}</p> : null}
        {isReceipt ? <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground print:hidden">Η παραλαβή έχει γράψει απόθεμα, παρτίδα και κόστος, αλλά δεν δημιουργεί οφειλή και δεν συμμετέχει σε ΦΠΑ ή οικονομικές αναφορές αγορών.</p> : null}
        {receiptReview ? <Card className="grid gap-3 p-4 print:hidden">
          <PurchaseReceiptReview reviewStatus={receiptReview.reviewStatus} reviewedAt={receiptReview.reviewedAt} reviewedByName={receiptReview.reviewedByName} reviewNote={receiptReview.reviewNote} discrepancies={receiptReview.discrepancies} />
          {receiptReview.invoiceDocId ? <PurchaseInvoiceMatch status={receiptReview.invoiceMatchStatus} reviewedAt={receiptReview.invoiceReviewedAt} reviewedByName={receiptReview.invoiceReviewedByName} reviewNote={receiptReview.invoiceReviewNote} discrepancies={receiptReview.invoiceDiscrepancies} /> : null}
          {can("orders.edit") && receiptReview.invoiceMatchStatus === "DISCREPANCY" ? <form action={reviewInvoiceReceipt} className="grid items-end gap-2 rounded-lg border border-gold/40 bg-gold/5 p-3 sm:grid-cols-[1fr_auto]"><input type="hidden" name="orderId" value={receiptReview.orderId} /><input type="hidden" name="receiptId" value={receiptReview.id} /><TextareaField label="Τεκμηριωμένη αιτιολογία αποκλίσεων" name="note" required minLength={3} maxLength={500} /><Submit className={btn("default", "sm")} pendingText="Οριστική αποδοχή…">Αποδοχή & οικονομική καταχώριση</Submit></form> : null}
          {!isReceipt ? <Link href={`/purchases/${receiptReview.purchaseDocId}`} className="inline-block text-xs font-semibold underline underline-offset-4">Άνοιγμα παραλαβής προέλευσης</Link> : null}
        </Card> : null}
        {doc.source === "ocr" && draft ? <p className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold-ink print:hidden"><strong>Απαιτείται ανθρώπινη επαλήθευση.</strong> Σύγκρινε αριθμό, ποσότητες, εκπτώσεις, ΦΠΑ και σύνολα με το πρωτότυπο. Το OCR δεν κάνει μόνο του καταχώριση αποθέματος.</p> : null}
        {metadataForm}
        {draft && can("purchases.add") ? lineForm : null}
        {draft && unmatched.length && doc.lines.length ? <p className="rounded-lg bg-gold/15 px-4 py-3 text-sm font-medium text-gold-ink print:hidden">{unmatched.length} γραμμές χωρίς αντιστοίχιση — η αποδοχή απαιτεί όλες αντιστοιχισμένες</p> : null}
        {offAgreement.length ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive print:hidden">{offAgreement.length} γραμμές χρεώθηκαν εκτός ειδικής συμφωνίας — η διαφορά είναι προς διεκδίκηση από τον προμηθευτή</p> : null}

        <PurchaseDocument doc={view} />

        <Card className="p-4 print:hidden">
          <div className="mb-3"><h2 className="text-sm font-semibold">Πρωτότυπο παραστατικό & αρχεία</h2><p className="text-xs text-muted-foreground">Ανέβασε φωτογραφία ή PDF για σύγκριση και αρχειοθέτηση. Για αυτόματη ανάγνωση νέου παραστατικού χρησιμοποίησε τη «Σάρωση τιμολογίου» από τη λίστα αγορών.</p></div>
          <Files orgId={org.id} category="purchase_document" refType="purchase" refId={doc.id} readOnly={!draft || !can("purchases.edit")} empty="Κανένα πρωτότυπο αρχείο ακόμα" />
        </Card>

        {draft ? <Card className="print:hidden">
          <div className="border-b border-border/70 px-4 py-3"><h2 className="text-sm font-semibold">Αντιστοιχίσεις & έλεγχος παραλαβής</h2><p className="text-xs text-muted-foreground">Εδώ ελέγχονται τα τεχνικά πεδία αποθέματος· η οικονομική εικόνα παραμένει στο παραστατικό παραπάνω.</p></div>
          <DataTable
            id={`purchase-${doc.id}-lines`}
            listing={{ ...list, total: lines.length, placeholder: "Γραμμή ή είδος…", showSearch: false }}
            bulkActions={can("purchases.edit") ? [{ value: "remove", label: "Διαγραφή επιλεγμένων γραμμών", confirm: "Οριστική διαγραφή των επιλεγμένων γραμμών από το πρόχειρο;", run: removeLines.bind(null, doc.id) }] : []}
            empty="Καμία γραμμή ακόμα — πρόσθεσε με τη φόρμα παραπάνω ή με σάρωση συσκευασίας"
            columns={[
              { key: "description", label: "Γραμμή τιμολογίου", required: true, sortable: true, wrap: true },
              { key: "quantity", label: "Ποσότητα", numeric: true, sortable: true },
              { key: "price", label: "Καθαρή τιμή", numeric: true, sortable: true },
              { key: "mapping", label: "Αντιστοίχιση", sortable: true, wrap: true },
              { key: "batch", label: "Παρτίδα / λήξη", sortable: true },
              { key: "receipt", label: "Παραλαβή", sortable: true },
            ]}
            rows={lines.map((l) => {
              const c = checkOf(l);
              const mapping = l.tradeItem ? `${l.tradeItem.name}${l.genericItem ? ` → ${l.genericItem.name}` : ""}` : suggestedName(l) ?? "ασύμβατη";
              const netUnit = perPackCents(l.unitPriceCents, 1, l.discountBps);
              return {
                id: l.id,
                cells: {
                  description: <span><span className="block break-words font-semibold md:line-clamp-2" title={l.description}>{l.description}</span>{l.supplierCode ? <span className="mr-2 text-xs text-muted-foreground">κωδ. {l.supplierCode}</span> : null}{l.ean ? <span className="text-xs text-muted-foreground tabular-nums">{l.ean}</span> : null}</span>,
                  quantity: l.quantity,
                  price: <span><span className="tabular-nums">{euro(netUnit)}</span>{c?.expectedCents !== undefined && c.diffCents !== 0 ? <span className="mt-0.5 flex justify-end"><StatusBadge look={look("danger", `εκτός ${c.agreement ? "συμφωνίας" : "τιμοκαταλόγου"} · αναμ. ${euro(c.expectedCents)}`)} /></span> : c?.agreement && c.diffCents === 0 ? <span className="mt-0.5 flex justify-end"><StatusBadge look={look("success", "συμφωνία")} /></span> : null}</span>,
                  mapping: l.tradeItem ? <span className="break-words">{l.tradeItem.name} {l.genericItem ? <span className="text-muted-foreground">→ {l.genericItem.name}</span> : <StatusBadge look={look("warning", "χωρίς γενικό")} />} <span className="text-xs text-muted-foreground">({MATCH_LABEL[l.matchNote ?? ""] ?? ""})</span></span> : suggestedName(l) ? <StatusBadge look={look("warning", `πρόταση: ${suggestedName(l)}`)} /> : <StatusBadge look={look("danger", "ασύμβατη")} />,
                  batch: <span className="text-xs">{l.batchNumber ?? "—"}{l.expiresAt ? ` · λήξη ${day(l.expiresAt)}` : ""}</span>,
                  receipt: <span className="text-xs">{l.receiptTempC != null ? `${String(l.receiptTempC).replace(".", ",")} °C` : "—"}{l.receiptIssue ? <span className="text-destructive"> {l.receiptIssue}</span> : ""}</span>,
                },
                details: {
                  label: l.description,
                  view: <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Αντιστοίχιση</dt><dd className="break-words font-medium">{mapping}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Παρτίδα / λήξη</dt><dd className="font-medium">{l.batchNumber ?? "—"}{l.expiresAt ? ` · ${day(l.expiresAt)}` : ""}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Θερμοκρασία</dt><dd className="font-medium">{l.receiptTempC != null ? `${String(l.receiptTempC).replace(".", ",")} °C` : "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Παρατήρηση</dt><dd className="break-words font-medium">{l.receiptIssue ?? "—"}</dd></div>
                  </DetailGrid>,
                  edit: can("purchases.edit") ? rematchForm(l) : undefined,
                },
                menu: can("purchases.edit") ? <form action={removeLine.bind(null, l.id, doc.id)}><Submit className={menuItem}><Trash2 /> Διαγραφή γραμμής</Submit></form> : undefined,
              };
            })}
          />
        </Card> : null}
        <p className="text-xs text-muted-foreground print:hidden">{isReceipt ? "Η παραλαβή είναι μη χρηματοοικονομικό παραστατικό· η οφειλή προκύπτει μόνο από το συνδεδεμένο τιμολόγιο." : doc.source === "receipt" ? "Το τιμολόγιο συνδέεται με ήδη καταχωρημένη παραλαβή και δεν ξαναγράφει απόθεμα, μέσο κόστος ή τιμές προμηθευτή." : "Η αποδοχή γράφει τις ποσότητες στη βασική μονάδα του γενικού είδους, δημιουργεί παρτίδες με λήξη και ενημερώνει τον τιμοκατάλογο με την τιμή μετά την έκπτωση."}</p>
      </div>
    </Page>
  );
}
