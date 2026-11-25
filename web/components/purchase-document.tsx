import { FileText } from "lucide-react";
import { euro } from "@/lib/money";
import { calculatePurchaseDocument, type DocumentParty, type PurchaseExpenses, type PurchaseLineAmounts } from "@/lib/purchase-document";
import { cn } from "@/lib/utils";
import { statusOf } from "@/lib/status";

export type PurchaseDocumentLine = PurchaseLineAmounts & {
  id: string;
  description: string;
  supplierCode: string | null;
  batchNumber: string | null;
  expiresAt: string | null;
};

export type PurchaseDocumentData = PurchaseExpenses & {
  number: string | null;
  issuedAt: string;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  source: string;
  mydataMark: string | null;
  warehouse: string;
  supplier: DocumentParty;
  buyer: DocumentParty;
  paymentMethod: string | null;
  paymentTerms: string | null;
  shippingMethod: string | null;
  shippingAddress: string | null;
  note: string | null;
  lines: PurchaseDocumentLine[];
  attachments?: { id: string; name: string; url: string }[];
};

const percent = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 2 });

function PartyBlock({ title, party, align = "left" }: { title: string; party: DocumentParty; align?: "left" | "right" }) {
  const address = [party.address, [party.postalCode, party.city].filter(Boolean).join(" "), party.countryCode && party.countryCode !== "GR" ? party.countryCode : null].filter(Boolean).join(" · ");
  return (
    <section className={cn("min-w-0", align === "right" && "sm:text-right")} aria-label={title}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{title}</h3>
      <p className="break-words text-base font-semibold leading-snug text-neutral-950">{party.name}</p>
      {party.tradeName && party.tradeName !== party.name ? <p className="mt-0.5 break-words text-sm text-neutral-500">{party.tradeName}</p> : null}
      <div className="mt-2 space-y-1 text-xs leading-relaxed text-neutral-600">
        {address ? <p className="break-words">{address}</p> : null}
        <p>ΑΦΜ: {party.vatNumber ?? "—"}{party.taxOffice ? ` · ΔΟΥ: ${party.taxOffice}` : ""}</p>
        {party.profession ? <p className="break-words">{party.profession}</p> : null}
        {party.phone || party.email ? <p className="break-words">{[party.phone, party.email].filter(Boolean).join(" · ")}</p> : null}
      </div>
    </section>
  );
}

