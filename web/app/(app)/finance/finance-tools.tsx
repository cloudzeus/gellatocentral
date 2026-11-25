"use client";

// Persisted statement/payroll snapshots· τα ευαίσθητα payroll δεδομένα φορτώνονται μόνο στους εξουσιοδοτημένους χρήστες.
import { useCallback, useState, type FormEvent } from "react";
import { StatusBadge } from "@/components/status-badge";
import { btn, Card, Field, Select } from "@/components/ui";
import type { PersistedStatementReview, StatementReviewRow } from "@/lib/finance-reconciliation";
import { statusOf } from "@/lib/status";
import { payrollConfirmationPhrase, type PayrollExecutionReceipt, type PayrollPaymentBatch, type PayrollPaymentBatchListItem } from "@/lib/payroll-payments";

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
      if (!response.ok) throw new Error(body.error ?? "Το payroll ιστορικό δεν φορτώθηκε");
      const batches = body.batches ?? [];
      setPayrollHistory(batches);
      if (body.provider) setProvider(body.provider);
      setSelectedBatchId((current) => current && batches.some((batch) => batch.batchId === current) ? current : "");
    } catch (cause) { setPayrollError(cause instanceof Error ? cause.message : "Το payroll ιστορικό δεν φορτώθηκε"); }
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
      if (!response.ok) throw new Error(body.error ?? "Το review δεν φορτώθηκε");
      setReview(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Το review δεν φορτώθηκε"); }
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
      setPayrollMessage(`Persisted batch ${body.batchId.slice(0, 12)} · ${body.totals.ready} έτοιμοι · ${money(body.totals.readyAmountCents)} · καμία ledger κίνηση.`);
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
      setPayrollMessage(body.execution.status === "SUCCEEDED" ? "Ο provider επιβεβαίωσε την πληρωμή και καταχωρήθηκε μία ledger κίνηση." : body.execution.status === "FAILED" ? "Ο provider απέρριψε οριστικά την εντολή· δεν γράφτηκε ledger." : "Η έκβαση είναι ασαφής· δεν γράφτηκε ledger και δεν επιτρέπεται αυτόματο retry.");
      if (body.execution.status === "FAILED") setClientKey(crypto.randomUUID());
      await loadPayrollHistory();
    } catch (cause) { setPayrollError(cause instanceof Error ? cause.message : "Η εκτέλεση απέτυχε"); }
    finally { setPayrollPending(false); }
  }

  return <div className="grid gap-4 xl:grid-cols-2">
    <Card className="p-4 xl:col-span-2">
      <h2 className="font-semibold">Persisted bank / Viva reconciliation</h2>
      <p className="mt-1 text-xs text-muted-foreground">Το CSV αποθηκεύεται ως scoped review με γραμμές και matches. Δεν δημιουργείται χρηματοοικονομική κίνηση· conflicts και αμφιβολίες μένουν για χειροκίνητο έλεγχο.</p>
      <form onSubmit={submitStatement} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Λογαριασμός" name="accountId" required options={statementAccounts.map((account): [string, string] => [account.id, account.name])} />
        <Field label="Από" name="from" type="date" defaultValue={from} required />
        <Field label="Έως" name="to" type="date" defaultValue={to} required />
        <Field label="CSV statement" name="file" type="file" accept=".csv,text/csv" required />
        <button className={btn("default", "default", "self-end")} disabled={pending || !statementAccounts.length} type="submit">{pending ? "Αποθήκευση…" : "Αποθήκευση & έλεγχος"}</button>
      </form>
      {statementHistory.length ? <div className="mt-3 max-w-xl"><Select label="Αποθηκευμένα reviews" value={review?.reviewId ?? ""} onChange={(event) => void openReview(event.target.value)} options={[["", "Επίλεξε ιστορικό review"], ...statementHistory.map((item): [string, string] => [item.reviewId, `${item.createdAt.slice(0, 10)} · ${item.reviewId.slice(0, 12)} · ${item.summary.total} γραμμές`])]} /></div> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {review ? <div className="mt-4">
        <p className="text-xs text-muted-foreground">PERSISTED review {review.reviewId.slice(0, 12)} · {review.summary.MATCHED} matched · {review.summary.UNMATCHED} unmatched · {review.summary.AMBIGUOUS} ambiguous · {review.summary.CONFLICT} conflicts · νέες ledger κινήσεις: {review.movementsCreated}</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-180 text-sm"><tbody>{review.rows.slice(0, 200).map((row) => <tr key={row.line} className="border-b border-border/60 last:border-0"><td className="p-2">{row.line}<span className="block text-xs text-muted-foreground">{row.bookedAt.slice(0, 10)}</span></td><td className="p-2">{row.reference ?? row.description ?? "—"}<span className="block text-xs text-muted-foreground">{row.reasons.join(" · ") || (row.suggestedKind ? "Πιθανός διακανονισμός Viva" : "")}</span></td><td className="p-2 text-right">{money(row.amountCents)}</td><td className="p-2"><StatusBadge kind="statementRow" value={row.status} /></td></tr>)}</tbody></table></div>
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
    {canExport && canPay ? <Card className="p-4 xl:col-span-2">
      <h2 className="font-semibold">Payroll payment preparation & execution</h2>
      <p className="mt-1 text-xs text-muted-foreground">Persisted πλήρους μήνα snapshot με pay privacy. Ο provider είναι DISABLED από προεπιλογή· το GENERIC_HTTPS είναι αυστηρό configurable συμβόλαιο, όχι named τραπεζική ολοκλήρωση.</p>
      <form onSubmit={submitPayrollPreparation} className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Πρώτη ημέρα" name="from" type="date" defaultValue={from} required /><Field label="Τελευταία ημέρα" name="to" type="date" defaultValue={to} required />
        <Select label="Κατάστημα" name="storeId" options={storeOptions} />
        <button className={btn("outline", "default", "sm:col-span-3")} disabled={payrollPending} type="submit">Αποθήκευση προετοιμασίας · χωρίς πληρωμή</button>
      </form>
      {payrollHistory.length ? <form onSubmit={submitPayrollExecution} className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <Select label="Persisted batch" value={selectedBatchId} onChange={(event) => selectPayrollBatch(event.target.value)} options={[["", "Επίλεξε batch"], ...payrollHistory.map((batch): [string, string] => [batch.batchId, `${batch.filters.from} · ${batch.batchId.slice(0, 12)} · ${statusOf("payrollExecution", batch.execution.status).text}`])]} />
        <Select label="Τραπεζικός λογαριασμός" name="accountId" required options={payrollAccounts.map((account): [string, string] => [account.id, account.name])} />
        <input type="hidden" name="clientKey" value={clientKey} />
        <Field key={`${selectedBatchId}-amount`} label="Επιβεβαίωση ποσού €" name="confirmedAmount" inputMode="decimal" defaultValue={selectedBatch ? (selectedBatch.totals.readyAmountCents / 100).toFixed(2) : "0.00"} required />
        <Field label="Ρητή επιβεβαίωση" name="confirmation" autoComplete="off" placeholder={selectedBatch ? payrollConfirmationPhrase(selectedBatch.batchId) : "PAYROLL:…"} required />
        {selectedBatch ? <p className="text-xs text-muted-foreground sm:col-span-2">Πληκτρολόγησε ακριβώς <code>{payrollConfirmationPhrase(selectedBatch.batchId)}</code>. Το idempotency key δεσμεύει batch, λογαριασμό, ποσό και provider.</p> : null}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button className={btn("destructive")} disabled={payrollPending || !provider.enabled || !selectedBatch || !payrollAccounts.length || ["PROCESSING", "UNCERTAIN", "SUCCEEDED"].includes(selectedBatch.execution.status)} type="submit">{provider.enabled ? "Εκτέλεση με επιβεβαίωση" : "Provider DISABLED"}</button>
          {selectedBatch ? <a className={btn("outline")} href={`/api/finance/payroll-payments?batchId=${encodeURIComponent(selectedBatch.batchId)}&format=csv`}>Λήψη persisted CSV</a> : null}
          {selectedBatch ? <StatusBadge kind="payrollExecution" value={selectedBatch.execution.status} /> : null}
        </div>
      </form> : null}
      {payrollError ? <p role="alert" className="mt-3 text-sm text-destructive">{payrollError}</p> : null}
      {payrollMessage ? <p role="status" className="mt-3 text-sm text-muted-foreground">{payrollMessage}</p> : null}
      {execution ? <p className="mt-2 text-xs text-muted-foreground">Execution {execution.executionId.slice(0, 12)} · {statusOf("payrollExecution", execution.status).text} · ledger εγγραφές: {execution.financeTransactionsCreated}{execution.failureCode ? ` · ${execution.failureCode}` : ""}</p> : null}
    </Card> : null}
  </div>;
}
