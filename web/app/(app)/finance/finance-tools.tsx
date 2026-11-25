"use client";

// Αντιπαραβολή κίνησης τράπεζας, πακέτο λογιστή και πληρωμή μισθοδοσίας· τα στοιχεία μισθοδοσίας φορτώνονται μόνο σε εξουσιοδοτημένους χρήστες.
import { Banknote, FileDown, Landmark } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { StatusBadge } from "@/components/status-badge";
import { btn, Card, Field, Select } from "@/components/ui";
import type { PersistedStatementReview, StatementReviewRow } from "@/lib/finance-reconciliation";
import { statusOf } from "@/lib/status";
import { payrollConfirmationPhrase, type PayrollExecutionReceipt, type PayrollPaymentBatch, type PayrollPaymentBatchListItem } from "@/lib/payroll-payments";
import { useBusy } from "@/lib/use-busy";

type StatementReviewWire = Omit<PersistedStatementReview, "rows" | "createdAt"> & { createdAt: string; rows: (Omit<StatementReviewRow, "bookedAt"> & { bookedAt: string })[] };
type StatementHistoryWire = Omit<StatementReviewWire, "rows">;
type PayrollHistoryWire = Omit<PayrollPaymentBatchListItem, "createdAt"> & { createdAt: string };
type Account = { id: string; name: string; kind: string };
type Store = { id: string; name: string };
type ProviderAvailability = { enabled: boolean; kind: "GENERIC_HTTPS" | null };
const money = (cents: number) => (cents / 100).toLocaleString("el-GR", { style: "currency", currency: "EUR" });

