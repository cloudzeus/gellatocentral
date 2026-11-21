import { notFound } from "next/navigation";
import { Check, Plus, Trash2, X } from "lucide-react";
import { BarcodeField } from "@/components/barcode-field";
import { DataTable } from "@/components/data-table";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { listParams } from "@/lib/paging";
import { priceCheck } from "@/lib/purchase-pricing";
import { perPackCents } from "@/lib/purchases";
import { addLine, cancelDoc, postDoc, rematchLine, removeLine, removeLines } from "../actions";

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("el-GR", { timeZone: "UTC" }).format(d) : "—");
const MATCH_LABEL: Record<string, string> = { code: "κωδικός", ean: "barcode", manual: "χειροκίνητα" };

// Καρτέλα τιμολογίου αγοράς: αντιστοίχιση και αποδοχή αποθέματος σε μία server συναλλαγή.
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
    },
  });
  if (!doc) notFound();
  const draft = doc.status === "DRAFT";
  const supplierItems = draft
    ? await db.supplierItem.findMany({ where: { orgId: org.id, supplierId: doc.supplierId, active: true }, include: { tradeItem: true }, orderBy: { tradeItem: { name: "asc" } } })
    : [];
  const suggestedIds = doc.lines.map((l) => l.matchNote?.match(/^suggest:(.+)$/)?.[1]).filter((x): x is string => !!x);
  const suggested = suggestedIds.length ? await db.tradeItem.findMany({ where: { id: { in: suggestedIds } } }) : [];
  const suggestedName = (l: (typeof doc.lines)[number]) => suggested.find((t) => t.id === l.matchNote?.slice(8))?.name;
  const unmatched = doc.lines.filter((l) => !l.genericItemId);

  const at = doc.issuedAt ?? doc.createdAt;
  const checkOf = (l: (typeof doc.lines)[number]) =>
    l.supplierItem ? priceCheck(perPackCents(l.unitPriceCents, l.supplierItem.packQty), l.supplierItem.prices, l.quantity * l.supplierItem.packQty, at) : undefined;
  const offAgreement = doc.lines.filter((l) => { const c = checkOf(l); return c?.agreement && c.diffCents !== 0; });

  const lineForm = (
    <Card>
      <form action={addLine} className="grid gap-4 p-5 sm:grid-cols-3">
        <input type="hidden" name="documentId" value={doc.id} />
        <Field label="Περιγραφή (όπως στο τιμολόγιο)" name="description" required minLength={2} maxLength={120} />
        <div className="grid grid-cols-2 gap-4"><Field label="Ποσότητα" name="quantity" required inputMode="numeric" hint="στη μονάδα του παραστατικού" /><Field label="Τιμή μονάδας προ ΦΠΑ (€)" name="unitPrice" required inputMode="decimal" /></div>
        <Field label="Κωδικός προμηθευτή" name="supplierCode" maxLength={40} />
        <BarcodeField label="Barcode / GS1" name="ean" hint="EAN-13, GTIN-14 ή GS1 — γεμίζει και παρτίδα/λήξη" />
        <Field label="Παρτίδα" name="batchNumber" maxLength={20} />
        <Field label="Λήξη" name="expiresAt" type="date" />
        <div className="grid grid-cols-2 gap-4"><Field label="Θερμοκρασία παραλαβής (°C)" name="receiptTempC" inputMode="decimal" /><Field label="Παρατήρηση" name="receiptIssue" maxLength={120} hint="π.χ. σχισμένη συσκευασία" /></div>
        <div className="sm:col-span-3 sm:justify-self-end"><Submit className={btn("default")}><Plus /> Προσθήκη γραμμής</Submit></div>
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

  return (
    <Page section="Αποθήκη & αγορές" title={`Τιμολόγιο ${doc.number ?? ""} — ${doc.supplier.name}`}
      description={`${day(doc.issuedAt)} · παραλαβή σε ${doc.warehouse.name} · ${doc.status === "DRAFT" ? "πρόχειρο" : doc.status === "POSTED" ? "καταχωρημένο" : "ακυρωμένο"} από ${doc.createdByName}`}
      actions={draft && can("purchases.edit") ? <span className="flex gap-2"><form action={cancelDoc.bind(null, doc.id)}><Submit className={btn("ghost")}><X /> Ακύρωση</Submit></form>{doc.lines.length && !unmatched.length ? <form action={postDoc.bind(null, doc.id)}><Submit className={btn("default")}><Check /> Αποδοχή & καταχώριση αποθέματος</Submit></form> : null}</span> : null}>
      <div className="grid max-w-7xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Το τιμολόγιο ενημερώθηκε</p> : null}
        {q.posted ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Το τιμολόγιο καταχωρήθηκε: αποθέματα, παρτίδες και τιμές ενημερώθηκαν</p> : null}
        {draft && can("purchases.add") ? lineForm : null}
        {draft && unmatched.length && doc.lines.length ? <p className="rounded-lg bg-gold/15 px-4 py-3 text-sm font-medium text-gold-ink">{unmatched.length} γραμμές χωρίς αντιστοίχιση — η αποδοχή απαιτεί όλες αντιστοιχισμένες</p> : null}
        {offAgreement.length ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{offAgreement.length} γραμμές χρεώθηκαν εκτός ειδικής συμφωνίας — η διαφορά είναι προς διεκδίκηση από τον προμηθευτή</p> : null}

        <Card>
          <DataTable
            id={`purchase-${doc.id}-lines`}
            listing={{ ...list, total: lines.length, placeholder: "Γραμμή ή είδος…", showSearch: false }}
            bulkActions={draft && can("purchases.edit") ? [{ value: "remove", label: "Διαγραφή επιλεγμένων γραμμών", confirm: "Οριστική διαγραφή των επιλεγμένων γραμμών από το πρόχειρο;", run: removeLines.bind(null, doc.id) }] : []}
            empty="Καμία γραμμή ακόμα — πρόσθεσε με τη φόρμα παραπάνω ή με σάρωση συσκευασίας"
            columns={[
              { key: "description", label: "Γραμμή τιμολογίου", required: true, sortable: true },
              { key: "quantity", label: "Ποσότητα", numeric: true, sortable: true },
              { key: "price", label: "Τιμή", numeric: true, sortable: true },
              { key: "mapping", label: "Αντιστοίχιση", sortable: true },
              { key: "batch", label: "Παρτίδα / λήξη", sortable: true },
              { key: "receipt", label: "Παραλαβή", sortable: true },
            ]}
            rows={lines.map((l) => {
              const c = checkOf(l);
              const mapping = l.tradeItem ? `${l.tradeItem.name}${l.genericItem ? ` → ${l.genericItem.name}` : ""}` : suggestedName(l) ?? "ασύμβατη";
              return {
                id: l.id,
                cells: {
                  description: <span><span className="font-semibold">{l.description}</span>{l.supplierCode ? <span className="ml-2 text-xs text-muted-foreground">κωδ. {l.supplierCode}</span> : null}{l.ean ? <span className="ml-2 text-xs text-muted-foreground tabular-nums">{l.ean}</span> : null}</span>,
                  quantity: l.quantity,
                  price: <span><span className="tabular-nums">{euro(l.unitPriceCents)}</span>{c?.expectedCents !== undefined && c.diffCents !== 0 ? <span className="mt-0.5 flex justify-end"><Badge tone="danger">εκτός {c.agreement ? "συμφωνίας" : "τιμοκαταλόγου"} · αναμ. {euro(c.expectedCents)}</Badge></span> : c?.agreement && c.diffCents === 0 ? <span className="mt-0.5 flex justify-end"><Badge tone="success">συμφωνία</Badge></span> : null}</span>,
                  mapping: l.tradeItem ? <span>{l.tradeItem.name} {l.genericItem ? <span className="text-muted-foreground">→ {l.genericItem.name}</span> : <Badge tone="warning">χωρίς γενικό</Badge>} <span className="text-xs text-muted-foreground">({MATCH_LABEL[l.matchNote ?? ""] ?? ""})</span></span> : suggestedName(l) ? <Badge tone="warning">πρόταση: {suggestedName(l)}</Badge> : <Badge tone="danger">ασύμβατη</Badge>,
                  batch: <span className="text-xs">{l.batchNumber ?? "—"}{l.expiresAt ? ` · λήξη ${day(l.expiresAt)}` : ""}</span>,
                  receipt: <span className="text-xs">{l.receiptTempC != null ? `${String(l.receiptTempC).replace(".", ",")} °C` : "—"}{l.receiptIssue ? <span className="text-destructive"> {l.receiptIssue}</span> : ""}</span>,
                },
                details: {
                  label: l.description,
                  view: <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Αντιστοίχιση</dt><dd className="font-medium">{mapping}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Παρτίδα / λήξη</dt><dd className="font-medium">{l.batchNumber ?? "—"}{l.expiresAt ? ` · ${day(l.expiresAt)}` : ""}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Θερμοκρασία</dt><dd className="font-medium">{l.receiptTempC != null ? `${String(l.receiptTempC).replace(".", ",")} °C` : "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Παρατήρηση</dt><dd className="font-medium">{l.receiptIssue ?? "—"}</dd></div>
                  </dl>,
                  edit: draft && can("purchases.edit") ? rematchForm(l) : undefined,
                },
                menu: draft && can("purchases.edit") ? <form action={removeLine.bind(null, l.id, doc.id)}><Submit className={menuItem}><Trash2 /> Διαγραφή γραμμής</Submit></form> : undefined,
              };
            })}
          />
        </Card>
        <p className="text-xs text-muted-foreground">Η αποδοχή γράφει τις ποσότητες στη βασική μονάδα του γενικού είδους, δημιουργεί παρτίδες με λήξη και ενημερώνει τον τιμοκατάλογο του προμηθευτή</p>
      </div>
    </Page>
  );
}
