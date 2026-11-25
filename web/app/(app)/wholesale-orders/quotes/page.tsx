import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { DocumentPdfButton } from "@/components/document-output";
import { Modal } from "@/components/modal";
import { OrderLinesEditor } from "@/components/order-lines-editor";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/labels";
import { partyIdsByName } from "@/lib/list-search";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { dueStatus, statusOptions, statusValues } from "@/lib/status";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { createQuote } from "./actions";

export default async function WholesaleQuotesPage({ searchParams }: PageProps<"/wholesale-orders/quotes">) {
  const ctx = await requireStockContext("wholesale.read");
  const query = await searchParams;
  const list = listParams(query, 25, ["number", "date", "validUntil", "total"]);
  const status = filterParam(query, "status", statusValues("wholesaleQuote"));
  const [warehouses, parties, matchingCustomers] = await Promise.all([
    db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, orderBy: { name: "asc" } }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "customer" } }, orderBy: { name: "asc" } }),
    partyIdsByName(ctx.orgId, list.q),
  ]);
  // αναζήτηση: αριθμός προσφοράς ή όνομα πελάτη
  const where = {
    orgId: ctx.orgId, warehouseId: { in: warehouses.map((row) => row.id) },
    ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}),
    ...(status ? { status } : {}),
    ...(list.q ? { OR: [{ number: { contains: list.q, mode: "insensitive" as const } }, { customerId: { in: matchingCustomers } }] } : {}),
  };
  const orderBy = list.sort === "total" ? [{ totalCents: list.dir }, { id: "desc" as const }]
    : list.sort === "number" ? [{ number: list.dir }]
    : list.sort === "validUntil" ? [{ validUntil: list.dir }, { id: "desc" as const }]
    : [{ createdAt: list.sort === "date" ? list.dir : ("desc" as const) }, { id: "desc" as const }];
  const [quotes, total, stores, generics] = await Promise.all([
    db.wholesaleQuote.findMany({ where, include: { _count: { select: { lines: true } }, order: { select: { id: true, number: true } } }, orderBy, skip: list.skip, take: list.take }),
    db.wholesaleQuote.count({ where }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, include: { baseUnit: true, vatRate: true }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  const day = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens" });
  const customers = parties.filter((party) => party.active);
  const customerNames = new Map(parties.map((row) => [row.id, row.name]));
  const warehouseNames = new Map(warehouses.map((row) => [row.id, row.name]));
  const items = generics.map((item) => ({
    id: item.id, name: item.name, scale: stockCostScale(item.baseUnit.dimension),
    unitLabel: item.baseUnit.dimension === "mass" ? "kg" : item.baseUnit.dimension === "volume" ? "l" : "1000 τεμ.",
    defaultVat: item.vatRate?.rate ?? 24,
  }));
  const create = ctx.can("wholesale.add") ? <Modal wide label={<><Plus /> Νέα προσφορά</>} title="Νέα προσφορά χονδρικής"><form action={createQuote} className="grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Select label="Πελάτης" name="customerId" required options={customers.map((row): [string, string] => [row.id, row.name])} /><Select label="Κατάστημα" name="storeId" required options={stores.map((row): [string, string] => [row.id, row.name])} /><Select label="Αποθήκη" name="warehouseId" required options={warehouses.map((row): [string, string] => [row.id, row.name])} /><Field label="Ισχύς έως" name="validUntil" type="datetime-local" required /><Field label="Επιθυμητή παράδοση" name="neededAt" type="date" /></div><OrderLinesEditor items={items} /><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default", "default", "justify-self-end")}>Δημιουργία πρόχειρης προσφοράς</Submit></form></Modal> : null;
  return (
    <Page section="Πελάτες & πωλήσεις" title="Προσφορές χονδρικής" description="Προσφορές με παγωμένες τιμές και ΦΠΑ, απόφαση πελάτη και μετατροπή σε πρόχειρη παραγγελία" actions={<span className="flex flex-wrap gap-2"><Link href="/wholesale-orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>{create}</span>}>
      <div className="grid gap-4">
        {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
        <Card>
          <DataTable
            id="wholesale-quotes"
            listing={{ ...list, total, placeholder: "Αριθμός ή πελάτης", filters: [{ key: "status", label: "Κατάσταση", value: status, options: statusOptions("wholesaleQuote") }] }}
            empty={<><p>Εδώ είναι οι προσφορές τιμών που στέλνεις στους πελάτες χονδρικής. Δεν έχεις φτιάξει καμία ακόμα.</p>{create ? <div className="mt-3 flex justify-center">{create}</div> : null}</>}
            columns={[
              { key: "number", label: "Αριθμός", required: true, sortable: true },
              { key: "date", label: "Ημερομηνία", sortable: true },
              { key: "customer", label: "Πελάτης" },
              { key: "warehouse", label: "Αποθήκη" },
              { key: "validUntil", label: "Ισχύς έως", sortable: true },
              { key: "lines", label: "Γραμμές", numeric: true },
              { key: "total", label: "Σύνολο", numeric: true, sortable: true },
              { key: "status", label: "Κατάσταση" },
              { key: "order", label: "Παραγγελία" },
              { key: "pdf", label: "Έντυπο" },
            ]}
            rows={quotes.map((quote) => {
              const due = quote.status === "SENT" ? dueStatus(quote.validUntil, now) : null;
              return {
                id: quote.id,
                cells: {
                  number: <Link href={`/wholesale-orders/quotes/${quote.id}`} className="font-semibold underline-offset-2 hover:underline">{quote.number}</Link>,
                  date: day.format(quote.createdAt),
                  customer: customerNames.get(quote.customerId) ?? "—",
                  warehouse: warehouseNames.get(quote.warehouseId) ?? "—",
                  validUntil: dateTime.format(quote.validUntil),
                  lines: quote._count.lines,
                  total: euro(quote.totalCents),
                  status: <span className="inline-flex flex-wrap items-center gap-1"><StatusBadge kind="wholesaleQuote" value={quote.status} />{due ? <StatusBadge look={due} /> : null}</span>,
                  order: quote.order ? <Link href={`/wholesale-orders/${quote.order.id}`} className="underline-offset-2 hover:underline">{quote.order.number}</Link> : "—",
                  pdf: <DocumentPdfButton entityType="wholesale_quote" entityId={quote.id} />,
                },
              };
            })}
          />
        </Card>
      </div>
    </Page>
  );
}
