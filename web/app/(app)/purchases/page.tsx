import Link from "next/link";
import { Download, Eye, Plus, ScanLine } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { PurchaseDocument } from "@/components/purchase-document";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { calculatePurchaseDocument, documentParty, partySnapshot } from "@/lib/purchase-document";
import { createDoc, importDocs, scanDoc } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { statusOptions } from "@/lib/status";
import type { MydataDiff } from "@/lib/mydata-parse";
import { MissingView } from "./missing";

// Επιστροφές και πιστωτικά προμηθευτή μένουν στην ίδια λίστα: μειώνουν ό,τι χρωστάμε (lib/purchase-returns.ts)
const KIND_LABEL: Record<string, string> = { INVOICE: "Τιμολόγιο", RETURN: "Επιστροφή", CREDIT: "Πιστωτικό" };
// φίλτρο «myDATA»: PAPER = διαφορά όπου κρατήθηκε το χαρτί, DIFF = διαφορά χωρίς απόφαση
const MYDATA_WHERE: Record<string, { status: string; resolution?: null | { not: null } }> = {
  MATCH: { status: "MATCH" }, DIFF: { status: "DIFF", resolution: null }, PAPER: { status: "DIFF", resolution: { not: null } }, NOT_FOUND: { status: "NOT_FOUND" }, ERROR: { status: "ERROR" },
};
const checkValue = (c: { status: string; resolution: string | null }) => (c.status === "DIFF" && c.resolution ? "PAPER" : c.status);

function MydataCell({ check }: { check: { status: string; resolution: string | null; diff: unknown } }) {
  const diff = Array.isArray(check.diff) ? (check.diff as MydataDiff[]) : [];
  return <span className="grid justify-items-start gap-1"><StatusBadge kind="mydataCheck" value={checkValue(check)} />{diff.length ? <span className="text-xs text-muted-foreground">{diff.map((d) => d.label).join(", ")}</span> : null}</span>;
}

