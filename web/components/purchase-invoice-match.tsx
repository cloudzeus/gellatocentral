import { euro } from "@/lib/money";
import { Badge } from "@/components/ui";

export type InvoiceDiscrepancyView = {
  id: string;
  basis: string;
  kind: string;
  expectedQuantityBase: number | null;
  actualQuantityBase: number | null;
  expectedUnitPriceCents: number | null;
  actualUnitPriceCents: number | null;
  expectedVatRate: number | null;
  actualVatRate: number | null;
  reason: string;
};

type Props = {
  status: string;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  discrepancies: readonly InvoiceDiscrepancyView[];
};

const dayTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" });
const quantity = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });
const KIND = { QUANTITY_MISMATCH: "Απόκλιση ποσότητας", PRICE_MISMATCH: "Απόκλιση καθαρής τιμής", VAT_MISMATCH: "Λογιστική απόκλιση ΦΠΑ" } as const;
const BASIS = { AGREEMENT: "Ειδική συμφωνία", ORDER: "Παραγγελία", RECEIPT: "Παραλαβή", ACCOUNTING: "Λογιστικός έλεγχος" } as const;

/** Read-only κατάσταση three-way match για παραγγελία, παραλαβή και συνδεδεμένο τιμολόγιο. */
export function PurchaseInvoiceMatch({ status, reviewedAt, reviewedByName, reviewNote, discrepancies }: Props) {
  const accepted = status === "MATCHED" || status === "REVIEWED";
  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Τριπλή συμφωνία τιμολογίου</strong>
        <Badge tone={accepted ? "success" : "warning"}>
          {status === "MATCHED" ? "Πλήρης ταυτοποίηση" : status === "REVIEWED" ? "Εγκρίθηκε με αποκλίσεις" : status === "DISCREPANCY" ? "Απαιτεί αιτιολογημένη αποδοχή" : "Εκκρεμεί τιμολόγιο"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {status === "DISCREPANCY"
          ? "Το τιμολόγιο παραμένει πρόχειρο και εκτός οφειλής, ΦΠΑ και οικονομικών αναφορών μέχρι την οριστική αποδοχή."
          : status === "REVIEWED"
            ? `Οι αποκλίσεις εγκρίθηκαν${reviewedAt ? ` στις ${dayTime.format(reviewedAt)}` : ""}${reviewedByName ? ` από ${reviewedByName}` : ""}.`
            : "Συγκρίνονται παραγγελία, συγκεκριμένη παραλαβή και πραγματικές γραμμές τιμολογίου. Η ροή υποστηρίζει μία παραλαβή ανά τιμολόγιο."}
      </p>
      {discrepancies.length ? <ul className="grid gap-2">{discrepancies.map((item) => <li key={item.id} className="rounded-md border border-warning/40 bg-warning/10 p-3">
        <div className="flex flex-wrap items-center gap-2"><Badge tone="warning">{BASIS[item.basis as keyof typeof BASIS] ?? item.basis}</Badge><span className="text-xs font-semibold">{KIND[item.kind as keyof typeof KIND] ?? item.kind}</span></div>
        <p className="mt-2 text-xs">{item.reason}</p>
        {item.expectedQuantityBase != null ? <p className="mt-1 text-xs tabular-nums">Παραλαβή: <strong>{quantity.format(item.expectedQuantityBase)}</strong> · Τιμολόγιο: <strong>{quantity.format(item.actualQuantityBase ?? 0)}</strong> base units</p> : null}
        {item.expectedUnitPriceCents != null ? <p className="mt-1 text-xs tabular-nums">Αναμενόμενη καθαρή τιμή: <strong>{euro(item.expectedUnitPriceCents)}</strong> · Τιμολόγιο: <strong>{euro(item.actualUnitPriceCents ?? 0)}</strong> ανά kg/l/1.000 τεμ.</p> : null}
        {item.expectedVatRate != null ? <p className="mt-1 text-xs tabular-nums">Αναμενόμενος ΦΠΑ: <strong>{item.expectedVatRate}%</strong> · Τιμολόγιο: <strong>{item.actualVatRate ?? 0}%</strong></p> : null}
      </li>)}</ul> : <p className="text-xs text-muted-foreground">Δεν έχει καταγραφεί απόκλιση τιμολογίου.</p>}
      {reviewNote ? <p className="border-t border-border/60 pt-2 text-xs"><strong>Αιτιολογία αποδοχής:</strong> {reviewNote}</p> : null}
    </div>
  );
}
