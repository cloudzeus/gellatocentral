import type { ReactNode } from "react";
import { ArrowRightLeft, Banknote, Landmark, LockKeyhole, ReceiptText, Target, WalletCards } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { purchaseTotals } from "@/lib/finance";
import { listAccountStatementReviews } from "@/lib/finance-reconciliation-db";
import { partyIdsByName } from "@/lib/list-search";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { listPayrollPaymentBatches } from "@/lib/payroll-payments-db";
import { payrollProviderAvailability } from "@/lib/payroll-payment-providers";
import { paymentStatus, statusOptions, statusValues } from "@/lib/status";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { closeCash, newAccount, newExpense, newSupplierPayment, newTransfer, reopenCash, saveBudget } from "./actions";
import { FinanceTools } from "./finance-tools";

const money = (value: number | null | undefined) => euro(value ?? 0);
const day = (value: Date) => new Intl.DateTimeFormat("el-GR").format(value);
const dateTime = (value: Date) => new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(value);
const KIND: Record<string, string> = { bank: "Τράπεζα", cash: "Μετρητά", card_clearing: "Διακανονισμός κάρτας", platform: "Πλατφόρμα", other: "Λοιπός" };
// Το είδος της κίνησης και η βάρδια σε απλά ελληνικά: στην οθόνη δεν βγαίνει ποτέ η τιμή της βάσης.
const MOVE: Record<string, string> = { transfer_in: "Μεταφορά από άλλο λογαριασμό", transfer_out: "Μεταφορά σε άλλο λογαριασμό", transfer: "Μεταφορά", expense: "Έξοδο", income: "Έσοδο", supplier_payment: "Πληρωμή προμηθευτή", customer_payment: "Είσπραξη από πελάτη", payroll_payment: "Μισθοδοσία", bank_receipt: "Είσπραξη στην τράπεζα" };
const SHIFT: Record<string, string> = { DAY: "Ημερήσια", MORNING: "Πρωινή", EVENING: "Βραδινή" };
const insensitive = "insensitive" as const;

