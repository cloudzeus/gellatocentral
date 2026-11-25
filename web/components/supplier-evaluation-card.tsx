import { CircleCheck, Clock3, PackageCheck, ReceiptText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { SupplierEvaluation } from "@/lib/supplier-evaluation";
import { euro } from "@/lib/money";
import { Badge, btn, Card } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });
const percent = (bps: number | null) => bps === null ? "—" : `${(bps / 100).toLocaleString("el-GR", { maximumFractionDigits: 1 })}%`;
const MATCH = { PENDING: "Αναμένει τιμολόγιο", MATCHED: "Πλήρης συμφωνία", DISCREPANCY: "Με απόκλιση", REVIEWED: "Ελέγχθηκε" } as const;

/** Αναλυτικά KPI αντί αδιαφανούς βαθμολογίας: ο χρήστης βλέπει ακριβώς ποιες παραλαβές τα παράγουν. */
export function SupplierEvaluationCard({ evaluation, canSeeOrders }: { evaluation: SupplierEvaluation; canSeeOrders: boolean }) {
  const metrics = [
    { label: "POSTED αγορές", value: euro(evaluation.totalCents), hint: `${evaluation.invoiceCount} τιμολόγια · καθαρή ${euro(evaluation.netCents)} · ΦΠΑ ${euro(evaluation.vatCents)}`, icon: ReceiptText },
    { label: "Πραγματικές παραλαβές", value: String(evaluation.receiptCount), hint: "POSTED και μη αναιρεμένες", icon: PackageCheck },
    { label: "Εντός προθεσμίας", value: percent(evaluation.onTimeRateBps), hint: `${evaluation.onTimeReceiptCount} εντός · ${evaluation.lateReceiptCount} εκτός · ${evaluation.scheduledReceiptCount} με προθεσμία`, icon: Clock3 },
    { label: "Παραλαβές με απόκλιση", value: percent(evaluation.discrepancyRateBps), hint: `${evaluation.receiptsWithDiscrepancies} από ${evaluation.receiptCount} παραλαβές`, icon: TriangleAlert },
    { label: "Αποκλίσεις παραλαβής", value: String(evaluation.receiptDiscrepancyCount), hint: "Συμφωνίας ή αύξησης τιμής", icon: TriangleAlert },
    { label: "Αποκλίσεις τιμολογίου", value: String(evaluation.invoiceDiscrepancyCount), hint: "Ποσότητας, τιμής ή ΦΠΑ", icon: CircleCheck },
  ];
  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <h2 className="text-lg font-semibold">Αξιολόγηση προμηθευτή</h2>
        <p className="mt-1 text-sm text-muted-foreground">Μετρήσεις από POSTED τιμολόγια, POSTED/μη αναιρεμένες παραλαβές και καταγεγραμμένες αποκλίσεις, εντός του επιτρεπόμενου tenant και warehouse scope. Δεν χρησιμοποιούνται DRAFT, CANCELLED ή προφορικές εκτιμήσεις.</p>
      </Card>
      <section aria-label="Δείκτες προμηθευτή" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => <Card key={metric.label} className="p-4"><div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><metric.icon className="size-4" aria-hidden />{metric.label}</div><p className="mt-2 text-2xl font-semibold tabular-nums">{metric.value}</p><p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p></Card>)}
      </section>
      <Card className="overflow-x-auto">
        <div className="border-b border-border p-4"><h2 className="font-semibold">Παραλαβές που τροφοδοτούν τα KPI</h2><p className="text-sm text-muted-foreground">Η προθεσμία συγκρίνεται με την ημερολογιακή ημέρα πραγματικής παραλαβής στην Ελλάδα.</p></div>
        {evaluation.rows.length ? <table className="w-full min-w-180 text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Παραλαβή</th><th className="p-3">Παραγγελία</th><th className="p-3">Αποθήκη</th><th className="p-3">Προθεσμία</th><th className="p-3">Ταχύτητα</th><th className="p-3 text-right">Αποκλίσεις</th><th className="p-3">Τριπλή συμφωνία</th></tr></thead><tbody>{evaluation.rows.map((row) => <tr key={row.id} className="border-b border-border/60 last:border-0"><td className="p-3 whitespace-nowrap">{day.format(row.at)}</td><td className="p-3 font-medium">{canSeeOrders ? <Link href={`/orders/${row.orderId}`} className="underline-offset-4 hover:underline">{row.orderNumber}</Link> : row.orderNumber}</td><td className="p-3">{row.warehouseName}</td><td className="p-3 whitespace-nowrap">{row.expectedAt ? day.format(row.expectedAt) : "Δεν ορίστηκε"}</td><td className="p-3"><StatusBadge look={row.delayDays === null ? look("neutral", "Χωρίς προθεσμία") : row.delayDays <= 0 ? look("success", "Εντός") : look("warning", `+${row.delayDays} ημέρες`)} /></td><td className="p-3 text-right"><Badge tone={row.discrepancyCount ? "warning" : "success"}>{row.discrepancyCount}</Badge></td><td className="p-3">{MATCH[row.invoiceMatchStatus as keyof typeof MATCH] ?? row.invoiceMatchStatus}</td></tr>)}</tbody></table> : <p className="p-6 text-center text-sm text-muted-foreground">Δεν υπάρχουν πραγματικές POSTED παραλαβές στο επιτρεπόμενο scope.</p>}
        {canSeeOrders ? <div className="border-t border-border p-4"><Link href="/orders" className={btn("outline", "sm")}>Όλες οι παραγγελίες</Link></div> : null}
      </Card>
    </div>
  );
}
