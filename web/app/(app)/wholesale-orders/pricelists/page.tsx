import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { OrderLinesEditor } from "@/components/order-lines-editor";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { look } from "@/lib/status";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { newPriceList } from "../actions";

export default async function PriceListsPage({ searchParams }: PageProps<"/wholesale-orders/pricelists">) {
  const ctx = await requireStockContext("wholesale.read");
  const query = await searchParams;
  const list = listParams(query, 25, ["name", "validFrom"]);
  const active = filterParam(query, "active", ["yes", "no"]);
  // αναζήτηση: όνομα τιμοκαταλόγου
  const where = {
    orgId: ctx.orgId,
    ...(active ? { active: active === "yes" } : {}),
    ...(list.q ? { name: { contains: list.q, mode: "insensitive" as const } } : {}),
  };
  const orderBy = list.sort === "name" ? [{ name: list.dir }] : [{ validFrom: list.sort === "validFrom" ? list.dir : ("desc" as const) }, { id: "desc" as const }];
  const [lists, total, customers, generics] = await Promise.all([
    db.priceList.findMany({ where, include: { items: true, parties: true }, orderBy, skip: list.skip, take: list.take }),
    db.priceList.count({ where }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "customer" }, active: true }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, include: { baseUnit: true, vatRate: true }, orderBy: { name: "asc" } }),
  ]);
  const names = new Map(customers.map((row) => [row.id, row.name]));
  const itemNames = new Map(generics.map((row) => [row.id, row.name]));
  const items = generics.map((item) => ({ id: item.id, name: item.name, scale: stockCostScale(item.baseUnit.dimension), unitLabel: item.baseUnit.dimension === "mass" ? "kg" : item.baseUnit.dimension === "volume" ? "l" : "1000 τεμ.", defaultVat: item.vatRate?.rate ?? 24 }));
  const day = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens" });
  const create = ctx.can("wholesale.edit") ? <Modal wide label={<><Plus /> Νέος τιμοκατάλογος</>} title="Νέος τιμοκατάλογος" description="Η ποσότητα στις γραμμές δεν χρησιμοποιείται· καταχώρισε μόνο είδος, τιμή και ΦΠΑ."><form action={newPriceList} className="grid gap-4"><div className="grid gap-3 md:grid-cols-4"><Field label="Όνομα" name="name" required maxLength={100} /><Select label="Πελάτης" name="customerId" options={[["", "Γενικός τιμοκατάλογος"], ...customers.map((row): [string, string] => [row.id, row.name])]} /><Field label="Ισχύς από" name="validFrom" type="datetime-local" required /><Field label="Ισχύς έως" name="validTo" type="datetime-local" /></div><OrderLinesEditor items={items} priceLabel="Τιμή χονδρικής" /><Submit className={btn("default", "default", "justify-self-end")}>Αποθήκευση τιμοκαταλόγου</Submit></form></Modal> : null;
  return (
    <Page section="Πελάτες & πωλήσεις" title="Τιμοκατάλογοι χονδρικής" description="Γενικές και πελατειακές τιμές με χρονική ισχύ· οι B2B τιμές υπολογίζονται μόνο στον server" actions={<span className="flex gap-2"><Link href="/wholesale-orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>{create}</span>}>
      <div className="grid gap-4">
        {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
        <Card>
          <DataTable
            id="wholesale-pricelists"
            listing={{ ...list, total, placeholder: "Όνομα τιμοκαταλόγου", filters: [{ key: "active", label: "Κατάσταση", value: active, options: [["yes", "Ενεργός"], ["no", "Ανενεργός"]] }] }}
            empty={<><p>Εδώ ορίζεις τις τιμές χονδρικής, για όλους ή για έναν πελάτη. Δεν υπάρχει κανένας τιμοκατάλογος ακόμα.</p>{create ? <div className="mt-3 flex justify-center">{create}</div> : null}</>}
            columns={[
              { key: "name", label: "Τιμοκατάλογος", required: true, sortable: true },
              { key: "customer", label: "Πελάτης" },
              { key: "validFrom", label: "Ισχύς από", sortable: true },
              { key: "validTo", label: "Ισχύς έως" },
              { key: "items", label: "Είδη", numeric: true },
              { key: "status", label: "Κατάσταση" },
            ]}
            rows={lists.map((row) => ({
              id: row.id,
              cells: {
                name: <span className="font-semibold">{row.name}</span>,
                customer: row.parties.length ? names.get(row.parties[0].partyId) ?? "Πελάτης" : "Γενικός",
                validFrom: day.format(row.validFrom),
                validTo: row.validTo ? day.format(row.validTo) : "χωρίς λήξη",
                items: row.items.length,
                status: <StatusBadge look={row.active ? look("success", "Ενεργός") : look("neutral", "Ανενεργός")} />,
              },
              details: {
                label: row.name,
                view: row.items.length
                  ? <div className="grid gap-1 text-sm">{row.items.map((item) => <div key={item.id} className="flex justify-between gap-4 border-b border-border/50 py-1 last:border-0"><span>{itemNames.get(item.genericItemId) ?? "Είδος"}</span><span className="tabular-nums">{euro(item.unitPriceCents)} · ΦΠΑ {item.vatRate}%</span></div>)}</div>
                  : <p className="text-sm text-muted-foreground">Ο τιμοκατάλογος δεν έχει είδη.</p>,
              },
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
