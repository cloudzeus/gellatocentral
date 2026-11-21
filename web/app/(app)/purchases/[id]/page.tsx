import { notFound } from "next/navigation";
import { Check, Link2, Plus, Trash2, X } from "lucide-react";
import { BarcodeField } from "@/components/barcode-field";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { priceCheck } from "@/lib/purchase-pricing";
import { perPackCents } from "@/lib/purchases";
import { addLine, cancelDoc, postDoc, rematchLine, removeLine } from "../actions";

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("el-GR", { timeZone: "UTC" }).format(d) : "—");
const MATCH_LABEL: Record<string, string> = { code: "κωδικός", ean: "barcode", manual: "χειροκίνητα" };

// Καρτέλα τιμολογίου αγοράς: γραμμές όπως ήρθαν, αντιστοίχιση με είδη, και αποδοχή που γράφει
// αποθέματα/παρτίδες/τιμές σε μία συναλλαγή.
export default async function PurchaseDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, can } = await currentOrg("purchases.read");
  const { id } = await params;
  const q = await searchParams;
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
  // οι προτάσεις fuzzy έχουν matchNote «suggest:<tradeItemId>» — βρίσκουμε τα ονόματά τους
  const suggestedIds = doc.lines.map((l) => l.matchNote?.match(/^suggest:(.+)$/)?.[1]).filter((x): x is string => !!x);
  const suggested = suggestedIds.length ? await db.tradeItem.findMany({ where: { id: { in: suggestedIds } } }) : [];
  const suggestedName = (l: (typeof doc.lines)[number]) => suggested.find((t) => t.id === l.matchNote?.slice(8))?.name;
  const unmatched = doc.lines.filter((l) => !l.genericItemId);

  // Έλεγχος κάθε γραμμής έναντι της ισχύουσας τιμής/συμφωνίας του προμηθευτή (§7γ)
  const at = doc.issuedAt ?? doc.createdAt;
  const checkOf = (l: (typeof doc.lines)[number]) =>
    l.supplierItem ? priceCheck(perPackCents(l.unitPriceCents, l.supplierItem.packQty), l.supplierItem.prices, l.quantity * l.supplierItem.packQty, at) : undefined;
  const offAgreement = doc.lines.filter((l) => { const c = checkOf(l); return c?.agreement && c.diffCents !== 0; });

  const lineForm = (
    <Card>
      <form action={addLine} className="grid gap-4 p-5 sm:grid-cols-3">
        <input type="hidden" name="documentId" value={doc.id} />
        <Field label="Περιγραφή (όπως στο τιμολόγιο)" name="description" required minLength={2} maxLength={120} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Ποσότητα" name="quantity" required inputMode="numeric" hint="στη μονάδα του παραστατικού" />
          <Field label="Τιμή μονάδας προ ΦΠΑ (€)" name="unitPrice" required inputMode="decimal" />
        </div>
        <Field label="Κωδικός προμηθευτή" name="supplierCode" maxLength={40} />
        <BarcodeField label="Barcode / GS1" name="ean" hint="EAN-13, GTIN-14 ή GS1 — γεμίζει και παρτίδα/λήξη" />
        <Field label="Παρτίδα" name="batchNumber" maxLength={20} />
        <Field label="Λήξη" name="expiresAt" type="date" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Θερμοκρασία παραλαβής (°C)" name="receiptTempC" inputMode="decimal" />
          <Field label="Παρατήρηση" name="receiptIssue" maxLength={120} hint="π.χ. σχισμένη συσκευασία" />
        </div>
        <div className="sm:col-span-3 sm:justify-self-end"><Submit className={btn("default")}><Plus /> Προσθήκη γραμμής</Submit></div>
      </form>
    </Card>
  );

  const rematchModal = (l: (typeof doc.lines)[number]) => (
    <Modal label={<><Link2 /> Αντιστοίχιση</>} size="sm" title={`Αντιστοίχιση: ${l.description}`}>
      <form action={rematchLine} className="grid gap-4 [&>button]:justify-self-end">
        <input type="hidden" name="lineId" value={l.id} />
        <input type="hidden" name="documentId" value={doc.id} />
        <Select label="Είδος προμηθευτή" name="supplierItemId" required
          options={supplierItems.map((s): [string, string] => [s.id, `${s.tradeItem.name}${s.supplierCode ? ` · ${s.supplierCode}` : ""} (×${s.packQty})`])} />
        <Submit className={btn("default")}>Εφαρμογή</Submit>
      </form>
    </Modal>
  );

  return (
    <Page section="Αποθήκη & αγορές" title={`Τιμολόγιο ${doc.number ?? ""} — ${doc.supplier.name}`}
      description={`${day(doc.issuedAt)} · παραλαβή σε ${doc.warehouse.name} · ${doc.status === "DRAFT" ? "πρόχειρο" : doc.status === "POSTED" ? "καταχωρημένο" : "ακυρωμένο"} από ${doc.createdByName}`}
      actions={draft && can("purchases.edit") ? (
        <span className="flex gap-2">
          <form action={cancelDoc.bind(null, doc.id)}><Submit className={btn("ghost")}><X /> Ακύρωση</Submit></form>
          {doc.lines.length && !unmatched.length ? <form action={postDoc.bind(null, doc.id)}><Submit className={btn("default")}><Check /> Αποδοχή & καταχώριση αποθέματος</Submit></form> : null}
        </span>
      ) : null}>
      <div className="grid max-w-6xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η γραμμή αποθηκεύτηκε</p> : null}
        {q.posted ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Το τιμολόγιο καταχωρήθηκε: αποθέματα, παρτίδες και τιμές ενημερώθηκαν</p> : null}
        {draft && can("purchases.add") ? lineForm : null}
        {draft && unmatched.length && doc.lines.length ? (
          <p className="rounded-lg bg-gold/15 px-4 py-3 text-sm font-medium text-gold-ink">{unmatched.length} γραμμές χωρίς αντιστοίχιση — η αποδοχή απαιτεί όλες αντιστοιχισμένες</p>
        ) : null}
        {offAgreement.length ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {offAgreement.length} γραμμές χρεώθηκαν εκτός ειδικής συμφωνίας — η συμφωνία δεν θα αλλάξει, η διαφορά είναι προς διεκδίκηση από τον προμηθευτή
          </p>
        ) : null}

        {doc.lines.length ? (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Γραμμή τιμολογίου</th><th className="px-3 py-2 text-right font-semibold">Ποσότητα</th><th className="px-3 py-2 text-right font-semibold">Τιμή</th><th className="px-3 py-2 font-semibold">Αντιστοίχιση</th><th className="px-3 py-2 font-semibold">Παρτίδα / λήξη</th><th className="px-3 py-2 font-semibold">Παραλαβή</th><th className="px-5 py-2" /></tr></thead>
              <tbody>
                {doc.lines.map((l) => {
                  const c = checkOf(l);
                  return (
                  <tr key={l.id} className="border-t border-border/70">
                    <td className="px-5 py-2">
                      <span className="font-medium">{l.description}</span>
                      {l.supplierCode ? <span className="ml-2 text-xs text-muted-foreground">κωδ. {l.supplierCode}</span> : null}
                      {l.ean ? <span className="ml-2 text-xs text-muted-foreground tabular-nums">{l.ean}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="tabular-nums">{euro(l.unitPriceCents)}</span>
                      {c?.expectedCents !== undefined && c.diffCents !== 0 ? (
                        <span className="mt-0.5 flex justify-end"><Badge tone="danger">εκτός {c.agreement ? "συμφωνίας" : "τιμοκαταλόγου"} · αναμ. {euro(c.expectedCents)}</Badge></span>
                      ) : c?.agreement && c.diffCents === 0 ? (
                        <span className="mt-0.5 flex justify-end"><Badge tone="success">συμφωνία</Badge></span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {l.tradeItem ? (
                        <span>{l.tradeItem.name} {l.genericItem ? <span className="text-muted-foreground">→ {l.genericItem.name}</span> : <Badge tone="warning">χωρίς γενικό</Badge>} <span className="text-xs text-muted-foreground">({MATCH_LABEL[l.matchNote ?? ""] ?? ""})</span></span>
                      ) : suggestedName(l) ? (
                        <span className="flex flex-wrap items-center gap-2"><Badge tone="warning">πρόταση: {suggestedName(l)}</Badge>
                          {draft ? rematchModal(l) : null}
                        </span>
                      ) : (
                        <Badge tone="danger">ασύμβατη</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{l.batchNumber ?? "—"}{l.expiresAt ? ` · λήξη ${day(l.expiresAt)}` : ""}</td>
                    <td className="px-3 py-2 text-xs">{l.receiptTempC != null ? `${String(l.receiptTempC).replace(".", ",")} °C` : ""}{l.receiptIssue ? <span className="text-destructive"> {l.receiptIssue}</span> : ""}</td>
                    <td className="px-5 py-1.5">
                      {draft && can("purchases.edit") ? (
                        <span className="flex justify-end gap-1">
                          {!l.tradeItem && !suggestedName(l) ? rematchModal(l) : null}
                          {l.tradeItem ? rematchModal(l) : null}
                          <form action={removeLine.bind(null, l.id, doc.id)}><Submit className={btn("ghost", "sm")}><Trash2 /></Submit></form>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card className="p-8 text-center text-sm text-muted-foreground">Καμία γραμμή ακόμα — πρόσθεσε με τη φόρμα παραπάνω ή με σάρωση συσκευασίας</Card>
        )}
        <p className="text-xs text-muted-foreground">Η αποδοχή γράφει τις ποσότητες στη βασική μονάδα του γενικού είδους (ποσότητα × πολλαπλότητα × περιεχόμενο συσκευασίας), δημιουργεί παρτίδες με λήξη και ενημερώνει τον τιμοκατάλογο του προμηθευτή αν άλλαξε η τιμή</p>
      </div>
    </Page>
  );
}
