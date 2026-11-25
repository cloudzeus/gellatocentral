import Link from "next/link";
import { ArrowLeft, BellRing, Boxes, Trash2 } from "lucide-react";
import { Submit } from "@/components/submit";
import { btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { stockAlerts, STOCK_EXPIRY_BUCKET_LABEL, type StockExpiryBucket } from "@/lib/stock-alerts";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { formatStockQuantity } from "@/lib/stock-view";
import { deleteStockThreshold, saveStockThreshold } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
const th = "px-4 py-3 text-left text-xs font-semibold whitespace-nowrap text-muted-foreground";
const td = "border-t border-border/70 px-4 py-3 align-middle";
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

  return (
    <Page
      section="Αποθήκη & αγορές"
      title="Ειδοποιήσεις αποθέματος"
      description="Χαμηλά υπόλοιπα βάσει ρητών ελαχίστων και ανοιχτές παρτίδες που έληξαν ή λήγουν έως 30 ημέρες"
      actions={<Link href="/inventory/stock" className={btn("outline", "sm")}><ArrowLeft /> Απόθεμα</Link>}
    >
      <div className="grid max-w-[90rem] gap-4">
        {q.error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {String(q.error)}</p> : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="px-5 py-4"><p className="text-xs font-medium text-muted-foreground">Χαμηλό απόθεμα</p><p className="mt-1 text-2xl font-semibold tabular-nums">{alerts.lowStock.length}</p></Card>
          <Card className="px-5 py-4"><p className="text-xs font-medium text-muted-foreground">Ληγμένες ανοιχτές παρτίδες</p><p className="mt-1 text-2xl font-semibold tabular-nums">{expired}</p></Card>
          <Card className="px-5 py-4"><p className="text-xs font-medium text-muted-foreground">Λήξεις έως 30 ημέρες</p><p className="mt-1 text-2xl font-semibold tabular-nums">{upcoming}</p></Card>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] border-collapse text-sm">
              <caption className="px-4 py-4 text-left"><span className="flex items-center gap-2 text-lg font-semibold"><BellRing className="size-5" /> Χαμηλό απόθεμα</span><span className="text-muted-foreground">Ειδοποίηση μόνο όταν το τρέχον υπόλοιπο είναι μικρότερο από το καταχωρισμένο ελάχιστο</span></caption>
              <thead className="bg-secondary/35"><tr><th className={th} scope="col">Είδος</th><th className={th} scope="col">Αποθήκη</th><th className={`${th} text-right`} scope="col">Τρέχον</th><th className={`${th} text-right`} scope="col">Ελάχιστο</th><th className={`${th} text-right`} scope="col">Έλλειμμα</th></tr></thead>
              <tbody>
                {alerts.lowStock.map((row) => (
                  <tr key={row.thresholdId} className="hover:bg-secondary/20">
                    <td className={`${td} font-semibold`}>{ctx.can("items.read") ? <Link href={`/items/${row.genericItemId}`} className="underline-offset-2 hover:underline">{row.itemName}</Link> : row.itemName}</td>
                    <td className={td}>{row.warehouseName}</td>
                    <td className={`${td} text-right font-semibold tabular-nums`}>{formatStockQuantity(row.quantity, row.baseUnit.dimension)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatStockQuantity(row.minimumQty, row.baseUnit.dimension)}</td>
                    <td className={`${td} text-right font-semibold text-destructive tabular-nums`}>{formatStockQuantity(row.minimumQty - row.quantity, row.baseUnit.dimension)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!alerts.lowStock.length ? <p className="px-4 pb-6 text-sm text-muted-foreground">Δεν υπάρχει υπόλοιπο κάτω από κάποιο καταχωρισμένο ελάχιστο.</p> : null}
        </Card>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[76rem] border-collapse text-sm">
              <caption className="px-4 py-4 text-left"><span className="block text-lg font-semibold">Λήξεις ανοιχτών παρτίδων</span><span className="text-muted-foreground">Μόνο θετικά υπόλοιπα · μηδενικές, αρνητικές και παρτίδες χωρίς λήξη εξαιρούνται</span></caption>
              <thead className="bg-secondary/35"><tr><th className={th} scope="col">Παρτίδα</th><th className={th} scope="col">Είδος</th><th className={th} scope="col">Αποθήκη</th><th className={`${th} text-right`} scope="col">Υπόλοιπο</th><th className={th} scope="col">Λήξη</th><th className={th} scope="col">Κατάσταση</th><th className={th} scope="col">Ιχνηλασιμότητα</th></tr></thead>
              <tbody>
                {alerts.expiringLots.map((row) => (
                  <tr key={row.lotId} className="hover:bg-secondary/20">
                    <td className={`${td} font-semibold tabular-nums`}>{row.batchNumber ?? "(χύμα)"}</td>
                    <td className={td}>{ctx.can("items.read") ? <Link href={`/items/${row.genericItemId}`} className="underline-offset-2 hover:underline">{row.itemName}</Link> : row.itemName}</td>
                    <td className={td}>{row.warehouseName}</td>
                    <td className={`${td} text-right font-semibold tabular-nums`}>{formatStockQuantity(row.quantity, row.baseUnit.dimension)}</td>
                    <td className={`${td} whitespace-nowrap`}>{day.format(row.expiresAt)}<span className="block text-xs text-muted-foreground">{expiryText(row.days)}</span></td>
                    <td className={td}><ExpiryBadge bucket={row.bucket} /></td>
                    <td className={td}><Link href={`/inventory/stock/lots/${row.lotId}`} className={btn("outline", "sm")}>Άνοιγμα</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!alerts.expiringLots.length ? <p className="px-4 pb-6 text-sm text-muted-foreground">Δεν υπάρχουν θετικές παρτίδες ληγμένες ή με λήξη έως 30 ημέρες.</p> : null}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Boxes className="size-5" /> Ελάχιστα ανά είδος και αποθήκη</h2>
            <p className="mt-1 text-sm text-muted-foreground">Το 0 δεν ειδοποιεί για μηδενικό απόθεμα, μόνο για αρνητικό. Χωρίς εγγραφή δεν παράγεται ειδοποίηση χαμηλού αποθέματος.</p>
          </div>
          {edit ? (
            <form action={saveStockThreshold} className="grid gap-3 border-b border-border/70 bg-secondary/30 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(9rem,12rem)_auto] md:items-end">
              <label className="space-y-1 text-sm font-medium">Αποθήκη
                <select name="warehouseId" required defaultValue="" className={field}>
                  <option value="" disabled>Επίλεξε αποθήκη</option>
                  {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.active ? "" : " (ανενεργή)"}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">Είδος
                <select name="genericItemId" required defaultValue="" className={field}>
                  <option value="" disabled>Επίλεξε είδος</option>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">Ελάχιστο σε βασική μονάδα
                <input name="minimumQty" type="number" required min={0} max={2_147_483_647} step={1} defaultValue={0} className={field} />
              </label>
              <Submit className={btn("default")}>Αποθήκευση ορίου</Submit>
              <p className="text-xs text-muted-foreground md:col-span-4">Για αλλαγή υπάρχοντος ορίου, επίλεξε ξανά το ίδιο ζεύγος αποθήκης και είδους.</p>
            </form>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] border-collapse text-sm">
              <thead className="bg-secondary/35"><tr><th className={th} scope="col">Είδος</th><th className={th} scope="col">Αποθήκη</th><th className={`${th} text-right`} scope="col">Τρέχον</th><th className={`${th} text-right`} scope="col">Ελάχιστο</th><th className={th} scope="col">Κατάσταση</th>{edit ? <th className={th} scope="col">Ενέργεια</th> : null}</tr></thead>
              <tbody>
                {alerts.thresholds.map((row) => (
                  <tr key={row.thresholdId} className="hover:bg-secondary/20">
                    <td className={`${td} font-semibold`}>{row.itemName}</td>
                    <td className={td}>{row.warehouseName}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatStockQuantity(row.quantity, row.baseUnit.dimension)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatStockQuantity(row.minimumQty, row.baseUnit.dimension)}</td>
                    <td className={td}><StatusBadge look={row.quantity < row.minimumQty ? look("danger", "Χαμηλό") : look("success", "Εντάξει")} /></td>
                    {edit ? <td className={td}><form action={deleteStockThreshold}><input type="hidden" name="warehouseId" value={row.warehouseId} /><input type="hidden" name="genericItemId" value={row.genericItemId} /><Submit className={btn("ghost", "sm")} aria-label={`Διαγραφή ορίου ${row.itemName}`}><Trash2 /> Διαγραφή</Submit></form></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!alerts.thresholds.length ? <p className="px-5 py-6 text-sm text-muted-foreground">Δεν έχουν οριστεί ελάχιστα αποθέματος στις επιτρεπτές αποθήκες.</p> : null}
        </Card>
      </div>
    </Page>
  );
}
