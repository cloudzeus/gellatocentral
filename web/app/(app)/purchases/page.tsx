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

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("el-GR", { timeZone: "UTC" }).format(d) : "—");

// Τιμολόγια αγοράς: server φίλτρα/ταξινόμηση· η ανάπτυξη δείχνει το ίδιο πλήρες έγγραφο με την καρτέλα.
export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const { org, can } = await currentOrg("purchases.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["supplier", "number", "issuedAt", "warehouse", "lines", "status"]);
  const [suppliers, warehouses, ocr] = await Promise.all([
    db.party.findMany({ where: { orgId: org.id, roles: { has: "supplier" }, active: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" } }),
    db.usagePrice.findUnique({ where: { service: "ocr" }, select: { active: true } }),
  ]);
  const supplier = filterParam(q, "supplier", suppliers.map((s) => s.id));
  const warehouse = filterParam(q, "warehouse", warehouses.map((w) => w.id));
  const status = filterParam(q, "status", ["DRAFT", "POSTED", "CANCELLED"]);
  const where = {
    orgId: org.id,
    kind: "INVOICE",
    ...(supplier ? { supplierId: supplier } : {}),
    ...(warehouse ? { warehouseId: warehouse } : {}),
    ...(status ? { status } : {}),
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
    db.purchaseDoc.findMany({ where, orderBy, skip: list.skip, take: list.take, include: { supplier: true, warehouse: true, lines: { orderBy: { id: "asc" } }, _count: { select: { lines: true } } } }),
    db.purchaseDoc.count({ where }),
  ]);
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
      <p className="text-xs text-muted-foreground">Φέρνει τα τιμολόγια αγοράς που έχουν εκδόσει οι προμηθευτές σου (RequestMyIncome). Όσα έχουν ήδη ληφθεί παραλείπονται. Γίνονται πρόχειρα για έλεγχο πριν την καταχώριση.</p>
      <FormPending label="Λήψη παραστατικών από myDATA…" />
      <Submit pendingText="Λήψη…" className={btn("default")}>Λήψη</Submit>
    </form>
  );

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
        {!suppliers.length || !warehouses.length ? <p className="rounded-lg bg-gold/15 px-4 py-3 text-sm text-gold-ink">Χρειάζεσαι πρώτα <Link href="/parties" className="underline">προμηθευτή</Link> και <Link href="/inventory" className="underline">αποθήκη</Link>.</p> : null}
        <Card>
          <DataTable
            id="purchases"
            listing={{ ...list, total, placeholder: "Προμηθευτής ή αριθμός τιμολογίου…", filters: [
              { key: "supplier", label: "Προμηθευτής", value: supplier, options: suppliers.map((s): [string, string] => [s.id, s.name]) },
              { key: "warehouse", label: "Αποθήκη", value: warehouse, options: warehouses.map((w): [string, string] => [w.id, w.name]) },
              { key: "status", label: "Κατάσταση", value: status, options: statusOptions("purchase") },
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
                  number: d.number ?? "—", issuedAt: day(d.issuedAt), warehouse: d.warehouse.name, lines: d._count.lines,
                  total: <span className="whitespace-nowrap font-semibold">{euro(totals.totalCents)}</span>, status: <StatusBadge kind="purchase" value={d.status} />,
                },
                details: {
                  label: `${d.supplier.name}${d.number ? ` · ${d.number}` : ""}`,
                  view: <div className="grid gap-3"><div className="flex justify-end"><Link href={`/purchases/${d.id}`} className={btn("outline", "sm")}><Eye /> Άνοιγμα & επεξεργασία</Link></div><PurchaseDocument doc={view} compact /></div>,
                },
              };
            })}
          />
        </Card>
      </div>
    </Page>
  );
}
