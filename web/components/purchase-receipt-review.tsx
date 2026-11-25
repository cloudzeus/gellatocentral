import { euro } from "@/lib/money";
import { Badge } from "@/components/ui";

export type ReceiptDiscrepancyView = {
  id: string;
  basis: string;
  kind: string;
  expectedPriceCents: number;
  actualPriceCents: number;
  reason: string;
};

type Props = {
  reviewStatus: string;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  discrepancies: readonly ReceiptDiscrepancyView[];
};

const dayTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" });

/** Κοινή, read-only παρουσίαση του τιμολογιακού ελέγχου σε παραγγελία, παραλαβή και τιμολόγιο. */
export function PurchaseReceiptReview({ reviewStatus, reviewedAt, reviewedByName, reviewNote, discrepancies }: Props) {
  const reviewed = reviewStatus === "REVIEWED";
  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Τιμολογιακός έλεγχος</strong>
        <Badge tone={reviewed ? "success" : "warning"}>{reviewed ? "Ελέγχθηκε" : "Με επιφύλαξη"}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {reviewed
          ? `Ο έλεγχος ολοκληρώθηκε${reviewedAt ? ` στις ${dayTime.format(reviewedAt)}` : ""}${reviewedByName ? ` από ${reviewedByName}` : ""}.`
          : "Η παραλαβή παραμένει μη χρηματοοικονομική και δεν μπορεί να συνδεθεί με τιμολόγιο πριν από ρητή αποδοχή του ελέγχου."}
      </p>
      {discrepancies.length ? (
        <ul className="grid gap-2">
          {discrepancies.map((item) => (
            <li key={item.id} className="rounded-md border border-gold/40 bg-gold/10 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warning">{item.basis === "AGREEMENT" ? "Ειδική συμφωνία" : "Προηγούμενη πραγματική αγορά"}</Badge>
                <span className="text-xs font-semibold">{item.kind === "AGREEMENT_MISMATCH" ? "Ασυμφωνία τιμής" : "Αύξηση άνω του 5%"}</span>
              </div>
              <p className="mt-2 text-xs">{item.reason}</p>
              <p className="mt-1 text-xs tabular-nums">Αναμενόμενη / προηγούμενη: <strong>{euro(item.expectedPriceCents)}</strong> · Παραλαβή: <strong>{euro(item.actualPriceCents)}</strong></p>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">Δεν έχει καταγραφεί τιμολογιακή ασυμφωνία.</p>}
      {reviewNote ? <p className="border-t border-border/60 pt-2 text-xs"><strong>Σχόλιο ελέγχου:</strong> {reviewNote}</p> : null}
    </div>
  );
}