/** Server-rendered αναπαράσταση αγοράς: ίδιο markup στην ανάπτυξη λίστας, στην καρτέλα και στην εκτύπωση. */
export function PurchaseDocument({ doc, compact = false }: { doc: PurchaseDocumentData; compact?: boolean }) {
  const totals = calculatePurchaseDocument(doc.lines, doc);
  return (
    <article className={cn("purchase-document min-w-0 rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-[var(--shadow-card)] print:rounded-none print:border-0 print:shadow-none", compact ? "p-4 sm:p-5" : "mx-auto w-full max-w-6xl p-5 sm:p-8 print:max-w-none print:p-0")}>
      <header className="border-b border-neutral-300 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Gelato System · Αποθήκη & αγορές</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl print:text-lg">Τιμολόγιο αγοράς</h2>
          </div>
          <dl className="min-w-40 text-left sm:text-right">
            <div>
              <dt className="text-[11px] font-medium text-neutral-500">Αριθμός τιμολογίου</dt>
              <dd className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{doc.number ?? "Χωρίς αριθμό"}</dd>
            </div>
            <div className="mt-1.5 flex gap-1.5 text-xs sm:justify-end">
              <dt className="text-neutral-500">Ημερομηνία</dt>
              <dd className="font-medium tabular-nums">{doc.issuedAt}</dd>
            </div>
            <div className="mt-1.5">
              <dt className="sr-only">Κατάσταση</dt>
              <dd className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{statusOf("purchase", doc.status).text}{doc.source === "ocr" ? " · OCR" : doc.source === "mydata" ? " · myDATA" : ""}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="grid gap-5 border-b border-neutral-200 py-5 sm:grid-cols-2 sm:gap-10">
        <PartyBlock title="Προμηθευτής / εκδότης" party={doc.supplier} />
        <PartyBlock title="Αγοραστής / παραλήπτης" party={doc.buyer} align="right" />
      </div>

      <dl className="grid gap-x-5 gap-y-4 border-b border-neutral-200 py-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs font-medium text-neutral-500">Αποθήκη παραλαβής</dt><dd className="mt-1 break-words font-medium">{doc.warehouse}</dd></div>
        <div><dt className="text-xs font-medium text-neutral-500">Πληρωμή</dt><dd className="mt-1 break-words font-medium">{doc.paymentMethod ?? "—"}{doc.paymentTerms ? ` · ${doc.paymentTerms}` : ""}</dd></div>
        <div><dt className="text-xs font-medium text-neutral-500">Αποστολή</dt><dd className="mt-1 break-words font-medium">{doc.shippingMethod ?? "—"}</dd></div>
        <div><dt className="text-xs font-medium text-neutral-500">Διεύθυνση παράδοσης</dt><dd className="mt-1 break-words font-medium">{doc.shippingAddress ?? "—"}</dd></div>
        {doc.mydataMark ? <div className="sm:col-span-2 lg:col-span-4"><dt className="text-xs font-medium text-neutral-500">ΜΑΡΚ myDATA</dt><dd className="mt-1 break-all font-mono text-xs">{doc.mydataMark}</dd></div> : null}
      </dl>

      <section className="mt-5 overflow-x-auto print:overflow-visible" aria-label="Γραμμές παραστατικού">
        <table className="w-full min-w-[850px] border-collapse text-left text-sm print:min-w-0 print:text-[9px]">
          <caption className="sr-only">Γραμμές τιμολογίου αγοράς με ποσότητες, τιμές και ΦΠΑ</caption>
          <thead>
            <tr className="border-y border-neutral-300 bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-600 print:bg-white">
              <th scope="col" className="px-2 py-2.5 font-semibold">Περιγραφή / κωδικός</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Ποσότητα</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Τιμή μονάδας</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Αρχική αξία</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Έκπτωση</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Καθαρή αξία</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">ΦΠΑ</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Ποσό ΦΠΑ</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Σύνολο γραμμής</th>
            </tr>
          </thead>
          <tbody>
            {totals.lines.map((line) => (
              <tr key={line.id} className="border-b border-neutral-200 align-top leading-relaxed">
                <td className="max-w-64 px-2 py-3"><span className="block break-words font-semibold">{line.description}</span><span className="mt-1 block text-[11px] leading-relaxed text-neutral-500">{[line.supplierCode && `Κωδ. ${line.supplierCode}`, line.batchNumber && `Παρτίδα ${line.batchNumber}`, line.expiresAt && `Λήξη ${line.expiresAt}`].filter(Boolean).join(" · ") || "—"}</span></td>
                <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">{line.quantity}</td>
                <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">{euro(line.unitPriceCents)}</td>
                <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">{euro(line.grossCents)}</td>
                <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">{percent.format(line.discountBps / 100)}%<span className="block text-[11px] text-neutral-500">−{euro(line.discountCents)}</span></td>
                <td className="px-2 py-3 text-right font-medium whitespace-nowrap tabular-nums">{euro(line.netCents)}</td>
                <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">{line.vatRate}%</td>
                <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">{euro(line.vatCents)}</td>
                <td className="px-2 py-3 text-right font-semibold whitespace-nowrap tabular-nums">{euro(line.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!doc.lines.length ? <p className="border-b border-neutral-200 py-6 text-center text-sm text-neutral-500">Δεν έχουν καταχωριστεί γραμμές.</p> : null}
      </section>

      <footer className="mt-6 grid gap-6 sm:grid-cols-[1fr_minmax(280px,380px)] print:grid-cols-[1fr_320px]">
        <div className="space-y-5 text-sm">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Ανάλυση ΦΠΑ</h3>
            <table className="w-full max-w-sm border-collapse">
              <caption className="sr-only">Καθαρή αξία και ποσό ΦΠΑ ανά συντελεστή</caption>
              <thead><tr className="border-y border-neutral-200 text-xs text-neutral-500"><th scope="col" className="py-2 text-left font-medium">Συντελεστής</th><th scope="col" className="py-2 text-right font-medium">Καθαρή αξία</th><th scope="col" className="py-2 text-right font-medium">ΦΠΑ</th></tr></thead>
              <tbody>{totals.vat.map((group) => <tr key={group.vatRate} className="border-b border-neutral-200 tabular-nums"><td className="py-2">{group.vatRate}%</td><td className="py-2 text-right">{euro(group.netCents)}</td><td className="py-2 text-right">{euro(group.vatCents)}</td></tr>)}</tbody>
            </table>
          </div>
          {doc.note ? <div><h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Σημειώσεις</h3><p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{doc.note}</p></div> : null}
          {doc.attachments?.length ? <div className="print:hidden"><h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Πρωτότυπο αρχείο</h3><ul className="mt-2 space-y-1">{doc.attachments.map((file) => <li key={file.id}><a href={file.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 break-words underline underline-offset-2"><FileText className="size-3.5 shrink-0" />{file.name}</a></li>)}</ul></div> : null}
        </div>
        <dl className="self-start border-t border-neutral-400 text-sm" aria-label="Σύνολα τιμολογίου">
          <div className="flex justify-between gap-4 border-b border-neutral-200 py-2.5"><dt className="text-neutral-600">Αρχική αξία ειδών</dt><dd className="font-medium tabular-nums">{euro(totals.grossCents)}</dd></div>
          <div className="flex justify-between gap-4 border-b border-neutral-200 py-2.5"><dt className="text-neutral-600">Εκπτώσεις</dt><dd className="font-medium tabular-nums">−{euro(totals.discountCents)}</dd></div>
          <div className="flex justify-between gap-4 border-b border-neutral-200 py-2.5"><dt className="text-neutral-600">Καθαρή αξία ειδών</dt><dd className="font-medium tabular-nums">{euro(totals.netCents)}</dd></div>
          {doc.shippingCostCents ? <div className="flex justify-between gap-4 border-b border-neutral-200 py-2.5"><dt className="text-neutral-600">Μεταφορικά προ ΦΠΑ</dt><dd className="font-medium tabular-nums">{euro(doc.shippingCostCents)}</dd></div> : null}
          {doc.otherExpensesCents ? <div className="flex justify-between gap-4 border-b border-neutral-200 py-2.5"><dt className="text-neutral-600">Λοιπά έξοδα προ ΦΠΑ</dt><dd className="font-medium tabular-nums">{euro(doc.otherExpensesCents)}</dd></div> : null}
          <div className="flex justify-between gap-4 border-b border-neutral-200 py-2.5"><dt className="text-neutral-600">Σύνολο ΦΠΑ</dt><dd className="font-medium tabular-nums">{euro(totals.totalVatCents)}</dd></div>
          <div className="mt-1 flex items-baseline justify-between gap-4 rounded-lg bg-neutral-100 px-3 py-3 font-semibold print:bg-transparent"><dt>Γενικό σύνολο</dt><dd className="whitespace-nowrap text-2xl tracking-tight tabular-nums">{euro(totals.totalCents)}</dd></div>
        </dl>
      </footer>
      <p className="mt-5 border-t border-neutral-200 pt-3 text-[11px] leading-relaxed text-neutral-500">Εσωτερική αναπαράσταση των καταχωρισμένων δεδομένων αγοράς. Το πρωτότυπο φορολογικό στοιχείο είναι το έγγραφο του εκδότη.</p>
    </article>
  );
}
