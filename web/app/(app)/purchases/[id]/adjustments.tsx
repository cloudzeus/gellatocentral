// Επιστροφές σε προμηθευτή και πιστωτικά προμηθευτή: οι ενέργειες και το υπόλοιπο στο τιμολόγιο αγοράς,
// και η καρτέλα της ίδιας της επιστροφής / του πιστωτικού (lib/purchase-returns.ts).
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileMinus, Info, RefreshCw, Send, TriangleAlert, Undo2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { seriesOptions } from "@/lib/documents/series-options";
import { readableError } from "@/lib/fiscal-retry-rules";
import { euro } from "@/lib/money";
import { calculatePurchaseDocument } from "@/lib/purchase-document";
import { awaitingCredit, returnable } from "@/lib/purchase-returns-rules";
import { cancelDoc, createCreditAction, createReturnAction, issueReturnAction, postImportedCreditAction, retransmitReturnAction } from "../actions";

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("el-GR", { timeZone: "UTC" }).format(d) : "—");
const MODE: Record<string, string> = { returned: "Τα είδη επιστράφηκαν με δική μας επιστροφή", now: "Τα είδη επιστράφηκαν μαζί με το πιστωτικό", value: "Μόνο αξία (έκπτωση ή διαφορά τιμής)" };
const total = (d: { lines: { quantity: number; unitPriceCents: number; discountBps: number; vatRate: number }[]; shippingCostCents: number; otherExpensesCents: number; expensesVatRate: number }) => calculatePurchaseDocument(d.lines, d).totalCents;
const radio = "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:font-semibold";

type Invoice = { id: string; orgId: string; supplierId: string; creditCents: number; source: string; shippingCostCents: number; otherExpensesCents: number; expensesVatRate: number; lines: { id: string; description: string; quantity: number; unitPriceCents: number; discountBps: number; vatRate: number; batchNumber: string | null }[] };