export function FinanceTools({ accounts, stores, from, to, canExport, canPay, initialStatementHistory, initialPayrollHistory, initialProvider }: { accounts: Account[]; stores: Store[]; from: string; to: string; canExport: boolean; canPay: boolean; initialStatementHistory: StatementHistoryWire[]; initialPayrollHistory: PayrollHistoryWire[]; initialProvider: ProviderAvailability }) {
  const [review, setReview] = useState<StatementReviewWire | null>(null);
  const [statementHistory, setStatementHistory] = useState<StatementHistoryWire[]>(initialStatementHistory);
  const [payrollHistory, setPayrollHistory] = useState<PayrollHistoryWire[]>(initialPayrollHistory);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [provider, setProvider] = useState<ProviderAvailability>(initialProvider);
  const [execution, setExecution] = useState<PayrollExecutionReceipt | null>(null);
  const [error, setError] = useState("");
  const [payrollError, setPayrollError] = useState("");
  const [payrollMessage, setPayrollMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [payrollPending, setPayrollPending] = useState(false);
  // γραμμή φόρτωσης + «ρώτα για εργασίες»: η εισαγωγή και η πληρωμή φαίνονται στο παράθυρο «Εργασίες» όσο τρέχουν
  useBusy(pending || payrollPending);
  const storeOptions: [string, string][] = [["", "Όλα τα προσβάσιμα"], ...stores.map((store): [string, string] => [store.id, store.name])];
  const statementAccounts = accounts.filter((account) => ["bank", "card_clearing"].includes(account.kind));
  const payrollAccounts = accounts.filter((account) => account.kind === "bank");
  const selectedBatch = payrollHistory.find((batch) => batch.batchId === selectedBatchId) ?? null;

  const loadStatementHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/finance/reconciliation", { cache: "no-store" });
      const body = await response.json() as StatementHistoryWire[] | { error?: string };
      if (!response.ok) throw new Error(!Array.isArray(body) ? body.error ?? "Το ιστορικό δεν φορτώθηκε" : "Το ιστορικό δεν φορτώθηκε");
      if (Array.isArray(body)) setStatementHistory(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Το ιστορικό δεν φορτώθηκε"); }
  }, []);
  const loadPayrollHistory = useCallback(async () => {
    if (!canExport || !canPay) return;
    try {
      const response = await fetch("/api/finance/payroll-payments?list=1", { cache: "no-store" });
      const body = await response.json() as { batches?: PayrollHistoryWire[]; provider?: ProviderAvailability; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Το ιστορικό μισθοδοσίας δεν φορτώθηκε");
      const batches = body.batches ?? [];
      setPayrollHistory(batches);
      if (body.provider) setProvider(body.provider);
      setSelectedBatchId((current) => current && batches.some((batch) => batch.batchId === current) ? current : "");
    } catch (cause) { setPayrollError(cause instanceof Error ? cause.message : "Το ιστορικό μισθοδοσίας δεν φορτώθηκε"); }
  }, [canExport, canPay]);

  async function submitStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError(""); setReview(null);
    try {
      const response = await fetch("/api/finance/reconciliation", { method: "POST", body: new FormData(event.currentTarget) });
      const body = await response.json() as StatementReviewWire & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ο έλεγχος απέτυχε");
      setReview(body);
      await loadStatementHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ο έλεγχος απέτυχε");
    } finally { setPending(false); }
  }

  async function openReview(reviewId: string) {
    const listed = statementHistory.find((item) => item.reviewId === reviewId);
    if (!listed) { setReview(null); return; }
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/finance/reconciliation?accountId=${encodeURIComponent(listed.accountId)}&reviewId=${encodeURIComponent(reviewId)}`, { cache: "no-store" });
      const body = await response.json() as StatementReviewWire & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ο έλεγχος δεν φορτώθηκε");
      setReview(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ο έλεγχος δεν φορτώθηκε"); }
    finally { setPending(false); }
  }

  async function submitPayrollPreparation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPayrollPending(true); setPayrollError(""); setPayrollMessage(""); setExecution(null);
    try {
      const query = new URLSearchParams({ from: String(form.get("from") ?? ""), to: String(form.get("to") ?? ""), storeId: String(form.get("storeId") ?? ""), format: "json" });
      const response = await fetch(`/api/finance/payroll-payments?${query}`, { cache: "no-store" });
      const body = await response.json() as PayrollPaymentBatch & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Η προετοιμασία απέτυχε");
      setSelectedBatchId(body.batchId); setClientKey(crypto.randomUUID());
      setPayrollMessage(`Η μισθοδοσία ετοιμάστηκε: ${body.totals.ready} εργαζόμενοι, ${money(body.totals.readyAmountCents)}. Δεν έγινε ακόμα καμία πληρωμή.`);
      await loadPayrollHistory();
    } catch (cause) { setPayrollError(cause instanceof Error ? cause.message : "Η προετοιμασία απέτυχε"); }
    finally { setPayrollPending(false); }
  }

  function selectPayrollBatch(batchId: string) {
    setSelectedBatchId(batchId); setClientKey(batchId ? crypto.randomUUID() : ""); setExecution(null); setPayrollError(""); setPayrollMessage("");
  }

  async function submitPayrollExecution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBatch) return;
    const form = new FormData(event.currentTarget);
    setPayrollPending(true); setPayrollError(""); setPayrollMessage("");
    try {
      const response = await fetch("/api/finance/payroll-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        batchId: selectedBatch.batchId,
        accountId: String(form.get("accountId") ?? ""),
        clientKey: String(form.get("clientKey") ?? ""),
        confirmation: String(form.get("confirmation") ?? ""),
        confirmedAmountCents: Math.round(Number(String(form.get("confirmedAmount") ?? "").replace(",", ".")) * 100),
      }) });
      const body = await response.json() as { execution?: PayrollExecutionReceipt; error?: string };
      if (!response.ok || !body.execution) throw new Error(body.error ?? "Η εκτέλεση απέτυχε");
      setExecution(body.execution);
      setPayrollMessage(body.execution.status === "SUCCEEDED" ? "Η τράπεζα επιβεβαίωσε την πληρωμή και καταχωρήθηκε στα οικονομικά." : body.execution.status === "FAILED" ? "Η τράπεζα απέρριψε την εντολή. Δεν καταχωρήθηκε τίποτα, μπορείς να ξαναδοκιμάσεις." : "Δεν ξέρουμε αν πέρασε η πληρωμή. Δεν καταχωρήθηκε τίποτα και δεν ξαναστέλνεται αυτόματα. Έλεγξε την τράπεζα πριν κάνεις οτιδήποτε.");
      if (body.execution.status === "FAILED") setClientKey(crypto.randomUUID());
      await loadPayrollHistory();
    } catch (cause) { setPayrollError(cause instanceof Error ? cause.message : "Η εκτέλεση απέτυχε"); }
    finally { setPayrollPending(false); }
  }

  const head = (Icon: typeof Landmark, title: string, text: string) => <div className="flex items-start gap-3"><Icon className="mt-0.5 size-5 shrink-0 text-gold-ink" aria-hidden /><div><h2 className="text-base font-semibold">{title}</h2><p className="text-muted-foreground">{text}</p></div></div>;
  return <div className="grid gap-4 xl:grid-cols-2">
    <Card className="px-5 py-4 xl:col-span-2">
      {head(Landmark, "Αντιπαραβολή τράπεζας και Viva", "Ανέβασε το αρχείο κίνησης (CSV) και δες ποιες γραμμές ταιριάζουν με τις εισπράξεις. Δεν γράφεται καμία κίνηση· ό,τι δεν ταιριάζει το ελέγχεις εσύ.")}
      <form onSubmit={submitStatement} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Λογαριασμός" name="accountId" required options={statementAccounts.map((account): [string, string] => [account.id, account.name])} />
        <Field label="Από" name="from" type="date" defaultValue={from} required />
        <Field label="Έως" name="to" type="date" defaultValue={to} required />
        <Field label="Αρχείο κίνησης (CSV)" name="file" type="file" accept=".csv,text/csv" required />
        <button className={btn("default", "default", "self-end")} disabled={pending || !statementAccounts.length} type="submit">{pending ? "Έλεγχος…" : "Έλεγχος"}</button>
      </form>
      {statementAccounts.length ? null : <p className="mt-2 text-warning-ink">Πρόσθεσε πρώτα τραπεζικό λογαριασμό με το κουμπί «Λογαριασμός» πάνω δεξιά.</p>}
      {statementHistory.length ? <div className="mt-3 max-w-xl"><Select label="Προηγούμενοι έλεγχοι" value={review?.reviewId ?? ""} onChange={(event) => void openReview(event.target.value)} options={[["", "Διάλεξε έλεγχο"], ...statementHistory.map((item): [string, string] => [item.reviewId, `${item.createdAt.slice(0, 10)} · ${item.summary.total} γραμμές`])]} /></div> : null}
      {error ? <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-destructive">{error}</p> : null}
      {review ? <div className="mt-4">
        <p className="flex flex-wrap gap-1.5"><StatusBadge kind="statementRow" value="MATCHED" /><span className="tabular-nums">{review.summary.MATCHED}</span> <StatusBadge kind="statementRow" value="UNMATCHED" /><span className="tabular-nums">{review.summary.UNMATCHED}</span> <StatusBadge kind="statementRow" value="AMBIGUOUS" /><span className="tabular-nums">{review.summary.AMBIGUOUS}</span> <StatusBadge kind="statementRow" value="CONFLICT" /><span className="tabular-nums">{review.summary.CONFLICT}</span></p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-180"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Γραμμή</th><th className="px-3 py-2 font-medium">Αιτιολογία</th><th className="px-3 py-2 text-right font-medium">Ποσό</th><th className="px-3 py-2 font-medium">Αποτέλεσμα</th></tr></thead><tbody>{review.rows.slice(0, 200).map((row) => <tr key={row.line} className="h-11 border-b border-border/60 last:border-0"><td className="px-3 py-2 tabular-nums">{row.line}<span className="block text-xs text-muted-foreground">{row.bookedAt.slice(0, 10)}</span></td><td className="px-3 py-2">{row.reference ?? row.description ?? "—"}<span className="block text-xs text-muted-foreground">{row.reasons.join(" · ") || (row.suggestedKind ? "Πιθανή εκκαθάριση Viva" : "")}</span></td><td className="px-3 py-2 text-right tabular-nums">{money(row.amountCents)}</td><td className="px-3 py-2"><StatusBadge kind="statementRow" value={row.status} /></td></tr>)}</tbody></table></div>
        {review.rows.length > 200 ? <p className="mt-2 text-xs text-muted-foreground">Φαίνονται οι πρώτες 200 από {review.rows.length} γραμμές.</p> : null}
      </div> : null}
    </Card>
    {canExport ? <Card className="px-5 py-4">
      {head(FileDown, "Πακέτο για τον λογιστή", "Μόνο τα επίσημα: αποδείξεις που στάλθηκαν στην ΑΑΔΕ, τιμολόγια πώλησης και καταχωρημένα τιμολόγια αγοράς. Χωρίς μισθοδοσία.")}
      <form action="/api/finance/accountant-export" method="get" className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Από" name="from" type="date" defaultValue={from} required /><Field label="Έως" name="to" type="date" defaultValue={to} required />
        <Select label="Κατάστημα" name="storeId" options={storeOptions} /><Select label="Μορφή αρχείου" name="format" options={[["csv", "CSV (Excel)"], ["json", "JSON"]]} />
        <button className={btn("outline", "default", "sm:col-span-2")} type="submit"><FileDown aria-hidden />Λήψη πακέτου</button>
      </form>
    </Card> : null}
    {canExport && canPay ? <Card className="px-5 py-4 xl:col-span-2">
      {head(Banknote, "Πληρωμή μισθοδοσίας", "Πρώτα ετοιμάζεις τη μισθοδοσία του μήνα και ελέγχεις το αρχείο. Η πληρωμή γίνεται μόνο αφού επιβεβαιώσεις ποσό και φράση.")}
      <form onSubmit={submitPayrollPreparation} className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Πρώτη ημέρα" name="from" type="date" defaultValue={from} required /><Field label="Τελευταία ημέρα" name="to" type="date" defaultValue={to} required />
        <Select label="Κατάστημα" name="storeId" options={storeOptions} />
        <button className={btn("outline", "default", "sm:col-span-3")} disabled={payrollPending} type="submit">{payrollPending ? "Ετοιμάζεται…" : "Ετοίμασε τη μισθοδοσία (χωρίς πληρωμή)"}</button>
      </form>
      {payrollHistory.length ? <form onSubmit={submitPayrollExecution} className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <Select label="Μισθοδοσία" value={selectedBatchId} onChange={(event) => selectPayrollBatch(event.target.value)} options={[["", "Διάλεξε μισθοδοσία"], ...payrollHistory.map((batch): [string, string] => [batch.batchId, `${batch.filters.from} έως ${batch.filters.to} · ${statusOf("payrollExecution", batch.execution.status).text}`])]} />
        <Select label="Από τον λογαριασμό" name="accountId" required options={payrollAccounts.map((account): [string, string] => [account.id, account.name])} />
        <input type="hidden" name="clientKey" value={clientKey} />
        <Field key={`${selectedBatchId}-amount`} label="Ποσό που πληρώνεται (€)" name="confirmedAmount" inputMode="decimal" defaultValue={selectedBatch ? (selectedBatch.totals.readyAmountCents / 100).toFixed(2) : "0.00"} required />
        <Field label="Φράση επιβεβαίωσης" name="confirmation" autoComplete="off" placeholder={selectedBatch ? payrollConfirmationPhrase(selectedBatch.batchId) : ""} required />
        {selectedBatch ? <p className="text-muted-foreground sm:col-span-2">Γράψε ακριβώς <code className="rounded bg-secondary px-1">{payrollConfirmationPhrase(selectedBatch.batchId)}</code>. Έτσι η ίδια πληρωμή δεν φεύγει ποτέ δύο φορές.</p> : null}
        {provider.enabled ? null : <p className="rounded-lg bg-warning/15 p-3 text-warning-ink sm:col-span-2">Η σύνδεση με την τράπεζα δεν έχει ενεργοποιηθεί. Μπορείς να κατεβάσεις το αρχείο και να πληρώσεις από το e-banking.</p>}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button className={btn("destructive")} disabled={payrollPending || !provider.enabled || !selectedBatch || !payrollAccounts.length || ["PROCESSING", "UNCERTAIN", "SUCCEEDED"].includes(selectedBatch.execution.status)} type="submit">{payrollPending ? "Πληρωμή…" : "Πλήρωσε τώρα"}</button>
          {selectedBatch ? <a className={btn("outline")} href={`/api/finance/payroll-payments?batchId=${encodeURIComponent(selectedBatch.batchId)}&format=csv`}><FileDown aria-hidden />Αρχείο για e-banking</a> : null}
          {selectedBatch ? <StatusBadge kind="payrollExecution" value={selectedBatch.execution.status} /> : null}
        </div>
      </form> : null}
      {payrollError ? <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-destructive">{payrollError}</p> : null}
      {payrollMessage ? <p role="status" className="mt-3">{payrollMessage}</p> : null}
      {execution ? <p className="mt-2 text-xs text-muted-foreground">{statusOf("payrollExecution", execution.status).text}{execution.failureCode ? ` · κωδικός τράπεζας ${execution.failureCode}` : ""}</p> : null}
    </Card> : null}
  </div>;
}