/** Μία οριζόντια μπάρα: ίδια / διαφορές / δεν βρέθηκαν, με σύνδεσμο στο φίλτρο κάθε κομματιού. */
function MydataMonth({ checks }: { checks: { status: string; resolution: string | null }[] }) {
  const n = (v: string) => checks.filter((c) => checkValue(c) === v).length;
  const parts = [
    { v: "MATCH", label: "Ίδια", count: n("MATCH"), color: "var(--success)", hint: "" },
    { v: "DIFF", label: "Διαφορές", count: n("DIFF"), color: "var(--destructive)", hint: "κοίτα τα πρώτα" },
    { v: "PAPER", label: "Κρατήθηκε το χαρτί", count: n("PAPER"), color: "var(--warning)", hint: "" },
    { v: "NOT_FOUND", label: "Δεν βρέθηκαν ακόμα", count: n("NOT_FOUND") + n("ERROR"), color: "var(--muted-foreground)", hint: "ξαναελέγχονται κάθε βράδυ" },
  ].filter((p) => p.count);
  const total = checks.length, match = n("MATCH");
  const month = new Intl.DateTimeFormat("el-GR", { month: "long", timeZone: "Europe/Athens" }).format(new Date());
  return (
    <Card>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Έλεγχος με το myDATA · {month}</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{match} από {total} ίδια ({Math.round((match / total) * 100)}%)</span>
        </div>
        <div className="flex h-3.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p) => `${p.label}: ${p.count}`).join(", ")}>
          {parts.map((p) => <span key={p.v} style={{ width: `${(p.count / total) * 100}%`, background: p.color }} />)}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          {parts.map((p) => (
            <Link key={p.v} href={`/purchases?mydata=${p.v === "NOT_FOUND" ? "NOT_FOUND" : p.v}`} className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline">
              <i className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} />{p.label} · <b className="font-semibold text-foreground tabular-nums">{p.count}</b>{p.hint ? ` · ${p.hint}` : ""}
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
}

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("el-GR", { timeZone: "UTC" }).format(d) : "—");

// Τιμολόγια αγοράς: server φίλτρα/ταξινόμηση· η ανάπτυξη δείχνει το ίδιο πλήρες έγγραφο με την καρτέλα.
export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const { org, can } = await currentOrg("purchases.read");
  const q = await searchParams;
  const missingView = q.view === "missing" && !!org.aadeUserId;
  const list = listParams(q, 50, ["supplier", "number", "issuedAt", "warehouse", "lines", "status"]);
  const [suppliers, warehouses, ocr] = await Promise.all([
    db.party.findMany({ where: { orgId: org.id, roles: { has: "supplier" }, active: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" } }),
    db.usagePrice.findUnique({ where: { service: "ocr" }, select: { active: true } }),
  ]);
  const supplier = filterParam(q, "supplier", suppliers.map((s) => s.id));
  const warehouse = filterParam(q, "warehouse", warehouses.map((w) => w.id));
  const status = filterParam(q, "status", ["DRAFT", "POSTED", "CANCELLED"]);
  const kind = filterParam(q, "kind", Object.keys(KIND_LABEL));
  const mydata = filterParam(q, "mydata", Object.keys(MYDATA_WHERE));
  const where = {
    orgId: org.id,
    kind: kind ?? { in: Object.keys(KIND_LABEL) },
    ...(supplier ? { supplierId: supplier } : {}),
    ...(warehouse ? { warehouseId: warehouse } : {}),
    ...(status ? { status } : {}),
    ...(mydata ? { mydataCheck: MYDATA_WHERE[mydata] } : {}),
    ...(list.q ? { OR: [{ number: { contains: list.q, mode: "insensitive" as const } }, { supplier: { name: { contains: list.q, mode: "insensitive" as const } } }] } : {}),
  };
  const orderBy = list.sort === "supplier" ? { supplier: { name: list.dir } }
    : list.sort === "number" ? { number: list.dir }
      : list.sort === "issuedAt" ? { issuedAt: list.dir }
        : list.sort === "warehouse" ? { warehouse: { name: list.dir } }
          : list.sort === "lines" ? { lines: { _count: list.dir } }
            : list.sort === "status" ? { status: list.dir }
              : { createdAt: "desc" as const };
  const [docs, total] = await Promise.all([
    db.purchaseDoc.findMany({ where, orderBy, skip: list.skip, take: list.take, include: { supplier: true, warehouse: true, lines: { orderBy: { id: "asc" } }, mydataCheck: { select: { status: true, resolution: true, diff: true } }, _count: { select: { lines: true } } } }),
    db.purchaseDoc.count({ where }),
  ]);
  // γράφημα του μήνα: πόσα σκαναρισμένα συμφωνούν με το myDATA (mockup mydata-check.html, Β)
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const monthChecks = org.aadeUserId ? await db.mydataCheck.findMany({ where: { orgId: org.id, purchaseDoc: { kind: { in: Object.keys(KIND_LABEL) }, createdAt: { gte: monthStart } } }, select: { status: true, resolution: true } }) : [];
  const files = docs.length ? await db.storedFile.findMany({ where: { orgId: org.id, category: "purchase_document", refType: "purchase", refId: { in: docs.map((d) => d.id) } }, orderBy: { createdAt: "desc" } }) : [];

  const docForm = (
    <form action={createDoc} className="grid gap-4 [&>button]:justify-self-end">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Προμηθευτής" name="supplierId" required options={suppliers.map((p): [string, string] => [p.id, p.name])} />
        <Select label="Αποθήκη παραλαβής" name="warehouseId" required options={warehouses.map((w): [string, string] => [w.id, w.name])} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Αριθμός τιμολογίου" name="number" maxLength={40} hint="Όπως τυπώνεται στο παραστατικό του προμηθευτή" />
        <Field label="Ημερομηνία έκδοσης" name="issuedAt" type="date" />
      </div>
      <Field label="Σημείωση" name="note" maxLength={200} />
      <FormPending label="Δημιουργία τιμολογίου…" />
      <Submit pendingText="Δημιουργία…" className={btn("default")}>Δημιουργία</Submit>
    </form>
  );

  const scanForm = (
    <form action={scanDoc} className="grid gap-4 [&>button]:justify-self-end">
      <Select label="Προμηθευτής" name="supplierId" required options={suppliers.map((p): [string, string] => [p.id, p.name])} />
      <Select label="Αποθήκη παραλαβής" name="warehouseId" required options={warehouses.map((w): [string, string] => [w.id, w.name])} />
      <Field label="Φωτογραφία τιμολογίου" name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required hint="JPG, PNG ή WebP έως 8 MB — η υπηρεσία χρεώνεται ανά έγγραφο" />
      <p className="text-xs text-muted-foreground">Το αρχείο αποθηκεύεται στο πρόχειρο. Τα αποτελέσματα ελέγχονται και διορθώνονται από εσένα πριν από οποιαδήποτε κίνηση αποθέματος.</p>
      <FormPending label="Σάρωση και ανάλυση τιμολογίου…" />
      <Submit pendingText="Σάρωση…" className={btn("default")}>Σάρωση</Submit>
    </form>
  );

  const today = new Date().toISOString().slice(0, 10);
  const quarterStart = new Date(); quarterStart.setUTCMonth(quarterStart.getUTCMonth() - 3);
  const mydataForm = (
    <form action={importDocs} className="grid gap-4 [&>button]:justify-self-end">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Από" name="dateFrom" type="date" required defaultValue={quarterStart.toISOString().slice(0, 10)} />
        <Field label="Έως" name="dateTo" type="date" required defaultValue={today} />
      </div>
      <p className="text-xs text-muted-foreground">Φέρνει τα τιμολόγια αγοράς που έχουν εκδόσει οι προμηθευτές σου . Όσα έχουν ήδη ληφθεί παραλείπονται. Γίνονται πρόχειρα για έλεγχο πριν την καταχώριση.</p>
      <FormPending label="Λήψη παραστατικών από myDATA…" />
      <Submit pendingText="Λήψη…" className={btn("default")}>Λήψη</Submit>
    </form>
  );

  const [diffCount, missingCount] = org.aadeUserId ? await Promise.all([
    db.mydataCheck.count({ where: { orgId: org.id, status: "DIFF", resolution: null } }),
    db.mydataIncoming.count({ where: { orgId: org.id, status: "MISSING" } }),
  ]) : [0, 0];
  const tab = (href: string, label: string, n: number | null, active: boolean, tone = "") => (
    <Link href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ${active ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
      {label}{n != null ? <span className={`tabular-nums ${n && tone ? tone : ""}`}>· {n}</span> : null}
    </Link>
  );
  const tabs = org.aadeUserId ? (
    <nav aria-label="Προβολή" className="flex w-fit flex-wrap gap-1 rounded-xl bg-muted p-1">
      {tab("/purchases", "Όλα", null, !missingView && mydata !== "DIFF")}
      {tab("/purchases?mydata=DIFF", "Διαφορές", diffCount, !missingView && mydata === "DIFF", "text-destructive")}
      {tab("/purchases?view=missing", "Λείπουν", missingCount, missingView, "text-destructive")}
    </nav>
  ) : null;

  return (
    <Page section="Αποθήκη & αγορές" title="Τιμολόγια αγοράς" description="Χρηματοοικονομικά παραστατικά προμηθευτών· το απόθεμα γράφεται μόνο όταν δεν έχει ήδη καταχωρηθεί με παραλαβή"
      actions={can("purchases.add") && suppliers.length && warehouses.length ? (
        <span className="flex flex-wrap gap-2">
          {org.aadeUserId && org.aadeSubKey ? <Modal label={<><Download /> Λήψη από myDATA</>} size="sm" title="Λήψη τιμολογίων από myDATA">{mydataForm}</Modal> : null}
          {ocr?.active ? <Modal label={<><ScanLine /> Σάρωση τιμολογίου</>} size="sm" title="Σάρωση τιμολογίου (OCR)">{scanForm}</Modal> : null}
          <Modal wide label={<><Plus /> Νέο τιμολόγιο</>} size="sm" title="Νέο τιμολόγιο αγοράς">{docForm}</Modal>
        </span>
      ) : null}>
      <div className="grid gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{q.error.slice(0, 300)}</p> : null}
        {!suppliers.length || !warehouses.length ? <p className="rounded-lg bg-warning/15 px-4 py-3 text-sm text-warning-ink">Χρειάζεσαι πρώτα <Link href="/parties" className="underline">προμηθευτή</Link> και <Link href="/inventory" className="underline">αποθήκη</Link>.</p> : null}
        {tabs}
        {missingView ? <MissingView orgId={org.id} canAdd={can("purchases.add")} canEdit={can("purchases.edit")} /> : <>
        {monthChecks.length ? <MydataMonth checks={monthChecks} /> : null}
        <Card>
          <DataTable
            id="purchases"
            listing={{ ...list, total, placeholder: "Προμηθευτής ή αριθμός τιμολογίου…", filters: [
              { key: "supplier", label: "Προμηθευτής", value: supplier, options: suppliers.map((s): [string, string] => [s.id, s.name]) },
              { key: "warehouse", label: "Αποθήκη", value: warehouse, options: warehouses.map((w): [string, string] => [w.id, w.name]) },
              { key: "kind", label: "Είδος", value: kind, options: Object.entries(KIND_LABEL) },
              { key: "status", label: "Κατάσταση", value: status, options: statusOptions("purchase") },
              ...(org.aadeUserId ? [{ key: "mydata", label: "myDATA", value: mydata, options: statusOptions("mydataCheck") }] : []),
            ] }}
            empty="Κανένα τιμολόγιο αγοράς ακόμα"
            columns={[
              { key: "supplier", label: "Προμηθευτής", required: true, sortable: true, wrap: true },
              { key: "number", label: "Αριθμός", sortable: true },
              { key: "issuedAt", label: "Ημερομηνία", sortable: true },
              { key: "warehouse", label: "Αποθήκη", sortable: true },
              { key: "lines", label: "Γραμμές", numeric: true, sortable: true },
              { key: "total", label: "Γενικό σύνολο", numeric: true },
              { key: "status", label: "Κατάσταση", sortable: true },
              ...(org.aadeUserId ? [{ key: "mydata", label: "myDATA", wrap: true }] : []),
            ]}
            rows={docs.map((d) => {
              const totals = calculatePurchaseDocument(d.lines, d);
              const attachments = files.filter((f) => f.refId === d.id).map((f) => ({ id: f.id, name: f.name, url: `/api/files/${f.id}` }));
              const view = {
                number: d.number, issuedAt: day(d.issuedAt), status: d.status, source: d.source, mydataMark: d.mydataMark, warehouse: d.warehouse.name,
                supplier: documentParty(d.supplierSnapshot, partySnapshot(d.supplier)), buyer: documentParty(d.buyerSnapshot, partySnapshot({ name: org.name, vatNumber: org.vatNumber, countryCode: "GR" })),
                paymentMethod: d.paymentMethod, paymentTerms: d.paymentTerms, shippingMethod: d.shippingMethod, shippingAddress: d.shippingAddress,
                shippingCostCents: d.shippingCostCents, otherExpensesCents: d.otherExpensesCents, expensesVatRate: d.expensesVatRate, note: d.note,
                lines: d.lines.map((l) => ({ id: l.id, description: l.description, supplierCode: l.supplierCode, quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountBps: l.discountBps, vatRate: l.vatRate, batchNumber: l.batchNumber, expiresAt: l.expiresAt ? day(l.expiresAt) : null })), attachments,
              };
              return {
                id: d.id,
                cells: {
                  supplier: <Link href={`/purchases/${d.id}`} title={d.supplier.name} className="block min-w-0 break-words font-semibold leading-snug underline-offset-2 hover:underline md:line-clamp-2">{d.supplier.name}</Link>,
                  number: <span>{d.number ?? "—"}{d.kind !== "INVOICE" ? <span className="block text-xs text-muted-foreground">{KIND_LABEL[d.kind]}{d.mydataType ? ` ${d.mydataType}` : ""}</span> : null}</span>, issuedAt: day(d.issuedAt), warehouse: d.warehouse.name, lines: d._count.lines,
                  total: <span className="whitespace-nowrap font-semibold">{d.kind === "INVOICE" ? euro(totals.totalCents) : <span className="text-success-ink">−{euro(totals.totalCents)}</span>}</span>, status: <StatusBadge kind="purchase" value={d.status} />,
                  mydata: d.mydataCheck ? <MydataCell check={d.mydataCheck} /> : <span className="text-xs text-muted-foreground">{d.source === "mydata" ? "Από το myDATA" : "—"}</span>,
                },
                details: {
                  label: `${d.supplier.name}${d.number ? ` · ${d.number}` : ""}`,
                  view: <div className="grid gap-3"><div className="flex justify-end"><Link href={`/purchases/${d.id}`} className={btn("outline", "sm")}><Eye /> Άνοιγμα & επεξεργασία</Link></div><PurchaseDocument doc={view} compact /></div>,
                },
              };
            })}
          />
        </Card>
        </>}
      </div>
    </Page>
  );
}
