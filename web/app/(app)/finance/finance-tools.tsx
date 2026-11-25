"use client";

// Τα exports είναι απλά GET downloads· το statement review χρησιμοποιεί fetch και δεν κρατά client persisted feed.
import { useState, type FormEvent } from "react";
import { Badge, btn, Card, Field, Select } from "@/components/ui";
import type { StatementReview, StatementReviewRow, StatementReviewStatus } from "@/lib/finance-reconciliation";

type StatementReviewWire = Omit<StatementReview, "rows"> & { rows: (Omit<StatementReviewRow, "bookedAt"> & { bookedAt: string })[] };
type Account = { id: string; name: string; kind: string };
type Store = { id: string; name: string };
const STATUS: Record<StatementReviewStatus, string> = { MATCHED: "Ταίριαξε", UNMATCHED: "Χωρίς αντιστοίχιση", AMBIGUOUS: "Διφορούμενο", CONFLICT: "Σύγκρουση" };
const tone = (status: StatementReviewStatus) => status === "MATCHED" ? "success" as const : status === "UNMATCHED" ? "neutral" as const : status === "AMBIGUOUS" ? "warning" as const : "danger" as const;

export function FinanceTools({ accounts, stores, from, to, canExport, canPay }: { accounts: Account[]; stores: Store[]; from: string; to: string; canExport: boolean; canPay: boolean }) {
  const [review, setReview] = useState<StatementReviewWire | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const storeOptions: [string, string][] = [["", "Όλα τα προσβάσιμα"], ...stores.map((store): [string, string] => [store.id, store.name])];
  const statementAccounts = accounts.filter((account) => ["bank", "card_clearing"].includes(account.kind));

  async function submitStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError(""); setReview(null);
    try {
      const response = await fetch("/api/finance/reconciliation", { method: "POST", body: new FormData(event.currentTarget) });
      const body = await response.json() as StatementReviewWire & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ο έλεγχος απέτυχε");
      setReview(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ο έλεγχος απέτυχε");
    } finally { setPending(false); }
  }

  return <div className="grid gap-4 xl:grid-cols-2">
    <Card className="p-4 xl:col-span-2">
      <h2 className="font-semibold">Stateless bank / Viva reconciliation</h2>
      <p className="mt-1 text-xs text-muted-foreground">CSV review χωρίς αποθήκευση statement και χωρίς δημιουργία χρηματοοικονομικής κίνησης. Οι διφορούμενες ή συγκρουόμενες γραμμές μένουν για χειροκίνητο έλεγχο.</p>
      <form onSubmit={submitStatement} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Λογαριασμός" name="accountId" required options={statementAccounts.map((account): [string, string] => [account.id, account.name])} />
        <Field label="Από" name="from" type="date" defaultValue={from} required />
        <Field label="Έως" name="to" type="date" defaultValue={to} required />
        <Field label="CSV statement" name="file" type="file" accept=".csv,text/csv" required />
        <button className={btn("default", "default", "self-end")} disabled={pending || !statementAccounts.length} type="submit">{pending ? "Έλεγχος…" : "Έλεγχος χωρίς εγγραφή"}</button>
      </form>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {review ? <div className="mt-4">
        <p className="text-xs text-muted-foreground">Review {review.reviewId.slice(0, 12)} · {review.summary.MATCHED} matched · {review.summary.UNMATCHED} unmatched · {review.summary.AMBIGUOUS} ambiguous · {review.summary.CONFLICT} conflicts · κινήσεις που δημιουργήθηκαν: {review.movementsCreated}</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-180 text-sm"><tbody>{review.rows.slice(0, 200).map((row) => <tr key={row.line} className="border-b border-border/60 last:border-0"><td className="p-2">{row.line}<span className="block text-xs text-muted-foreground">{row.bookedAt.slice(0, 10)}</span></td><td className="p-2">{row.reference ?? row.description ?? "—"}<span className="block text-xs text-muted-foreground">{row.reasons.join(" · ") || (row.suggestedKind ? "Πιθανός διακανονισμός Viva" : "")}</span></td><td className="p-2 text-right">{(row.amountCents / 100).toLocaleString("el-GR", { style: "currency", currency: "EUR" })}</td><td className="p-2"><Badge tone={tone(row.status)}>{STATUS[row.status]}</Badge></td></tr>)}</tbody></table></div>
        {review.rows.length > 200 ? <p className="mt-2 text-xs text-muted-foreground">Εμφανίζονται 200 από {review.rows.length} γραμμές.</p> : null}
      </div> : null}
    </Card>
    {canExport ? <Card className="p-4">
      <h2 className="font-semibold">Accountant export</h2>
      <p className="mt-1 text-xs text-muted-foreground">Μόνο formal POS με SIGNED fiscal, ISSUED πωλήσεις, POSTED τιμολόγια αγοράς και μη informal εγγραφές. Χωρίς payroll.</p>
      <form action="/api/finance/accountant-export" method="get" className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Από" name="from" type="date" defaultValue={from} required /><Field label="Έως" name="to" type="date" defaultValue={to} required />
        <Select label="Κατάστημα" name="storeId" options={storeOptions} /><Select label="Μορφή" name="format" options={[["csv", "CSV"], ["json", "JSON"]]} />
        <button className={btn("outline", "default", "sm:col-span-2")} type="submit">Λήψη accountant πακέτου</button>
      </form>
    </Card> : null}
    {canExport && canPay ? <Card className="p-4">
      <h2 className="font-semibold">Payroll payment preparation</h2>
      <p className="mt-1 text-xs text-muted-foreground">Πλήρης ημερολογιακός μήνας. Δεν είναι τραπεζική εντολή, δεν εκτελεί πληρωμή και δεν γράφει finance transaction.</p>
      <form action="/api/finance/payroll-payments" method="get" className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Πρώτη ημέρα" name="from" type="date" defaultValue={from} required /><Field label="Τελευταία ημέρα" name="to" type="date" defaultValue={to} required />
        <Select label="Κατάστημα" name="storeId" options={storeOptions} /><Select label="Μορφή" name="format" options={[["csv", "CSV"], ["json", "JSON"]]} />
        <button className={btn("outline", "default", "sm:col-span-2")} type="submit">Προετοιμασία · NOT EXECUTED</button>
      </form>
    </Card> : null}
  </div>;
}