/** Τα δεδομένα για το τιμολόγιο: ό,τι έχει δεθεί πάνω του, τι πληρώθηκε και τι μένει να επιστραφεί. */
export async function invoiceAdjustments(invoice: Invoice) {
  const [derived, paid] = await Promise.all([
    db.purchaseDoc.findMany({ where: { orgId: invoice.orgId, relatedId: invoice.id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, include: { lines: true, fiscalDocument: { select: { status: true, mark: true } }, credits: { where: { status: "POSTED" }, include: { lines: true } } } }),
    db.supplierPaymentAllocation.aggregate({ where: { orgId: invoice.orgId, purchaseDocId: invoice.id }, _sum: { amountCents: true } }),
  ]);
  // το τιμολόγιο παραγγελίας δεν έγραψε απόθεμα: τίποτα δεν επιστρέφεται από αυτό (τα ελλείμματα κλείνουν με πιστωτικό από την παραγγελία)
  const left = invoice.source === "order" ? new Map<string, number>() : returnable(invoice.lines, derived.filter((d) => d.kind === "RETURN" || (d.kind === "CREDIT" && d.stockMode === "now")).flatMap((d) => d.lines));
  const totalCents = total(invoice);
  return { derived, left, totalCents, paidCents: paid._sum.amountCents ?? 0 };
}
type Adjustments = Awaited<ReturnType<typeof invoiceAdjustments>>;

const qtyTable = (invoice: Invoice, left: Map<string, number>) => (
  <div className="overflow-x-auto rounded-lg border border-border">
    <table className="w-full text-sm">
      <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-semibold">Είδος</th><th className="px-3 py-2 text-right font-semibold">Μπορείς</th><th className="px-3 py-2 text-right font-semibold">Επιστρέφω</th></tr></thead>
      <tbody>{invoice.lines.map((l) => (
        <tr key={l.id} className="border-b last:border-0">
          <td className="px-3 py-2"><span className="font-medium">{l.description}</span>{l.batchNumber ? <span className="block text-xs text-muted-foreground">παρτίδα {l.batchNumber}</span> : null}</td>
          <td className="px-3 py-2 text-right tabular-nums">{left.get(l.id) ?? 0}</td>
          <td className="px-3 py-2 text-right"><input name={`qty:${l.id}`} aria-label={`Ποσότητα επιστροφής ${l.description}`} type="number" min={0} max={left.get(l.id) ?? 0} step={1} defaultValue={0} disabled={!left.get(l.id)} className="h-10 w-20 rounded-lg border border-input bg-card px-2 text-right tabular-nums" /></td>
        </tr>
      ))}</tbody>
    </table>
  </div>
);

/** Τα δύο κουμπιά στην κορυφή του καταχωρημένου τιμολογίου. */
export function InvoiceActions({ invoice, data }: { invoice: Invoice; data: Adjustments }) {
  const canReturn = [...data.left.values()].some((n) => n > 0);
  const returns = data.derived.filter((d) => d.kind === "RETURN" && d.status === "POSTED");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
  return (
    <>
      {canReturn ? <Modal label={<><Undo2 /> Επιστροφή στον προμηθευτή</>} title="Επιστροφή ειδών στον προμηθευτή" description="Γράψε πόσα επιστρέφεις. Στο επόμενο βήμα βλέπεις το δελτίο αποστολής 9.3 και το εκδίδεις." wide>
        <form action={createReturnAction.bind(null, invoice.id)} className="grid gap-3">
          {qtyTable(invoice, data.left)}
          <TextareaField label="Λόγος (φαίνεται στο ιστορικό)" name="reason" maxLength={300} rows={2} placeholder="π.χ. ήρθε ζεστό, σπασμένη συσκευασία" />
          <Submit className={btn("default", "default", "justify-self-end")}>Συνέχεια στο δελτίο αποστολής <ArrowRight /></Submit>
        </form>
      </Modal> : null}
      <Modal label={<><FileMinus /> Καταχώριση πιστωτικού</>} title="Πιστωτικό από τον προμηθευτή" description="Γράψε ό,τι λέει το πιστωτικό του προμηθευτή. Μειώνει ό,τι του χρωστάμε για αυτό το τιμολόγιο." wide>
        <form action={createCreditAction.bind(null, invoice.id)} className="group/credit grid gap-3">
          <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-1 text-sm font-semibold">Είδος</legend>
            <label className={radio}><input type="radio" name="mydataType" value="5.1" defaultChecked /> 5.1 · Συσχετιζόμενο</label>
            <label className={radio}><input type="radio" name="mydataType" value="5.2" /> 5.2 · Χωρίς συσχέτιση</label>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Αριθμός του προμηθευτή" name="number" maxLength={40} />
            <Field label="Ημερομηνία" name="issuedAt" type="date" required defaultValue={today} />
            <Field label="MARK (αν το έχει)" name="mark" maxLength={40} inputMode="numeric" />
          </div>
          <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-semibold">Τα είδη</legend>
            {returns.length ? <label className={radio}><input type="radio" name="stockMode" value="returned" defaultChecked /> Επιστράφηκαν ήδη με δική μας επιστροφή</label> : null}
            <label className={radio}><input type="radio" name="stockMode" value="now" disabled={![...data.left.values()].some((n) => n > 0)} /> Επιστρέφονται τώρα, μαζί με το πιστωτικό</label>
            <label className={radio}><input type="radio" name="stockMode" value="value" defaultChecked={!returns.length} /> Μόνο αξία (έκπτωση ή διαφορά τιμής, η αποθήκη δεν αλλάζει)</label>
          </fieldset>
          <div className="hidden gap-3 group-has-[[value=returned]:checked]/credit:grid group-has-[[value=value]:checked]/credit:grid">
            <Select label="Επιστροφή που πιστώνεται" name="returnId" options={[["", "Καμία"], ...returns.map((r): [string, string] => [r.id, `${r.number ?? "Επιστροφή"} · ${euro(total(r))}${awaitingCredit(total(r), r.credits.reduce((s, c) => s + total(c), 0)) ? " · περιμένει πιστωτικό" : ""}`])]} defaultValue={returns[0]?.id ?? ""} />
          </div>
          <div className="hidden group-has-[[value=now]:checked]/credit:grid">{qtyTable(invoice, data.left)}</div>
          <div className="hidden gap-3 sm:grid-cols-2 group-has-[[value=value]:checked]/credit:grid">
            <Field label="Καθαρή αξία προ ΦΠΑ (€)" name="amount" inputMode="decimal" />
            <Select label="ΦΠΑ" name="vatRate" defaultValue="24" options={[["24", "24%"], ["13", "13%"], ["6", "6%"], ["0", "0%"]]} />
            <div className="sm:col-span-2"><Field label="Περιγραφή" name="note" maxLength={200} placeholder="π.χ. έκπτωση τζίρου Νοεμβρίου" /></div>
          </div>
          <p className="text-xs text-muted-foreground">Μένουν να πληρωθούν {euro(data.totalCents - invoice.creditCents - data.paidCents)} σε αυτό το τιμολόγιο. Το πιστωτικό δεν μπορεί να ξεπεράσει {euro(data.totalCents - invoice.creditCents)}.</p>
          <Submit className={btn("default", "default", "justify-self-end")}>Καταχώριση πιστωτικού</Submit>
        </form>
      </Modal>
    </>
  );
}

const docLabel = (d: { kind: string; mydataType: string | null }) => (d.kind === "RETURN" ? "Επιστροφή 9.3" : `Πιστωτικό ${d.mydataType ?? ""}`.trim());

/** Πόσα χρωστάμε για το τιμολόγιο και τι έχει δεθεί πάνω του. */
export function InvoiceBalance({ invoice, data }: { invoice: Invoice; data: Adjustments }) {
  if (!data.derived.length && !invoice.creditCents && !data.paidCents) return null;
  const remaining = Math.max(0, data.totalCents - invoice.creditCents - data.paidCents);
  const pct = (n: number) => `${data.totalCents ? Math.min(100, (n / data.totalCents) * 100) : 0}%`;
  return (
    <Card className="grid gap-4 p-4 print:hidden lg:grid-cols-[1.2fr_1fr]">
      <div>
        <h2 className="flex justify-between text-sm font-semibold">Τι οφείλουμε για αυτό το τιμολόγιο <span className="font-normal text-muted-foreground">σύνολο {euro(data.totalCents)}</span></h2>
        <div className="my-2 flex h-3.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Μένουν ${euro(remaining)}, πιστώθηκαν ${euro(invoice.creditCents)}, πληρώθηκαν ${euro(data.paidCents)}`}>
          <div className="bg-slate-500" style={{ width: pct(remaining) }} /><div className="bg-success" style={{ width: pct(invoice.creditCents) }} /><div className="bg-primary/30" style={{ width: pct(data.paidCents) }} />
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-slate-500" />Μένει να πληρωθεί {euro(remaining)}</li>
          <li><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-success" />Πιστώθηκε {euro(invoice.creditCents)}</li>
          <li><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-primary/30" />Πληρώθηκε {euro(data.paidCents)}</li>
        </ul>
        {invoice.creditCents ? <p className="mt-3 flex gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success-ink"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />Τα πιστωτικά μείωσαν το υπόλοιπο. Η επόμενη πληρωμή στον προμηθευτή κλείνει {euro(remaining)}.</p> : null}
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold">Συνδεδεμένα παραστατικά</h2>
        {data.derived.length ? <ul className="grid gap-2">{data.derived.map((d) => {
          const t = total(d);
          const waiting = d.kind === "RETURN" && d.status === "POSTED" ? awaitingCredit(t, d.credits.reduce((s, c) => s + total(c), 0)) : 0;
          return (
            <li key={d.id}><Link href={`/purchases/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50">
              <span><span className="font-semibold">{d.number ?? "Πρόχειρο"}</span> <span className="text-muted-foreground">{docLabel(d)}</span></span>
              <span className="flex items-center gap-2 tabular-nums">
                {d.status === "DRAFT" ? <StatusBadge kind="purchase" value="DRAFT" /> : d.kind === "RETURN" && d.fiscalDocument ? <StatusBadge kind="fiscal" value={d.fiscalDocument.status} /> : null}
                {waiting ? <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-ink">περιμένει πιστωτικό</span> : null}
                {d.kind === "CREDIT" ? <span className="font-semibold text-success-ink">−{euro(t)}</span> : <span>{euro(t)}</span>}
              </span>
            </Link></li>
          );
        })}</ul> : <p className="text-sm text-muted-foreground">Καμία επιστροφή ή πιστωτικό.</p>}
      </div>
    </Card>
  );
}

/** Η καρτέλα μιας επιστροφής ή ενός πιστωτικού. */
export async function AdjustmentPage({ id, orgId, canEdit, error }: { id: string; orgId: string; canEdit: boolean; error?: string }) {
  const doc = await db.purchaseDoc.findFirstOrThrow({
    where: { id, orgId },
    include: {
      lines: { orderBy: { id: "asc" } }, supplier: { include: { geoCity: { select: { name: true } } } }, related: { select: { id: true, number: true } },
      returnDoc: { select: { id: true, number: true } }, fiscalDocument: true, credits: { where: { status: "POSTED" }, include: { lines: true } },
      warehouse: { include: { stores: { include: { store: { include: { geoCity: { select: { name: true } } } } }, orderBy: [{ isDefault: "desc" }, { priority: "asc" }] } } },
    },
  });
  const isReturn = doc.kind === "RETURN";
  const t = total(doc);
  const store = doc.warehouse.stores[0]?.store;
  const draftReturn = isReturn && doc.status === "DRAFT";
  const importedDraft = !isReturn && doc.status === "DRAFT";
  const [series, invoices, returns] = await Promise.all([
    draftReturn ? seriesOptions(orgId, "9.3") : [],
    importedDraft ? db.purchaseDoc.findMany({ where: { orgId, supplierId: doc.supplierId, kind: "INVOICE", status: "POSTED" }, orderBy: { issuedAt: "desc" }, take: 100, select: { id: true, number: true, issuedAt: true, mydataMark: true } }) : [],
    importedDraft ? db.purchaseDoc.findMany({ where: { orgId, supplierId: doc.supplierId, kind: "RETURN", status: "POSTED" }, orderBy: { issuedAt: "desc" }, take: 100, select: { id: true, number: true, related: { select: { number: true } } } }) : [],
  ]);
  const credited = doc.credits.reduce((s, c) => s + total(c), 0);
  const waiting = isReturn && doc.status === "POSTED" ? awaitingCredit(t, credited) : 0;
  const fiscal = doc.fiscalDocument;
  const supplierCity = doc.supplier.city || doc.supplier.geoCity?.name;
  const title = isReturn ? `Επιστροφή ${doc.number ?? "(πρόχειρη)"}` : `Πιστωτικό ${doc.mydataType ?? ""} ${doc.number ?? ""}`.replace(/\s+/g, " ").trim();
  const suggested = invoices.find((i) => i.mydataMark && i.mydataMark === doc.relatedMark);

  return (
    <Page section="Αποθήκη & αγορές" title={title} description={`${doc.supplier.name} · ${day(doc.issuedAt ?? doc.createdAt)} · ${doc.warehouse.name}`}
      actions={canEdit && (draftReturn || importedDraft) ? <form action={cancelDoc.bind(null, doc.id)}><Submit className={btn("ghost")}><X /> Ακύρωση</Submit></form> : undefined}>
      <div className="grid max-w-6xl gap-4">
        {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error.slice(0, 400)}</p> : null}
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">{isReturn ? "Είδη που επιστρέφονται" : "Γραμμές πιστωτικού"}</h2>
              <span className="text-sm">{doc.related ? <>Αφορά <Link className="font-semibold underline underline-offset-2" href={`/purchases/${doc.related.id}`}>τιμολόγιο {doc.related.number ?? ""}</Link></> : "Δεν έχει συνδεθεί με τιμολόγιο"}{doc.returnDoc ? <> · <Link className="font-semibold underline underline-offset-2" href={`/purchases/${doc.returnDoc.id}`}>επιστροφή {doc.returnDoc.number}</Link></> : null}</span>
            </div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-semibold">Είδος</th><th className="px-4 py-2 text-right font-semibold">Ποσότητα</th><th className="px-4 py-2 text-right font-semibold">Αξία με ΦΠΑ</th></tr></thead>
              <tbody>{calculatePurchaseDocument(doc.lines).lines.map((l) => (
                <tr key={l.id} className="border-b"><td className="px-4 py-2"><span className="font-medium">{l.description}</span>{l.batchNumber ? <span className="block text-xs text-muted-foreground">παρτίδα {l.batchNumber}</span> : null}</td><td className="px-4 py-2 text-right tabular-nums">{l.quantity}</td><td className="px-4 py-2 text-right tabular-nums">{euro(l.totalCents)}</td></tr>
              ))}<tr><td colSpan={2} className="px-4 py-2 text-right font-semibold">Σύνολο</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{isReturn ? euro(t) : `−${euro(t)}`}</td></tr></tbody>
            </table></div>
            {doc.note ? <p className="border-t px-4 py-3 text-sm"><span className="text-muted-foreground">Λόγος / σημείωση: </span>{doc.note}</p> : null}
            {!isReturn && doc.stockMode ? <p className="border-t px-4 py-3 text-sm text-muted-foreground">{MODE[doc.stockMode]}</p> : null}
          </Card>

          <div className="grid content-start gap-3">
            {isReturn ? <Card className="grid gap-1.5 border-dashed p-4 text-sm">
              <h2 className="mb-1 flex items-center justify-between gap-2 font-semibold">Δελτίο αποστολής 9.3 {fiscal ? <StatusBadge kind="fiscal" value={fiscal.status} /> : <span className="text-xs font-normal text-muted-foreground">προεπισκόπηση</span>}</h2>
              <p className="grid grid-cols-[8rem_1fr] gap-2"><span className="text-muted-foreground">Σκοπός</span><b>5 · Επιστροφή</b></p>
              <p className="grid grid-cols-[8rem_1fr] gap-2"><span className="text-muted-foreground">Φόρτωση</span><span>{store ? `${store.name} · ${[store.address, store.postalCode, store.city || store.geoCity?.name].filter(Boolean).join(", ") || "χωρίς διεύθυνση"}` : "Η αποθήκη δεν ανήκει σε κατάστημα"}</span></p>
              <p className="grid grid-cols-[8rem_1fr] gap-2"><span className="text-muted-foreground">Παράδοση</span><span>{doc.supplier.name} · ΑΦΜ {doc.supplier.vatNumber ?? "—"} · {[doc.supplier.address, doc.supplier.postalCode, supplierCity].filter(Boolean).join(", ") || "χωρίς διεύθυνση"}</span></p>
              {fiscal?.mark ? <p className="grid grid-cols-[8rem_1fr] gap-2"><span className="text-muted-foreground">MARK</span><span className="font-mono tabular-nums">{fiscal.mark}</span></p> : null}
              {fiscal?.status === "FAILED" ? <p className="mt-1 text-destructive">{readableError(fiscal.error)}</p> : null}
              {canEdit && fiscal && (fiscal.status === "FAILED" || fiscal.status === "NOT_SENT") ? <form action={retransmitReturnAction.bind(null, doc.id)} className="mt-2"><Submit className={btn("default", "sm")}><RefreshCw /> Αποστολή ξανά στην ΑΑΔΕ</Submit></form> : null}
              {draftReturn && canEdit ? <form action={issueReturnAction.bind(null, doc.id)} className="mt-2 grid gap-2">
                <Select label="Σειρά δελτίου αποστολής" name="seriesId" required options={series.length ? series : [["", "Δεν υπάρχει σειρά 9.3 — φτιάξ' την στις Σειρές"]]} />
                <Submit className={btn("default")} pendingText="Έκδοση και αποστολή…"><Send /> Έκδοση 9.3 και αφαίρεση από αποθήκη</Submit>
              </form> : null}
            </Card> : null}
            {draftReturn ? <p className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm"><Info className="mt-0.5 size-4 shrink-0" />Με την έκδοση τα είδη φεύγουν από την αποθήκη και το 9.3 στέλνεται στην ΑΑΔΕ. Αν η αποστολή αποτύχει, ξαναδοκιμάζεται μόνη της.</p> : null}
            {waiting ? <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-ink"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><span>Ο προμηθευτής χρωστά πιστωτικό {euro(waiting)}. Όταν έρθει, καταχώρισέ το από το <Link className="font-semibold underline" href={`/purchases/${doc.related?.id}`}>τιμολόγιο</Link>.</span></p> : null}
            {isReturn && doc.status === "POSTED" && !waiting ? <p className="flex gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success-ink"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />Η επιστροφή έχει πιστωθεί ολόκληρη.</p> : null}
            {!isReturn && doc.status === "POSTED" ? <p className="flex gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success-ink"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />Καταχωρήθηκε· μείωσε κατά {euro(t)} ό,τι χρωστάμε στον προμηθευτή.</p> : null}
            {importedDraft && canEdit ? <Card className="grid gap-3 p-4">
              <h2 className="text-sm font-semibold">Σύνδεση και καταχώριση</h2>
              <p className="text-sm text-muted-foreground">Ήρθε από το myDATA. Διάλεξε το τιμολόγιο που μειώνει.{suggested ? " Προτείνεται αυτό με το MARK που αναφέρει το πιστωτικό." : ""}</p>
              <form action={postImportedCreditAction.bind(null, doc.id)} className="grid gap-3">
                <Select label="Τιμολόγιο" name="invoiceId" required defaultValue={suggested?.id ?? ""} options={[["", "— Επιλογή —"], ...invoices.map((i): [string, string] => [i.id, `${i.number ?? "Χωρίς αριθμό"} · ${day(i.issuedAt)}`])]} />
                <Select label="Επιστροφή που κλείνει (αν υπάρχει)" name="returnId" options={[["", "Καμία · μόνο αξία"], ...returns.map((r): [string, string] => [r.id, `${r.number} · τιμολόγιο ${r.related?.number ?? ""}`])]} />
                <Submit className={btn("default")}>Καταχώριση πιστωτικού · −{euro(t)}</Submit>
              </form>
            </Card> : null}
          </div>
        </div>
      </div>
    </Page>
  );
}
