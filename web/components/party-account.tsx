import { ArrowDownLeft, ArrowUpRight, FileClock, Info, ReceiptText, ShoppingCart, WalletCards } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { DetailGrid, Card, cn } from "@/components/ui";
import { FiscalBadge, dateTime } from "@/lib/labels";
import { euro } from "@/lib/money";
import type { PartyAccountDocument, PartyAccountPayment, PartyAccountSummary } from "@/lib/party-account";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

export type AccountView = "ledger" | "documents" | "payments" | "orders";
export const ACCOUNT_VIEWS: Record<AccountView, string> = { ledger: "Καρτέλα", documents: "Παραστατικά", payments: "Πληρωμές", orders: "Παραγγελίες" };

const accountHref = (base: string, view: AccountView = "ledger") => `${base}?tab=account${view === "ledger" ? "" : `&view=${view}`}`;

export function PartyAccountSummary({ summary, base }: { summary: PartyAccountSummary; base: string }) {
  const items = [
    { label: "Υπόλοιπο πελάτη", value: summary.balanceCents, hint: summary.balanceCents > 0 ? "Οφειλή προς είσπραξη" : summary.balanceCents < 0 ? "Πιστωτικό υπέρ του πελάτη" : "Δεν υπάρχει ανοιχτή οφειλή", view: "ledger" as const },
    { label: "Χρεώσεις", value: summary.chargesCents, hint: "Παραστατικά που στάλθηκαν", view: "documents" as const },
    { label: "Πιστώσεις", value: summary.creditsCents, hint: "Πιστωτικά που στάλθηκαν", view: "documents" as const },
    { label: "Εισπράξεις", value: summary.paymentsCents, hint: "Επιτυχείς πληρωμές πωλήσεων", view: "payments" as const },
  ];
  return (
    <section aria-label="Οικονομική εικόνα πελάτη" className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, index) => (
          <Link key={item.label} href={accountHref(base, item.view)} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <Card className="h-full px-4 py-3 transition-colors group-hover:border-primary/40">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{index === 0 ? <WalletCards className="size-3.5" /> : index === 3 ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}{item.label}</p>
              <p className={cn("mt-1.5 text-lg font-semibold tabular-nums", item.label === "Υπόλοιπο πελάτη" && item.value < 0 && "text-success-ink")}>{euro(item.value)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Το υπόλοιπο υπολογίζεται από παραστατικά που έχουν σταλεί στην ΑΑΔΕ και επιτυχείς πληρωμές συνδεδεμένων πωλήσεων.</p>
    </section>
  );
}

export function PartyAccount({ base, view, summary, documents, payments, partyId }: {
  base: string;
  view: AccountView;
  summary: PartyAccountSummary;
  documents: PartyAccountDocument[];
  payments: PartyAccountPayment[];
  partyId: string;
}) {
  const effective = [
    ...documents.filter((doc) => doc.status === "SIGNED" && doc.sign !== null && doc.totalCents !== null).map((doc) => ({
      id: `document-${doc.id}`, at: doc.at, label: doc.title, number: doc.number, href: doc.href,
      charge: doc.sign === 1 ? doc.totalCents! : 0, credit: doc.sign === -1 ? doc.totalCents! : 0, payment: 0,
      delta: (doc.sign ?? 0) * doc.totalCents!,
    })),
    ...payments.filter((payment) => payment.success).map((payment) => ({
      id: `payment-${payment.id}`, at: payment.at, label: `Είσπραξη · ${payment.method}`, number: payment.saleNumber, href: `/receipts/${payment.saleId}`,
      charge: 0, credit: 0, payment: payment.amountCents, delta: -payment.amountCents,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const balances = effective.reduce<number[]>((all, entry) => [...all, (all[all.length - 1] ?? 0) + entry.delta], []);
  const ledger = effective.map((entry, index) => ({ ...entry, balance: balances[index] })).reverse();

  return (
    <div className="space-y-4">
      <PartyAccountSummary summary={summary} base={base} />
      <nav aria-label="Οικονομικές ενότητες" className="flex gap-1 overflow-x-auto border-b border-border/70 pb-2">
        {(Object.keys(ACCOUNT_VIEWS) as AccountView[]).map((key) => (
          <Link key={key} href={accountHref(base, key)} aria-current={view === key ? "page" : undefined} className={cn("inline-flex min-h-8 shrink-0 items-center rounded-lg px-3 text-sm font-medium", view === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60")}>
            {ACCOUNT_VIEWS[key]}{key === "documents" ? <span className="ml-1.5 text-xs tabular-nums opacity-70">{documents.length}</span> : key === "payments" ? <span className="ml-1.5 text-xs tabular-nums opacity-70">{payments.length}</span> : null}
          </Link>
        ))}
      </nav>

      {view === "ledger" ? (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
            <div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-base font-semibold"><WalletCards className="size-4 text-muted-foreground" /> Αναλυτική καρτέλα</h2><p className="mt-1 text-xs text-muted-foreground">Χρονολογική κίνηση και τρέχον υπόλοιπο. Τα δοκιμαστικά ή αποτυχημένα δεν επηρεάζουν το άθροισμα.</p></div>
          </div>
          <DataTable
            id={`party-ledger-${partyId}`}
            empty="Δεν υπάρχουν παραστατικά που στάλθηκαν ή επιτυχείς πληρωμές για αυτόν τον πελάτη."
            columns={[
              { key: "date", label: "Ημερομηνία" },
              { key: "entry", label: "Κίνηση", required: true, wrap: true },
              { key: "number", label: "Αναφορά", wrap: true },
              { key: "charge", label: "Χρέωση", numeric: true },
              { key: "credit", label: "Πίστωση", numeric: true },
              { key: "payment", label: "Είσπραξη", numeric: true },
              { key: "balance", label: "Υπόλοιπο", numeric: true },
            ]}
            rows={ledger.map((entry) => ({
              id: entry.id,
              cells: {
                date: <span className="whitespace-nowrap">{dateTime.format(entry.at)}</span>,
                entry: <span className="font-medium">{entry.label}</span>,
                number: entry.href ? <Link href={entry.href} className="underline-offset-4 hover:underline">{entry.number}</Link> : entry.number,
                charge: entry.charge ? euro(entry.charge) : "—",
                credit: entry.credit ? euro(entry.credit) : "—",
                payment: entry.payment ? euro(entry.payment) : "—",
                balance: <span className="whitespace-nowrap font-semibold">{euro(entry.balance)}</span>,
              },
            }))}
          />
        </Card>
      ) : null}

      {view === "documents" ? (
        <Card className="overflow-hidden">
          <div className="border-b border-border/70 px-4 py-3"><h2 className="flex items-center gap-2 text-base font-semibold"><ReceiptText className="size-4 text-muted-foreground" /> Παραστατικά πελάτη</h2><p className="mt-1 text-xs text-muted-foreground">Πωλήσεις και πιστωτικά, ανεξάρτητα από την κατάσταση διαβίβασης. Το ποσό των πιστωτικών εμφανίζεται ως πίστωση.</p></div>
          <DataTable
            id={`party-fiscal-documents-${partyId}`}
            empty="Δεν έχει συνδεθεί παραστατικό με αυτόν τον πελάτη."
            columns={[
              { key: "number", label: "Παραστατικό", required: true, wrap: true },
              { key: "date", label: "Ημερομηνία" },
              { key: "type", label: "Τύπος", wrap: true },
              { key: "origin", label: "Προέλευση", wrap: true },
              { key: "charge", label: "Χρέωση", numeric: true },
              { key: "credit", label: "Πίστωση", numeric: true },
              { key: "status", label: "ΑΑΔΕ", wrap: true },
            ]}
            rows={documents.map((doc) => ({
              id: doc.id,
              cells: {
                number: doc.href ? <Link href={doc.href} className="font-semibold underline-offset-4 hover:underline">{doc.number}</Link> : <span className="font-semibold">{doc.number}</span>,
                date: <span className="whitespace-nowrap">{dateTime.format(doc.at)}</span>,
                type: <span>{doc.title} <span className="text-xs text-muted-foreground">({doc.type})</span></span>,
                origin: doc.origin,
                charge: doc.sign === 1 && doc.totalCents !== null ? euro(doc.totalCents) : "—",
                credit: doc.sign === -1 && doc.totalCents !== null ? euro(doc.totalCents) : "—",
                status: <FiscalBadge status={doc.status} />,
              },
              details: {
                label: doc.number,
                view: <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Αναφορά Viva</dt><dd className="mt-1 break-all text-sm font-medium">{doc.reference}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Προέλευση</dt><dd className="mt-1 text-sm font-medium">{doc.origin}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Ποσό</dt><dd className="mt-1 text-sm font-semibold">{doc.totalCents === null ? "Δεν αναγνωρίστηκε" : euro(doc.totalCents)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Σφάλμα</dt><dd className="mt-1 break-words text-sm font-medium">{doc.error ?? "—"}</dd></div>
                </DetailGrid>,
              },
            }))}
          />
        </Card>
      ) : null}

      {view === "payments" ? (
        <Card className="overflow-hidden">
          <div className="border-b border-border/70 px-4 py-3"><h2 className="flex items-center gap-2 text-base font-semibold"><ArrowDownLeft className="size-4 text-muted-foreground" /> Πληρωμές</h2><p className="mt-1 text-xs text-muted-foreground">Πραγματικές πληρωμές συνδεδεμένων πωλήσεων. Ανεξάρτητη είσπραξη χωρίς πώληση δεν υποστηρίζεται ακόμη.</p></div>
          <DataTable
            id={`party-payments-${partyId}`}
            empty="Δεν έχει καταχωριστεί πληρωμή πώλησης αυτού του πελάτη."
            columns={[
              { key: "date", label: "Ημερομηνία" },
              { key: "sale", label: "Πώληση", required: true, wrap: true },
              { key: "method", label: "Τρόπος", wrap: true },
              { key: "origin", label: "Κατάστημα", wrap: true },
              { key: "amount", label: "Ποσό", numeric: true },
              { key: "status", label: "Κατάσταση" },
            ]}
            rows={payments.map((payment) => ({
              id: payment.id,
              cells: {
                date: <span className="whitespace-nowrap">{dateTime.format(payment.at)}</span>,
                sale: <Link href={`/receipts/${payment.saleId}`} className="font-semibold underline-offset-4 hover:underline">{payment.saleNumber}</Link>,
                method: payment.method,
                origin: payment.origin,
                amount: <span className="whitespace-nowrap font-semibold">{euro(payment.amountCents)}</span>,
                status: <StatusBadge look={look(payment.success ? "success" : "danger", payment.success ? "Επιτυχής" : "Απέτυχε")} />,
              },
            }))}
          />
        </Card>
      ) : null}

      {view === "orders" ? (
        <Card className="p-5">
          <div className="flex max-w-2xl items-start gap-3"><ShoppingCart className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><div><h2 className="text-base font-semibold">Παραγγελίες πελάτη</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Η διαχείριση παραγγελιών πελατών δεν έχει ενεργοποιηθεί ακόμη. Δεν εμφανίζουμε ανύπαρκτο ιστορικό ούτε το συμπεριλαμβάνουμε στο υπόλοιπο.</p><p className="mt-3 flex items-start gap-2 rounded-lg bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" />Οι παραγγελίες υλών προς προμηθευτές είναι ξεχωριστή λειτουργία και δεν αποτελούν παραγγελίες αυτού του πελάτη.</p></div></div>
        </Card>
      ) : null}

      {view !== "orders" && !documents.length && !payments.length ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><FileClock className="mt-0.5 size-3.5 shrink-0" />Μόλις εκδοθεί παραστατικό με αυτόν τον συναλλασσόμενο, η κίνηση θα εμφανιστεί εδώ αυτόματα.</p>
      ) : null}
    </div>
  );
}
