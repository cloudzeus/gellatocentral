// Σύγκριση σκαναρισμένου παραστατικού με το myDATA στην καρτέλα του (mockup docs/analysis/mockups/mydata-check.html, Β).
import { RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card } from "@/components/ui";
import type { MydataFound } from "@/lib/mydata-check";
import type { MydataDiff } from "@/lib/mydata-parse";
import { euro } from "@/lib/money";

type Check = { status: string; resolution: string | null; resolvedByName: string | null; diff: unknown; mydata: unknown; error: string | null; checkedAt: Date; recheckUntil: Date | null };
const dt = (d: Date) => new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" }).format(d);
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export function MydataCheckPanel({ check, receipt, recheck, aade, paper, canEdit }: {
  check: Check | null; receipt: boolean; canEdit: boolean;
  recheck: () => Promise<void>; aade: () => Promise<void>; paper: () => Promise<void>;
}) {
  const again = canEdit ? <form action={recheck}><Submit pendingText="Έλεγχος…" className={btn("outline", "sm")}><RefreshCw /> Ξαναέλεγξε τώρα</Submit></form> : null;
  if (!check) return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1"><h2 className="text-sm font-semibold">Έλεγχος με το myDATA</h2><p className="text-sm text-muted-foreground">Δεν έχει ελεγχθεί ακόμα. Χρειάζεται MARK ή ΑΦΜ προμηθευτή και αριθμός.</p></div>
        {again}
      </div>
    </Card>
  );
  const diff = Array.isArray(check.diff) ? (check.diff as MydataDiff[]) : [];
  const m = check.mydata as MydataFound | null;
  const value = check.status === "DIFF" && check.resolution ? "PAPER" : check.status;
  const by = new Map(diff.map((d) => [d.field, d]));
  // όλα τα πεδία: όσα δεν διαφέρουν δείχνουν την ίδια τιμή και στις δύο στήλες
  const rows: [MydataDiff["field"], string, string | null][] = m ? [
    ["vat", "ΑΦΜ εκδότη", m.supplierVat ?? null], ["number", "Αριθμός", [m.series, m.number].filter(Boolean).join("-") || null], ["date", "Ημερομηνία", dmy(m.issuedAt)],
    ...(receipt ? [] : [["net", "Καθαρή αξία", m.netCents == null ? null : euro(m.netCents)], ["vat_amount", "ΦΠΑ", m.vatCents == null ? null : euro(m.vatCents)], ["gross", "Σύνολο", m.grossCents == null ? null : euro(m.grossCents)]] as [MydataDiff["field"], string, string | null][]),
    ["mark", "ΜΑΡΚ", m.mark],
  ] : [];
  const money = diff.some((d) => d.field === "gross" || d.field === "net");
  return (
    <Card>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">Έλεγχος με το myDATA <StatusBadge kind="mydataCheck" value={value} /></h2>
            <p className="text-xs text-muted-foreground">Ελέγχθηκε {dt(check.checkedAt)}{check.resolvedByName ? ` · απόφαση από ${check.resolvedByName}` : ""}</p>
          </div>
          {again}
        </div>
        {check.status === "NOT_FOUND" ? <p className="text-sm text-muted-foreground">Ο προμηθευτής δεν το έχει διαβιβάσει ακόμα. {check.recheckUntil ? `Ξαναελέγχεται κάθε βράδυ ως τις ${dt(check.recheckUntil).split(",")[0]}· θα ειδοποιηθείς μόνο αν βρεθεί διαφορά.` : ""}</p> : null}
        {check.status === "ERROR" ? <p className="text-sm text-muted-foreground">Το myDATA δεν απάντησε: {check.error}. Ο έλεγχος θα ξαναγίνει το βράδυ.</p> : null}
        {rows.length && check.status !== "MATCH" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 pr-2 font-medium sm:pr-3">Πεδίο</th><th className="py-1.5 pr-2 sm:pr-3 font-medium">Φωτογραφία</th><th className="py-1.5 pr-2 sm:pr-3 font-medium">myDATA</th><th className="hidden sm:table-cell" /></tr></thead>
              <tbody>
                {rows.filter(([, , v]) => v).map(([field, label, mv]) => {
                  const d = by.get(field);
                  return (
                    <tr key={field} className={d ? "bg-destructive/5" : ""}>
                      <td className="border-t border-border/60 py-1.5 pr-2 sm:pr-3">{label}</td>
                      <td className={`border-t border-border/60 py-1.5 pr-2 sm:pr-3 tabular-nums break-all ${d ? "font-semibold text-destructive" : ""}`}>{d ? d.scanned : mv}</td>
                      <td className={`border-t border-border/60 py-1.5 pr-2 sm:pr-3 tabular-nums break-all ${d ? "font-semibold text-success-ink" : ""}`}>{mv}</td>
                      <td className="hidden border-t border-border/60 py-1.5 text-right sm:table-cell">{d ? <span className="text-xs font-semibold text-destructive">διαφέρει</span> : <span className="text-xs text-success-ink">ίδιο</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {check.status === "MATCH" ? <p className="text-sm text-muted-foreground">ΑΦΜ, αριθμός, ημερομηνία{receipt ? "" : ", ποσά"} και ΜΑΡΚ συμφωνούν με αυτό που δήλωσε ο προμηθευτής στην ΑΑΔΕ.</p> : null}
        {check.status === "DIFF" && !check.resolution ? (
          <>
            <p className="text-sm text-muted-foreground">{money ? "Τα ποσά του χαρτιού δεν είναι ίδια με όσα δήλωσε ο προμηθευτής. Αν το χαρτί είναι σωστό, ζήτα από τον προμηθευτή διόρθωση στο myDATA πριν το πληρώσεις." : "Πιθανότατα διαβάστηκε λάθος η φωτογραφία. Κοίτα το χαρτί και διάλεξε ποια στοιχεία ισχύουν."} Μέχρι να αποφασίσεις, το τιμολόγιο δεν πληρώνεται.</p>
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <form action={aade}><Submit pendingText="Αλλαγή…" className={btn("default", "sm")}>Κράτα τα στοιχεία της ΑΑΔΕ</Submit></form>
                <form action={paper}><Submit pendingText="Αποθήκευση…" className={btn("outline", "sm")}>Το χαρτί είναι σωστό · σημείωσε διαφορά</Submit></form>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}
