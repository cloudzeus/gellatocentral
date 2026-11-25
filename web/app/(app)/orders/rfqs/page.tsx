import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { partyIdsByName } from "@/lib/list-search";
import { filterParam, listParams } from "@/lib/paging";
import { dueStatus, statusOptions, statusValues } from "@/lib/status";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { newRfq } from "../actions";

export default async function RfqsPage({ searchParams }: PageProps<"/orders/rfqs">) {
  const query = await searchParams;
  const ctx = await requireStockContext("orders.read");
  const list = listParams(query, 25, ["number", "date", "replyBy"]);
  const status = filterParam(query, "status", statusValues("rfq"));
  const matchingSuppliers = await partyIdsByName(ctx.orgId, list.q);
  // αναζήτηση: αριθμός αιτήματος ή όνομα προμηθευτή που το έλαβε
  const where = {
    orgId: ctx.orgId,
    ...(status ? { status } : {}),
    ...(list.q ? { OR: [{ number: { contains: list.q, mode: "insensitive" as const } }, { suppliers: { some: { supplierId: { in: matchingSuppliers } } } }] } : {}),
  };
  const orderBy = list.sort === "number" ? [{ number: list.dir }] : list.sort === "replyBy" ? [{ replyBy: list.dir }, { id: "desc" as const }] : [{ createdAt: list.sort === "date" ? list.dir : ("desc" as const) }, { id: "desc" as const }];
  const [rfqs, total, suppliers, generics] = await Promise.all([
    db.rfq.findMany({ where, include: { _count: { select: { lines: true } }, suppliers: { select: { respondedAt: true } } }, orderBy, skip: list.skip, take: list.take }),
    db.rfq.count({ where }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "supplier" }, active: true }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true }, include: { baseUnit: true }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  const day = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens" });
  const create = ctx.can("orders.add") ? <Modal wide size="sm" title="Νέο αίτημα προσφοράς" label={<><Plus /> Νέο RFQ</>}><form action={newRfq} className="grid gap-4"><Field label="Προθεσμία" name="replyBy" type="date" required /><fieldset className="grid gap-2"><legend className="text-sm font-medium">Προμηθευτές</legend>{suppliers.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="supplierIds" value={s.id} className="size-4" />{s.name}</label>)}</fieldset><div className="grid gap-2">{generics.map((g) => <div key={g.id} className="grid grid-cols-[1fr_10rem] items-end gap-2"><input type="hidden" name="genericItemId" value={g.id} /><p className="pb-2 text-sm">{g.name}</p><Field label={`Ποσότητα (${g.baseUnit.dimension === "mass" ? "kg" : g.baseUnit.dimension === "volume" ? "l" : "1000 τεμ."})`} name="quantity" inputMode="decimal" placeholder="0" data-scale={stockCostScale(g.baseUnit.dimension)} /></div>)}</div><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default", "default", "justify-self-end")} pendingText="Δημιουργία…">Δημιουργία & σύνδεσμοι</Submit></form></Modal> : null;
  return (
    <Page section="Αποθήκη & αγορές" title="Αιτήματα προσφοράς" description="Σύγκριση προμηθευτών με ασφαλείς, προσωπικούς συνδέσμους" actions={<span className="flex flex-wrap gap-2"><Link href="/orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>{create}</span>}>
      <div className="grid gap-4">
        {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
        <Card>
          <DataTable
            id="rfqs"
            listing={{ ...list, total, placeholder: "Αριθμός ή προμηθευτής", filters: [{ key: "status", label: "Κατάσταση", value: status, options: statusOptions("rfq") }] }}
            empty={<><p>Εδώ ζητάς τιμές από πολλούς προμηθευτές μαζί και τις συγκρίνεις. Δεν έχεις στείλει κανένα αίτημα ακόμα.</p>{create ? <div className="mt-3 flex justify-center">{create}</div> : null}</>}
            columns={[
              { key: "number", label: "Αίτημα", required: true, sortable: true },
              { key: "status", label: "Κατάσταση" },
              { key: "date", label: "Δημιουργήθηκε", sortable: true },
              { key: "replyBy", label: "Προθεσμία", sortable: true },
              { key: "lines", label: "Είδη", numeric: true },
              { key: "replies", label: "Προσφορές", numeric: true },
              ]}
            rows={rfqs.map((rfq) => {
              const due = dueStatus(rfq.replyBy, now, rfq.status !== "OPEN");
              return {
                id: rfq.id,
                cells: {
                  number: <Link href={`/orders/rfqs/${rfq.id}`} className="font-semibold underline-offset-2 hover:underline">{rfq.number}</Link>,
                  date: day.format(rfq.createdAt),
                  replyBy: day.format(rfq.replyBy),
                  lines: rfq._count.lines,
                  replies: `${rfq.suppliers.filter((s) => s.respondedAt).length}/${rfq.suppliers.length}`,
                  status: <span className="inline-flex flex-wrap items-center gap-1"><StatusBadge kind="rfq" value={rfq.status} />{due ? <StatusBadge look={due} /> : null}</span>,
                },
              };
            })}
          />
        </Card>
      </div>
    </Page>
  );
}
