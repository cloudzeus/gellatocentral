import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { partyIdsByName } from "@/lib/list-search";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { paymentStatus, statusOptions, statusValues } from "@/lib/status";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { outstandingCents } from "@/lib/wholesale";

const TYPE = { "1.1": "Τιμολόγιο", "5.1": "Πιστωτικό", "9.3": "Δελτίο παράδοσης" } as const;
const TYPES = Object.keys(TYPE) as (keyof typeof TYPE)[];
// ο αύξων αριθμός είναι Int στη βάση: ως 9 ψηφία, για να μη σκάσει το ερώτημα σε ό,τι γράψει κάποιος
const wholeNumber = (text: string) => (/^\d{1,9}$/.test(text) ? Number(text) : null);

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const ctx = await requireStockContext("invoices.read");
  const query = await searchParams;
  const list = listParams(query, 25, ["date", "total"]);
  const status = filterParam(query, "status", statusValues("salesDocument"));
  const type = filterParam(query, "type", TYPES);
  const [warehouses, matchingCustomers] = await Promise.all([
    db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true, name: true } }),
    partyIdsByName(ctx.orgId, list.q),
  ]);
  // αναζήτηση: «ΤΙΜ-12», σκέτη σειρά, αύξων αριθμός, αριθμός παραγγελίας ή όνομα πελάτη
  const dash = list.q.lastIndexOf("-");
  const aa = wholeNumber(list.q);
  const aaAfterDash = dash > 0 ? wholeNumber(list.q.slice(dash + 1)) : null;
  const where = {
    orgId: ctx.orgId, warehouseId: { in: warehouses.map((row) => row.id) }, ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}),
    ...(status ? { status } : {}),
    ...(type ? { docType: type } : {}),
    ...(list.q ? { OR: [
      { series: { contains: list.q, mode: "insensitive" as const } },
      { order: { number: { contains: list.q, mode: "insensitive" as const } } },
      { customerId: { in: matchingCustomers } },
      ...(aa !== null ? [{ aa }] : []),
      ...(aaAfterDash !== null ? [{ series: { equals: list.q.slice(0, dash), mode: "insensitive" as const }, aa: aaAfterDash }] : []),
    ] } : {}),
  };
  const orderBy = list.sort === "total" ? [{ totalCents: list.dir }, { id: "desc" as const }] : [{ issuedAt: list.sort === "date" ? list.dir : ("desc" as const) }, { id: "desc" as const }];
  const [documents, total] = await Promise.all([
    db.salesDocument.findMany({ where, include: { allocations: true, order: { select: { number: true } } }, orderBy, skip: list.skip, take: list.take }),
    db.salesDocument.count({ where }),
  ]);
  const customers = await db.party.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set(documents.map((document) => document.customerId))] } }, select: { id: true, name: true } });
  const names = new Map(customers.map((customer) => [customer.id, customer.name]));
  const now = new Date();
  const day = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens" });
  return (
    <Page section="Πελάτες & πωλήσεις" title="Παραστατικά χονδρικής" description="Τιμολόγια, πιστωτικά και δελτία παράδοσης με απλήρωτα και myDATA ιστορικό" actions={<Link href="/wholesale-orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>}>
      <div className="grid gap-4">
        {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
        <Card>
          <DataTable
            id="sales-documents"
            listing={{
              ...list, total, placeholder: "Παραστατικό (π.χ. ΤΙΜ-12), παραγγελία ή πελάτης",
              filters: [
                { key: "type", label: "Είδος", value: type, options: TYPES.map((key): [string, string] => [key, TYPE[key]]) },
                { key: "status", label: "Κατάσταση", value: status, options: statusOptions("salesDocument") },
              ],
            }}
            empty={<><p>Εδώ είναι τα τιμολόγια, τα πιστωτικά και τα δελτία παράδοσης της χονδρικής. Δεν έχει εκδοθεί κανένα ακόμα: εκδίδονται μέσα από μια παραγγελία χονδρικής.</p><div className="mt-3 flex justify-center"><Link href="/wholesale-orders" className={btn("outline", "sm")}>Παραγγελίες χονδρικής</Link></div></>}
            columns={[
              { key: "document", label: "Παραστατικό", required: true },
              { key: "status", label: "Κατάσταση" },
              { key: "type", label: "Είδος" },
              { key: "customer", label: "Πελάτης" },
              { key: "order", label: "Παραγγελία", narrowHidden: true },
              { key: "date", label: "Ημερομηνία", sortable: true },
              { key: "total", label: "Σύνολο", numeric: true, sortable: true },
              { key: "outstanding", label: "Απλήρωτο", numeric: true },
              ]}
            rows={documents.map((document) => {
              const outstanding = outstandingCents(document, document.allocations);
              return {
                id: document.id,
                // η «Παραγγελία» κρύβεται στον πίνακα κάτω από 2xl: εδώ φαίνεται πάντα
                details: { label: `${document.series}-${document.aa}`, view: <p className="text-sm">Παραγγελία: <Link href={`/wholesale-orders/${document.orderId}`} className="font-semibold underline underline-offset-2">{document.order.number}</Link></p> },
                cells: {
                  document: <Link href={`/invoices/${document.id}`} className="font-semibold underline-offset-2 hover:underline">{document.series}-{document.aa}</Link>,
                  type: TYPE[document.docType as keyof typeof TYPE] ?? document.docType,
                  customer: names.get(document.customerId) ?? "—",
                  order: <Link href={`/wholesale-orders/${document.orderId}`} className="underline-offset-2 hover:underline">{document.order.number}</Link>,
                  date: day.format(document.issuedAt),
                  total: euro(document.totalCents),
                  outstanding: document.docType === "1.1" ? euro(outstanding) : "—",
                  status: document.docType === "1.1"
                    ? <StatusBadge look={paymentStatus({ outstandingCents: outstanding, dueAt: document.dueAt, cancelled: document.status === "CANCELLED" }, now)} />
                    : <StatusBadge kind="salesDocument" value={document.status} />,
                },
              };
            })}
          />
        </Card>
      </div>
    </Page>
  );
}