// Έξι πίνακες στην ίδια σελίδα: ο καθένας έχει δικά του URL keys (πρόθεμα) και κουβαλά στο `params` την κατάσταση
// των άλλων, ώστε η αλλαγή σελίδας ή αναζήτησης στον έναν να μη μηδενίζει τους υπόλοιπους.
const TABLES = ["inv", "pay", "cls", "bud", "exp", "trx"] as const;
const LIST_KEYS = ["q", "page", "sort", "dir", "status"] as const;
function tableList<S extends string>(sp: Record<string, string | string[] | undefined>, prefix: (typeof TABLES)[number], sortable: readonly S[]) {
  const list = listParams({ q: sp[`${prefix}q`], page: sp[`${prefix}page`], sort: sp[`${prefix}sort`], dir: sp[`${prefix}dir`] }, 25, sortable);
  const params: Record<string, string> = {};
  for (const other of TABLES) if (other !== prefix) for (const key of LIST_KEYS) { const value = sp[other + key]; if (typeof value === "string" && value) params[other + key] = value; }
  return { ...list, params, keys: { q: `${prefix}q`, sort: `${prefix}sort`, dir: `${prefix}dir`, page: `${prefix}page` } };
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => <section className="grid min-w-0 gap-2"><h2 className="font-semibold">{title}</h2><Card>{children}</Card></section>;
const emptyWith = (text: string, action: ReactNode) => <><p>{text}</p>{action ? <div className="mt-3 flex justify-center">{action}</div> : null}</>;

export default async function FinancePage({ searchParams }: PageProps<"/finance">) {
  const ctx = await requireStockContext("finance.read");
  const query = await searchParams;
  const canEdit = ctx.can("finance.edit");
  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;
  const storeFilter = ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : ctx.warehouseIds.length ? { id: { in: [] as string[] } } : {};
  const inv = tableList(query, "inv", ["number", "date"]);
  const pay = tableList(query, "pay", ["date", "amount"]);
  const cls = tableList(query, "cls", ["date", "expected", "actual"]);
  const bud = tableList(query, "bud", ["period"]);
  const exp = tableList(query, "exp", ["date", "total"]);
  const trx = tableList(query, "trx", ["date", "amount"]);
  const closingStatus = filterParam(query, "clsstatus", statusValues("cashClosing"));
  const [accounts, stores, warehouses, suppliers, paySuppliers, expSuppliers] = await Promise.all([
    db.financeAccount.findMany({ where: { orgId: ctx.orgId, ...storeFilter }, orderBy: { name: "asc" } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : ctx.warehouseIds.length ? { id: { in: [] } } : {}) }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true } }),
    db.party.findMany({ where: { orgId: ctx.orgId, active: true, roles: { has: "supplier" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    partyIdsByName(ctx.orgId, pay.q),
    partyIdsByName(ctx.orgId, exp.q),
  ]);
  const canPayroll = ctx.can("finance.export") && ctx.can("staff.pay");
  const [statementHistory, payrollHistory] = await Promise.all([
    listAccountStatementReviews(ctx),
    canPayroll ? listPayrollPaymentBatches(ctx) : Promise.resolve([]),
  ]);
  const accountIds = accounts.map((account) => account.id);
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  // Το δικαίωμα ανά κατάστημα/αποθήκη μένει όπως ήταν· η αναζήτηση μπαίνει ΔΙΠΛΑ του (AND), ποτέ στη θέση του.
  const storeScope = ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : restricted ? { id: { in: [] as string[] } } : {};
  const storesNamed = (q: string) => stores.filter((store) => store.name.toLocaleLowerCase("el").includes(q.toLocaleLowerCase("el"))).map((store) => store.id);
  const invoiceScope = { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, kind: "INVOICE", status: "POSTED" as const };
  const invWhere = { ...invoiceScope, ...(inv.q ? { OR: [{ number: { contains: inv.q, mode: insensitive } }, { supplier: { name: { contains: inv.q, mode: insensitive } } }] } : {}) };
  const payWhere = { orgId: ctx.orgId, ...(restricted ? { accountId: { in: accountIds } } : {}), ...(pay.q ? { OR: [{ reference: { contains: pay.q, mode: insensitive } }, { supplierId: { in: paySuppliers } }] } : {}) };
  const clsWhere = { orgId: ctx.orgId, ...storeScope, ...(closingStatus ? { status: closingStatus } : {}), ...(cls.q ? { AND: [{ storeId: { in: storesNamed(cls.q) } }] } : {}) };
  const budWhere = { orgId: ctx.orgId, ...storeScope };
  const expWhere = { orgId: ctx.orgId, ...storeScope, ...(exp.q ? { OR: [{ category: { contains: exp.q, mode: insensitive } }, { documentNumber: { contains: exp.q, mode: insensitive } }, { supplierId: { in: expSuppliers } }] } : {}) };
  const trxWhere = { orgId: ctx.orgId, accountId: { in: accountIds }, ...(trx.q ? { OR: [{ note: { contains: trx.q, mode: insensitive } }, { account: { name: { contains: trx.q, mode: insensitive } } }] } : {}) };
  const latest = "desc" as const;
  const [sums, allocations, payable, purchases, invTotal, payments, payTotal, closings, clsTotal, budgets, budTotal, expenses, expTotal, transactions, trxTotal] = await Promise.all([
    db.financeTransaction.groupBy({ by: ["accountId"], where: { orgId: ctx.orgId, accountId: { in: accountIds } }, _sum: { amountCents: true } }),
    db.supplierPaymentAllocation.groupBy({ by: ["purchaseDocId"], where: { orgId: ctx.orgId }, _sum: { amountCents: true } }),
    // shortcut: η λίστα «Τιμολόγιο αντιστοίχισης» της πληρωμής δείχνει τα 100 πιο πρόσφατα τιμολόγια· για παλαιότερο θέλει αναζήτηση μέσα στη φόρμα
    db.purchaseDoc.findMany({ where: invoiceScope, include: { lines: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.purchaseDoc.findMany({ where: invWhere, include: { lines: true, supplier: { select: { name: true } } }, orderBy: inv.sort === "number" ? [{ number: inv.dir }, { id: latest }] : [{ createdAt: inv.sort === "date" ? inv.dir : latest }, { id: latest }], skip: inv.skip, take: inv.take }),
    db.purchaseDoc.count({ where: invWhere }),
    db.supplierPayment.findMany({ where: payWhere, include: { allocations: true }, orderBy: pay.sort === "amount" ? [{ amountCents: pay.dir }, { id: latest }] : [{ paidAt: pay.sort === "date" ? pay.dir : latest }, { id: latest }], skip: pay.skip, take: pay.take }),
    db.supplierPayment.count({ where: payWhere }),
    db.cashClosing.findMany({ where: clsWhere, orderBy: cls.sort === "expected" ? [{ expectedCashCents: cls.dir }, { id: latest }] : cls.sort === "actual" ? [{ actualCashCents: cls.dir }, { id: latest }] : [{ businessDate: cls.sort === "date" ? cls.dir : latest }, { id: latest }], skip: cls.skip, take: cls.take }),
    db.cashClosing.count({ where: clsWhere }),
    db.budgetTarget.findMany({ where: budWhere, orderBy: [{ year: bud.sort === "period" ? bud.dir : latest }, { month: bud.sort === "period" ? bud.dir : latest }, { id: latest }], skip: bud.skip, take: bud.take }),
    db.budgetTarget.count({ where: budWhere }),
    db.expense.findMany({ where: expWhere, orderBy: exp.sort === "total" ? [{ totalCents: exp.dir }, { id: latest }] : [{ occurredAt: exp.sort === "date" ? exp.dir : latest }, { id: latest }], skip: exp.skip, take: exp.take }),
    db.expense.count({ where: expWhere }),
    db.financeTransaction.findMany({ where: trxWhere, orderBy: trx.sort === "amount" ? [{ amountCents: trx.dir }, { id: latest }] : [{ occurredAt: trx.sort === "date" ? trx.dir : latest }, { id: latest }], skip: trx.skip, take: trx.take }),
    db.financeTransaction.count({ where: trxWhere }),
  ]);
  // και ανενεργοί προμηθευτές: η γραμμή δείχνει το όνομα όποιου πληρώθηκε, όχι μόνο όσων είναι ακόμα ενεργοί
  const rowSuppliers = await db.party.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set([...payments.map((payment) => payment.supplierId), ...expenses.flatMap((expense) => expense.supplierId ?? [])])] } }, select: { id: true, name: true } });
  const balances = new Map(sums.map((row) => [row.accountId, row._sum.amountCents ?? 0]));
  const allocated = new Map(allocations.map((row) => [row.purchaseDocId, row._sum.amountCents ?? 0]));
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const supplierNames = new Map([...suppliers, ...rowSuppliers].map((supplier) => [supplier.id, supplier.name]));
  const accountOptions = accounts.filter((account) => account.active).map((account): [string, string] => [account.id, `${account.name} · ${account.storeId ? storeNames.get(account.storeId) ?? "Κατάστημα" : "Κεντρικός"}`]);
  const storeOptions: [string, string][] = [...(restricted ? [] : [["", "Κεντρικό / όλα"] as [string, string]]), ...stores.map((store): [string, string] => [store.id, store.name])];
  const supplierOptions = suppliers.map((supplier): [string, string] => [supplier.id, supplier.name]);
  const purchaseOptions = payable.map((purchase): [string, string] => {
    const outstanding = purchaseTotals(purchase, purchase.lines).totalCents - (allocated.get(purchase.id) ?? 0);
    return [purchase.id, `${purchase.number ?? purchase.id.slice(-8)} · ${supplierNames.get(purchase.supplierId) ?? "Προμηθευτής"} · ανεξόφλητο ${money(outstanding)}`];
  });
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
  const monthFrom = `${today.slice(0, 8)}01`;
  const monthTo = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const now = new Date();
  const canReopen = ctx.can("finance.reopen");
  const accountModal = canEdit ? <Modal label={<><Landmark /> Λογαριασμός</>} title="Νέος χρηματοοικονομικός λογαριασμός"><form action={newAccount} className="grid gap-3"><Field label="Όνομα" name="name" required maxLength={100} /><Select label="Είδος" name="kind" options={[["bank", "Τράπεζα"], ["cash", "Μετρητά"], ["card_clearing", "Διακανονισμός κάρτας"], ["platform", "Πλατφόρμα"], ["other", "Λοιπός"]]} /><Select label="Κατάστημα" name="storeId" options={storeOptions} /><Field label="Αρχικό υπόλοιπο €" name="openingBalance" inputMode="decimal" defaultValue="0.00" required /><Field label="Ημερομηνία αρχικού" name="openingAt" type="date" defaultValue={today} required /><Submit className={btn("default")}>Δημιουργία</Submit></form></Modal> : null;
  const transferModal = canEdit ? <Modal label={<><ArrowRightLeft /> Μεταφορά</>} title="Εσωτερική μεταφορά"><form action={newTransfer} className="grid gap-3"><Select label="Από" name="sourceAccountId" required options={accountOptions} /><Select label="Προς" name="destinationAccountId" required options={accountOptions} /><Field label="Ποσό €" name="amount" inputMode="decimal" required /><Field label="Ημερομηνία" name="occurredAt" type="datetime-local" required /><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default")}>Καταχώριση μεταφοράς</Submit></form></Modal> : null;
  const expenseModal = canEdit ? <Modal label={<><ReceiptText /> Έξοδο</>} title="Νέο έξοδο"><form action={newExpense} className="grid gap-3 sm:grid-cols-2"><Select label="Κατάστημα" name="storeId" options={storeOptions} /><Select label="Προμηθευτής" name="supplierId" options={[["", "Χωρίς προμηθευτή"], ...supplierOptions]} /><Select label="Λογαριασμός πληρωμής" name="accountId" options={[["", "Χωρίς ταμειακή κίνηση"], ...accountOptions]} /><Field label="Κατηγορία" name="category" required maxLength={80} /><Field label="Παραστατικό" name="documentNumber" maxLength={100} /><Field label="Καθαρή αξία €" name="netAmount" inputMode="decimal" required /><Select label="ΦΠΑ" name="vatRate" options={[["0", "0%"], ["6", "6%"], ["13", "13%"], ["24", "24%"]]} /><Field label="Ημερομηνία" name="occurredAt" type="datetime-local" required /><label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="informal" /> Ανεπίσημο / εκτός παραστατικού</label><div className="sm:col-span-2"><TextareaField label="Σημείωση" name="note" maxLength={500} /></div><Submit className={btn("default", "default", "sm:col-span-2")}>Καταχώριση εξόδου</Submit></form></Modal> : null;
  const paymentModal = canEdit ? <Modal label={<><WalletCards /> Πληρωμή</>} title="Πληρωμή προμηθευτή"><form action={newSupplierPayment} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="clientKey" value={crypto.randomUUID()} /><Select label="Προμηθευτής" name="supplierId" required options={supplierOptions} /><Select label="Λογαριασμός" name="accountId" options={[["", "Χωρίς ταμειακή κίνηση"], ...accountOptions]} /><Field label="Ποσό πληρωμής €" name="amount" inputMode="decimal" required /><Field label="Ημερομηνία" name="paidAt" type="datetime-local" required /><Select label="Τιμολόγιο αντιστοίχισης" name="purchaseDocId" options={[["", "Χωρίς αντιστοίχιση"], ...purchaseOptions]} /><Field label="Ποσό αντιστοίχισης €" name="allocation" inputMode="decimal" defaultValue="0.00" /><Field label="Αναφορά" name="reference" maxLength={100} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="informal" /> Ανεπίσημη πληρωμή</label><div className="sm:col-span-2"><TextareaField label="Σημείωση" name="note" maxLength={500} /></div><Submit className={btn("default", "default", "sm:col-span-2")}>Καταχώριση πληρωμής</Submit></form></Modal> : null;
  const closingModal = canEdit ? <Modal label={<><LockKeyhole /> Κλείσιμο</>} title="Ημερήσιο κλείσιμο ταμείου"><form action={closeCash} className="grid gap-3 sm:grid-cols-2"><Select label="Κατάστημα" name="storeId" required options={stores.map((store): [string, string] => [store.id, store.name])} /><Select label="Ταμειακός λογαριασμός" name="cashAccountId" options={[["", "Χωρίς υπολογισμό εκταμιεύσεων"], ...accounts.filter((account) => account.active && account.kind === "cash").map((account): [string, string] => [account.id, account.name])]} /><Field label="Επιχειρησιακή ημέρα" name="businessDate" type="date" defaultValue={today} required /><Select label="Βάρδια" name="shift" options={[["DAY", "Ημερήσια"], ["MORNING", "Πρωινή"], ["EVENING", "Βραδινή"]]} /><Field label="Αρχικό ταμείο €" name="openingCash" inputMode="decimal" defaultValue="0.00" required /><Field label="Καταμέτρηση €" name="actualCash" inputMode="decimal" required /><Field label="Προμήθεια €" name="commission" inputMode="decimal" defaultValue="0.00" required /><Submit className={btn("default", "default", "sm:col-span-2")}>Κλείσιμο ταμείου</Submit></form></Modal> : null;
  const budgetModal = canEdit ? <Modal label={<><Target /> Στόχος</>} title="Μηνιαίος στόχος"><form action={saveBudget} className="grid gap-3 sm:grid-cols-2"><Select label="Κατάστημα" name="storeId" options={storeOptions} /><Field label="Έτος" name="year" type="number" min={2000} max={2200} defaultValue={now.getFullYear()} required /><Select label="Μήνας" name="month" options={Array.from({ length: 12 }, (_, index): [string, string] => [String(index + 1), String(index + 1).padStart(2, "0")])} defaultValue={String(now.getMonth() + 1)} /><Field label="Πωλήσεις €" name="sales" inputMode="decimal" defaultValue="0.00" required /><Field label="Κόστος πωληθέντων €" name="cogs" inputMode="decimal" defaultValue="0.00" required /><Field label="Προσωπικό €" name="payroll" inputMode="decimal" defaultValue="0.00" required /><Field label="Έξοδα €" name="expenses" inputMode="decimal" defaultValue="0.00" required /><Submit className={btn("default", "default", "sm:col-span-2")}>Αποθήκευση στόχου</Submit></form></Modal> : null;
  return <Page section="Οικονομικά" title="Οικονομικά & ταμείο" description="Λογαριασμοί, έξοδα, πληρωμές, ημερήσια κλεισίματα και στόχοι με πλήρες tenant/store scope" actions={canEdit ? <span className="flex flex-wrap gap-2">{accountModal}{transferModal}{expenseModal}{paymentModal}{closingModal}{budgetModal}</span> : null}>
    <div className="grid gap-5">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
      <FinanceTools accounts={accounts.map((account) => ({ id: account.id, name: account.name, kind: account.kind }))} stores={stores} from={monthFrom} to={monthTo} canExport={ctx.can("finance.export")} canPay={ctx.can("staff.pay")} initialStatementHistory={statementHistory.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))} initialPayrollHistory={payrollHistory.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))} initialProvider={payrollProviderAvailability()} />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{accounts.map((account) => <Card key={account.id} className="p-4"><div className="flex items-start justify-between gap-2"><div><p className="text-sm text-muted-foreground">{KIND[account.kind] ?? account.kind} · {account.storeId ? storeNames.get(account.storeId) : "Κεντρικός"}</p><h2 className="font-semibold">{account.name}</h2></div><Banknote className="size-5 text-muted-foreground" /></div><p className="mt-3 text-2xl font-bold">{money(account.openingBalanceCents + (balances.get(account.id) ?? 0))}</p><p className="text-xs text-muted-foreground">Αρχικό {money(account.openingBalanceCents)} · κινήσεις {money(balances.get(account.id))}</p></Card>)}{!accounts.length ? <Card className="p-6 text-sm text-muted-foreground sm:col-span-2 xl:col-span-4">Δεν υπάρχουν διαθέσιμοι λογαριασμοί στο δικαίωμά σου.</Card> : null}</section>
      <Section title="Τιμολόγια αγοράς και ανεξόφλητα υπόλοιπα">
        <DataTable
          id="finance-purchase-invoices"
          listing={{ ...inv, total: invTotal, placeholder: "Αριθμός τιμολογίου ή προμηθευτής" }}
          empty="Εδώ φαίνονται τα καταχωρημένα τιμολόγια αγοράς και πόσα χρωστάς ακόμα σε καθένα. Δεν υπάρχει κανένα ακόμα."
          columns={[
            { key: "number", label: "Τιμολόγιο", required: true, sortable: true },
            { key: "supplier", label: "Προμηθευτής" },
            { key: "date", label: "Καταχωρήθηκε", sortable: true },
            { key: "total", label: "Σύνολο", numeric: true },
            { key: "outstanding", label: "Ανεξόφλητο", numeric: true },
            { key: "status", label: "Πληρωμή" },
          ]}
          rows={purchases.map((purchase) => {
            const total = purchaseTotals(purchase, purchase.lines).totalCents;
            const outstanding = total - (allocated.get(purchase.id) ?? 0);
            return { id: purchase.id, cells: { number: <strong>{purchase.number ?? "Χωρίς αριθμό"}</strong>, supplier: purchase.supplier.name, date: day(purchase.createdAt), total: money(total), outstanding: money(outstanding), status: <StatusBadge look={paymentStatus({ outstandingCents: outstanding }, now)} /> } };
          })}
        />
      </Section>
      <Section title="Πληρωμές προμηθευτών">
        <DataTable
          id="finance-supplier-payments"
          listing={{ ...pay, total: payTotal, placeholder: "Προμηθευτής ή αναφορά πληρωμής" }}
          empty={emptyWith("Εδώ φαίνονται οι πληρωμές που έχεις κάνει σε προμηθευτές. Δεν υπάρχει καμία ακόμα.", paymentModal)}
          columns={[
            { key: "supplier", label: "Προμηθευτής", required: true },
            { key: "date", label: "Ημερομηνία", sortable: true },
            { key: "reference", label: "Αναφορά" },
            { key: "amount", label: "Ποσό", numeric: true, sortable: true },
            { key: "allocations", label: "Αντιστοιχίσεις", numeric: true },
          ]}
          rows={payments.map((payment) => ({ id: payment.id, cells: { supplier: <strong>{supplierNames.get(payment.supplierId) ?? "Προμηθευτής"}</strong>, date: day(payment.paidAt), reference: payment.reference ?? "Χωρίς αναφορά", amount: money(payment.amountCents), allocations: payment.allocations.length } }))}
        />
      </Section>
      <Section title="Ημερήσια κλεισίματα">
        <DataTable
          id="finance-cash-closings"
          listing={{ ...cls, total: clsTotal, placeholder: "Κατάστημα", filters: [{ key: "clsstatus", label: "Κατάσταση", value: closingStatus, options: statusOptions("cashClosing") }] }}
          empty={emptyWith("Εδώ φαίνεται κάθε κλείσιμο ταμείου: τι έπρεπε να έχει το συρτάρι και τι μετρήθηκε. Δεν υπάρχει κανένα ακόμα.", closingModal)}
          columns={[
            { key: "date", label: "Ημέρα", required: true, sortable: true },
            { key: "store", label: "Κατάστημα" },
            { key: "shift", label: "Βάρδια" },
            { key: "expected", label: "Αναμενόμενο", numeric: true, sortable: true },
            { key: "actual", label: "Καταμέτρηση", numeric: true, sortable: true },
            { key: "difference", label: "Διαφορά", numeric: true },
            { key: "card", label: "Κάρτα", numeric: true },
            { key: "platform", label: "Πλατφόρμα", numeric: true },
            { key: "status", label: "Κατάσταση" },
            { key: "reason", label: "Αιτιολογία", wrap: true },
            ...(canReopen ? [{ key: "reopen", label: "Διόρθωση" }] : []),
          ]}
          rows={closings.map((closing) => ({
            id: closing.id,
            cells: {
              date: <strong>{day(closing.businessDate)}</strong>,
              store: storeNames.get(closing.storeId) ?? "—",
              shift: SHIFT[closing.shift] ?? closing.shift,
              expected: money(closing.expectedCashCents),
              actual: money(closing.actualCashCents),
              difference: money(closing.actualCashCents - closing.expectedCashCents),
              card: money(closing.cardCents),
              platform: money(closing.platformCents),
              status: <StatusBadge kind="cashClosing" value={closing.status} />,
              reason: closing.reopenedReason ?? "—",
              reopen: closing.status === "CLOSED" && canReopen ? <Modal size="sm" label="Επανοίγμα" title="Αιτιολογημένο επανοίγμα"><form action={reopenCash} className="grid gap-3"><input type="hidden" name="closingId" value={closing.id} /><TextareaField label="Αιτιολογία" name="reason" required maxLength={300} /><Submit className={btn("destructive")}>Επανοίγμα</Submit></form></Modal> : "—",
            },
          }))}
        />
      </Section>
      <Section title="Στόχοι">
        <DataTable
          id="finance-budget-targets"
          listing={{ ...bud, total: budTotal, placeholder: "", showSearch: false }}
          empty={emptyWith("Εδώ φαίνονται οι μηνιαίοι στόχοι πωλήσεων και κόστους ανά κατάστημα. Δεν έχει οριστεί κανένας ακόμα.", budgetModal)}
          columns={[
            { key: "period", label: "Μήνας", required: true, sortable: true },
            { key: "store", label: "Κατάστημα" },
            { key: "sales", label: "Πωλήσεις", numeric: true },
            { key: "cogs", label: "Κόστος πωληθέντων", numeric: true },
            { key: "payroll", label: "Προσωπικό", numeric: true },
            { key: "expenses", label: "Έξοδα", numeric: true },
          ]}
          rows={budgets.map((budget) => ({ id: budget.id, cells: { period: <strong>{budget.month.toString().padStart(2, "0")}/{budget.year}</strong>, store: budget.storeId ? storeNames.get(budget.storeId) ?? "—" : "Συνολικά", sales: money(budget.salesCents), cogs: money(budget.cogsCents), payroll: money(budget.payrollCents), expenses: money(budget.expenseCents) } }))}
        />
      </Section>
      <Section title="Έξοδα">
        <DataTable
          id="finance-expenses"
          listing={{ ...exp, total: expTotal, placeholder: "Κατηγορία, παραστατικό ή προμηθευτής" }}
          empty={emptyWith("Εδώ φαίνονται τα έξοδα της επιχείρησης (ενοίκιο, ρεύμα, υπηρεσίες). Δεν έχει καταχωρηθεί κανένα ακόμα.", expenseModal)}
          columns={[
            { key: "category", label: "Κατηγορία", required: true },
            { key: "date", label: "Ημερομηνία", sortable: true },
            { key: "store", label: "Κατάστημα" },
            { key: "supplier", label: "Προμηθευτής" },
            { key: "document", label: "Παραστατικό" },
            { key: "total", label: "Ποσό", numeric: true, sortable: true },
          ]}
          rows={expenses.map((expense) => ({ id: expense.id, cells: { category: expense.category, date: day(expense.occurredAt), store: expense.storeId ? storeNames.get(expense.storeId) ?? "—" : "Κεντρικό", supplier: supplierNames.get(expense.supplierId ?? "") ?? "Χωρίς προμηθευτή", document: expense.documentNumber ?? "—", total: <strong>{money(expense.totalCents)}</strong> } }))}
        />
      </Section>
      <Section title="Κινήσεις λογαριασμών">
        <DataTable
          id="finance-transactions"
          listing={{ ...trx, total: trxTotal, placeholder: "Λογαριασμός ή σημείωση" }}
          empty="Εδώ φαίνεται κάθε ποσό που μπήκε ή βγήκε από τους λογαριασμούς σου. Δεν υπάρχει καμία κίνηση ακόμα."
          columns={[
            { key: "account", label: "Λογαριασμός", required: true },
            { key: "kind", label: "Είδος κίνησης" },
            { key: "date", label: "Ημερομηνία", sortable: true },
            { key: "note", label: "Σημείωση", wrap: true },
            { key: "amount", label: "Ποσό", numeric: true, sortable: true },
          ]}
          rows={transactions.map((transaction) => ({ id: transaction.id, cells: { account: <strong>{accountNames.get(transaction.accountId)}</strong>, kind: MOVE[transaction.kind] ?? "Άλλη κίνηση", date: dateTime(transaction.occurredAt), note: transaction.note ?? "—", amount: `${transaction.amountCents > 0 ? "+" : ""}${money(transaction.amountCents)}` } }))}
        />
      </Section>
    </div>
  </Page>;
}
