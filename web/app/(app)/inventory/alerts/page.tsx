import Link from "next/link";
import { ArrowLeft, BellRing, CalendarClock, CalendarX2, Plus, Trash2 } from "lucide-react";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Kpi, Page, Select } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { db } from "@/lib/db";
import { stockAlerts, STOCK_EXPIRY_BUCKET_LABEL, type StockExpiryBucket } from "@/lib/stock-alerts";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { formatStockQuantity } from "@/lib/stock-view";
import { deleteStockThreshold, saveStockThreshold } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });

function expiryText(days: number): string {
  if (days < 0) return `Έληξε πριν από ${-days} ημ.`;
  if (days === 0) return "Λήγει σήμερα";
  return `Λήγει σε ${days} ημ.`;
}

function ExpiryBadge({ bucket }: { bucket: StockExpiryBucket }) {
  return <StatusBadge look={look(bucket === "expired" ? "danger" : "warning", STOCK_EXPIRY_BUCKET_LABEL[bucket])} />;
}

// STK-09: όλη η ανάγνωση και τα mutations αποδίδονται server-side· δεν χρειάζεται client state.
export default async function StockAlertsPage({ searchParams }: PageProps<"/inventory/alerts">) {
  const q = await searchParams;
  const ctx = await requireStockContext("stock.read");
  const edit = ctx.can("warehouses.edit");
  const [warehouses, alerts, items] = await Promise.all([
    db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
    stockAlerts(db, ctx),
    edit ? db.genericItem.findMany({ where: { orgId: ctx.orgId, trackStock: true, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const expired = alerts.expiringLots.filter((lot) => lot.bucket === "expired").length;
  const upcoming = alerts.expiringLots.length - expired;

  const itemLink = (id: string, name: string) => ctx.can("items.read") ? <Link href={`/items/${id}`} className="font-semibold underline-offset-2 hover:underline">{name}</Link> : <span className="font-semibold">{name}</span>;
  const thresholdModal = edit ? <Modal size="sm" variant="default" label={<><Plus /> Ελάχιστο</>} title="Ελάχιστο απόθεμα" description="Όταν το υπόλοιπο πέσει κάτω από αυτό, το είδος εμφανίζεται στο «Τελειώνουν». Για αλλαγή, διάλεξε ξανά την ίδια αποθήκη και είδος.">
    <form action={saveStockThreshold} className="grid gap-3">
      <Select label="Αποθήκη" name="warehouseId" required options={[["", "Διάλεξε αποθήκη"], ...warehouses.map((w): [string, string] => [w.id, `${w.name}${w.active ? "" : " (ανενεργή)"}`])]} />
      <Select label="Είδος" name="genericItemId" required options={[["", "Διάλεξε είδος"], ...items.map((i): [string, string] => [i.id, i.name])]} />
      <Field label="Ελάχιστο (σε βασική μονάδα)" name="minimumQty" type="number" required min={0} max={2_147_483_647} step={1} defaultValue={0} hint="Το 0 ειδοποιεί μόνο για αρνητικό υπόλοιπο" />
      <Submit className={btn("default", "default", "justify-self-end")}>Αποθήκευση</Submit>
    </form>
  </Modal> : null;
  const low = alerts.lowStock.length;

  return (
    <Page
      section="Αποθήκη & αγορές"
      title="Ειδοποιήσεις αποθέματος"
      description="Τι τελειώνει και ποιες παρτίδες έληξαν ή λήγουν μέσα σε 30 ημέρες"
      actions={<span className="flex flex-wrap gap-2"><Link href="/inventory/stock" className={btn("outline", "sm")}><ArrowLeft /> Απόθεμα</Link>{thresholdModal}</span>}
    >
      <div className="grid max-w-[90rem] gap-4">
        {q.error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 font-medium text-destructive">Δεν αποθηκεύτηκε: {String(q.error)}</p> : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi icon={BellRing} label="Τελειώνουν" value={low} tone={low ? "warning" : alerts.thresholds.length ? "success" : "neutral"} hint={low ? "Κάνε παραγγελία πριν μείνεις χωρίς" : alerts.thresholds.length ? "Όλα πάνω από το ελάχιστο" : "Όρισε ελάχιστα για να ειδοποιείσαι"} />
          <Kpi icon={CalendarX2} label="Ληγμένες παρτίδες" value={expired} tone={expired ? "danger" : "success"} hint={expired ? "Βγάλ' τες από τη χρήση και κατέγραψε φύρα" : "Καμία ληγμένη παρτίδα σε απόθεμα"} />
          <Kpi icon={CalendarClock} label="Λήγουν σε 30 ημέρες" value={upcoming} tone={upcoming ? "warning" : "success"} hint={upcoming ? "Χρησιμοποίησέ τες πρώτες" : "Τίποτα δεν λήγει σύντομα"} />
        </div>

        <section className="grid gap-2">
          <h2 className="text-base font-semibold">Τελειώνουν</h2>
          <Card>
            <DataTable id="stock-low" empty={<p>Κανένα είδος κάτω από το ελάχιστο. {alerts.thresholds.length ? "" : "Όρισε ελάχιστα για να ειδοποιείσαι εδώ."}</p>}
              columns={[{ key: "item", label: "Είδος", required: true }, { key: "warehouse", label: "Αποθήκη" }, { key: "qty", label: "Τρέχον", numeric: true }, { key: "min", label: "Ελάχιστο", numeric: true }, { key: "gap", label: "Λείπουν", numeric: true }]}
              rows={alerts.lowStock.map((row) => ({ id: row.thresholdId, cells: {
                item: itemLink(row.genericItemId, row.itemName), warehouse: row.warehouseName,
                qty: formatStockQuantity(row.quantity, row.baseUnit.dimension), min: formatStockQuantity(row.minimumQty, row.baseUnit.dimension),
                gap: <span className="font-semibold text-destructive">{formatStockQuantity(row.minimumQty - row.quantity, row.baseUnit.dimension)}</span>,
              } }))} />
          </Card>
        </section>

        <section className="grid gap-2">
          <h2 className="text-base font-semibold">Λήξεις παρτίδων</h2>
          <Card>
            <DataTable id="stock-expiring" empty={<p>Καμία παρτίδα σε απόθεμα δεν έχει λήξει ούτε λήγει μέσα σε 30 ημέρες.</p>}
              columns={[{ key: "lot", label: "Παρτίδα", required: true }, { key: "status", label: "Κατάσταση" }, { key: "item", label: "Είδος" }, { key: "warehouse", label: "Αποθήκη" }, { key: "qty", label: "Υπόλοιπο", numeric: true }, { key: "expires", label: "Λήξη" }]}
              rows={alerts.expiringLots.map((row) => ({ id: row.lotId, cells: {
                lot: <Link href={`/inventory/stock/lots/${row.lotId}`} className="font-semibold tabular-nums underline-offset-2 hover:underline">{row.batchNumber ?? "(χύμα)"}</Link>,
                status: <ExpiryBadge bucket={row.bucket} />, item: itemLink(row.genericItemId, row.itemName), warehouse: row.warehouseName,
                qty: formatStockQuantity(row.quantity, row.baseUnit.dimension),
                expires: <span className="whitespace-nowrap">{day.format(row.expiresAt)} <span className={row.days < 0 ? "text-destructive" : "text-warning-ink"}>· {expiryText(row.days)}</span></span>,
              } }))} />
          </Card>
        </section>

        <section className="grid gap-2">
          <h2 className="text-base font-semibold">Ελάχιστα ανά είδος και αποθήκη</h2>
          <Card>
            <DataTable id="stock-thresholds" empty={<><p>Δεν έχεις ορίσει ελάχιστα. Χωρίς αυτά δεν ειδοποιείσαι όταν κάτι τελειώνει.</p>{thresholdModal ? <div className="mt-3 flex justify-center">{thresholdModal}</div> : null}</>}
              columns={[{ key: "item", label: "Είδος", required: true }, { key: "status", label: "Κατάσταση" }, { key: "warehouse", label: "Αποθήκη" }, { key: "qty", label: "Τρέχον", numeric: true }, { key: "min", label: "Ελάχιστο", numeric: true }]}
              rows={alerts.thresholds.map((row) => ({ id: row.thresholdId, cells: {
                item: <span className="font-semibold">{row.itemName}</span>, warehouse: row.warehouseName,
                status: <StatusBadge look={row.quantity < row.minimumQty ? look("danger", "Χαμηλό") : look("success", "Εντάξει")} />,
                qty: formatStockQuantity(row.quantity, row.baseUnit.dimension), min: formatStockQuantity(row.minimumQty, row.baseUnit.dimension),
              }, actions: edit ? <form action={deleteStockThreshold}><input type="hidden" name="warehouseId" value={row.warehouseId} /><input type="hidden" name="genericItemId" value={row.genericItemId} /><Submit className={btn("ghost", "sm")} aria-label={`Διαγραφή ορίου ${row.itemName}`} title="Διαγραφή ορίου"><Trash2 /></Submit></form> : undefined }))} />
          </Card>
        </section>
      </div>
    </Page>
  );
}
