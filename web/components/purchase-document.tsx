import { FileText } from "lucide-react";
import { euro } from "@/lib/money";
import { calculatePurchaseDocument, type DocumentParty, type PurchaseExpenses, type PurchaseLineAmounts } from "@/lib/purchase-document";
import { cn } from "@/lib/utils";

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
const STATUS = { DRAFT: "ΠΡΟΧΕΙΡΟ", POSTED: "ΚΑΤΑΧΩΡΗΜΕΝΟ", CANCELLED: "ΑΚΥΡΩΜΕΝΟ" } as const;

function PartyBlock({ title, party, align = "left" }: { title: string; party: DocumentParty; align?: "left" | "right" }) {
  const address = [party.address, [party.postalCode, party.city].filter(Boolean).join(" "), party.countryCode && party.countryCode !== "GR" ? party.countryCode : null].filter(Boolean).join(" · ");
  return (
    <section className={cn("min-w-0", align === "right" && "sm:text-right")} aria-label={title}>
      <h3 className="mb-1.5 text-[10px] font-bold tracking-widest text-neutral-500">{title}</h3>
      <p className="break-words text-sm font-bold leading-snug text-neutral-950">{party.name}</p>
      {party.tradeName && party.tradeName !== party.name ? <p className="break-words text-xs text-neutral-600">{party.tradeName}</p> : null}
      <div className="mt-1.5 space-y-0.5 text-xs leading-relaxed text-neutral-700">
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
      <header className="border-b-2 border-neutral-800 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-neutral-500">GELATO SYSTEM · ΑΠΟΘΗΚΗ & ΑΓΟΡΕΣ</p>
            <h2 className="mt-1 text-base font-bold tracking-tight sm:text-lg print:text-base">ΤΙΜΟΛΟΓΙΟ ΑΓΟΡΑΣ</h2>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-lg font-bold tabular-nums">{doc.number ?? "Χωρίς αριθμό"}</p>
            <p className="text-xs font-semibold text-neutral-600">Ημερομηνία: {doc.issuedAt}</p>
            <p className="mt-1 text-[10px] font-bold tracking-wider text-neutral-500">{STATUS[doc.status]}{doc.source === "ocr" ? " · OCR" : doc.source === "mydata" ? " · myDATA" : ""}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 border-b border-neutral-300 py-5 sm:grid-cols-2 sm:gap-10">
        <PartyBlock title="ΠΡΟΜΗΘΕΥΤΗΣ / ΕΚΔΟΤΗΣ" party={doc.supplier} />
        <PartyBlock title="ΑΓΟΡΑΣΤΗΣ / ΠΑΡΑΛΗΠΤΗΣ" party={doc.buyer} align="right" />
      </div>

      <dl className="grid gap-x-5 gap-y-3 border-b border-neutral-300 py-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="font-semibold text-neutral-500">Αποθήκη παραλαβής</dt><dd className="mt-0.5 break-words font-medium">{doc.warehouse}</dd></div>
        <div><dt className="font-semibold text-neutral-500">Πληρωμή</dt><dd className="mt-0.5 break-words font-medium">{doc.paymentMethod ?? "—"}{doc.paymentTerms ? ` · ${doc.paymentTerms}` : ""}</dd></div>
        <div><dt className="font-semibold text-neutral-500">Αποστολή</dt><dd className="mt-0.5 break-words font-medium">{doc.shippingMethod ?? "—"}</dd></div>
        <div><dt className="font-semibold text-neutral-500">Διεύθυνση παράδοσης</dt><dd className="mt-0.5 break-words font-medium">{doc.shippingAddress ?? "—"}</dd></div>
        {doc.mydataMark ? <div className="sm:col-span-2 lg:col-span-4"><dt className="font-semibold text-neutral-500">ΜΑΡΚ myDATA</dt><dd className="mt-0.5 break-all font-mono text-[11px]">{doc.mydataMark}</dd></div> : null}
      </dl>

      <div className="mt-4 overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[850px] border-collapse text-left text-xs print:min-w-0 print:text-[9px]">
          <thead>
            <tr className="border-y border-neutral-700 bg-neutral-100 text-[10px] uppercase tracking-wide print:bg-white">
              <th className="px-2 py-2 font-bold">Περιγραφή / κωδικός</th>
              <th className="px-2 py-2 text-right font-bold">Ποσότητα</th>
              <th className="px-2 py-2 text-right font-bold">Τιμή μονάδας</th>
              <th className="px-2 py-2 text-right font-bold">Αρχική αξία</th>
              <th className="px-2 py-2 text-right font-bold">Έκπτωση</th>
              <th className="px-2 py-2 text-right font-bold">Καθαρή αξία</th>
              <th className="px-2 py-2 text-right font-bold">ΦΠΑ</th>
              <th className="px-2 py-2 text-right font-bold">Ποσό ΦΠΑ</th>
              <th className="px-2 py-2 text-right font-bold">Σύνολο γραμμής</th>
            </tr>
          </thead>
          <tbody>
            {totals.lines.map((line) => (
              <tr key={line.id} className="border-b border-neutral-200 align-top">
                <td className="max-w-64 px-2 py-2.5"><span className="block break-words font-semibold">{line.description}</span><span className="mt-0.5 block text-[10px] text-neutral-500">{[line.supplierCode && `Κωδ. ${line.supplierCode}`, line.batchNumber && `Παρτίδα ${line.batchNumber}`, line.expiresAt && `Λήξη ${line.expiresAt}`].filter(Boolean).join(" · ") || "—"}</span></td>
                <td className="px-2 py-2.5 text-right tabular-nums">{line.quantity}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{euro(line.unitPriceCents)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{euro(line.grossCents)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{percent.format(line.discountBps / 100)}%<span className="block text-[10px] text-neutral-500">−{euro(line.discountCents)}</span></td>
                <td className="px-2 py-2.5 text-right tabular-nums">{euro(line.netCents)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{line.vatRate}%</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{euro(line.vatCents)}</td>
                <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{euro(line.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!doc.lines.length ? <p className="border-b border-neutral-200 py-6 text-center text-sm text-neutral-500">Δεν έχουν καταχωριστεί γραμμές.</p> : null}
      </div>

      <footer className="mt-5 grid gap-5 sm:grid-cols-[1fr_minmax(280px,380px)] print:grid-cols-[1fr_320px]">
        <div className="space-y-4 text-xs">
          <div>
            <h3 className="mb-2 font-bold">ΑΝΑΛΥΣΗ ΦΠΑ</h3>
            <table className="w-full max-w-sm border-collapse">
              <thead><tr className="border-y border-neutral-300 text-neutral-500"><th className="py-1.5 text-left font-medium">Συντελεστής</th><th className="py-1.5 text-right font-medium">Καθαρή αξία</th><th className="py-1.5 text-right font-medium">ΦΠΑ</th></tr></thead>
              <tbody>{totals.vat.map((group) => <tr key={group.vatRate} className="border-b border-neutral-200 tabular-nums"><td className="py-1.5">{group.vatRate}%</td><td className="py-1.5 text-right">{euro(group.netCents)}</td><td className="py-1.5 text-right">{euro(group.vatCents)}</td></tr>)}</tbody>
            </table>
          </div>
          {doc.note ? <div><h3 className="font-bold text-neutral-500">ΣΗΜΕΙΩΣΕΙΣ</h3><p className="mt-1 whitespace-pre-wrap break-words">{doc.note}</p></div> : null}
          {doc.attachments?.length ? <div className="print:hidden"><h3 className="font-bold text-neutral-500">ΠΡΩΤΟΤΥΠΟ ΑΡΧΕΙΟ</h3><ul className="mt-1 space-y-1">{doc.attachments.map((file) => <li key={file.id}><a href={file.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 break-words underline underline-offset-2"><FileText className="size-3.5 shrink-0" />{file.name}</a></li>)}</ul></div> : null}
        </div>
        <dl className="self-start border-t-2 border-neutral-800 text-xs">
          <div className="flex justify-between gap-4 border-b border-neutral-200 py-2"><dt>Αρχική αξία ειδών</dt><dd className="tabular-nums">{euro(totals.grossCents)}</dd></div>
          <div className="flex justify-between gap-4 border-b border-neutral-200 py-2"><dt>Εκπτώσεις</dt><dd className="tabular-nums">−{euro(totals.discountCents)}</dd></div>
          <div className="flex justify-between gap-4 border-b border-neutral-200 py-2"><dt>Καθαρή αξία ειδών</dt><dd className="tabular-nums">{euro(totals.netCents)}</dd></div>
          {doc.shippingCostCents ? <div className="flex justify-between gap-4 border-b border-neutral-200 py-2"><dt>Μεταφορικά προ ΦΠΑ</dt><dd className="tabular-nums">{euro(doc.shippingCostCents)}</dd></div> : null}
          {doc.otherExpensesCents ? <div className="flex justify-between gap-4 border-b border-neutral-200 py-2"><dt>Λοιπά έξοδα προ ΦΠΑ</dt><dd className="tabular-nums">{euro(doc.otherExpensesCents)}</dd></div> : null}
          <div className="flex justify-between gap-4 border-b border-neutral-200 py-2"><dt>Σύνολο ΦΠΑ</dt><dd className="tabular-nums">{euro(totals.totalVatCents)}</dd></div>
          <div className="flex items-baseline justify-between gap-4 py-3 text-base font-bold"><dt>ΓΕΝΙΚΟ ΣΥΝΟΛΟ</dt><dd className="whitespace-nowrap text-xl tabular-nums">{euro(totals.totalCents)}</dd></div>
        </dl>
      </footer>
      <p className="mt-5 border-t border-neutral-200 pt-3 text-[10px] text-neutral-500">Εσωτερική αναπαράσταση των καταχωρισμένων δεδομένων αγοράς. Το πρωτότυπο φορολογικό στοιχείο είναι το έγγραφο του εκδότη.</p>
    </article>
  );
}
