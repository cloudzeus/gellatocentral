import Link from "next/link";
import { ArrowLeft, ArrowRight, BellRing, Boxes, Layers3, Search, Warehouse } from "lucide-react";
import { Badge, btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { stockLotBalances, stockOverview } from "@/lib/stock-read";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { expiryStatus, formatStockQuantity, formatStockValue, stockUnitCostHundredths, type ExpiryStatus } from "@/lib/stock-view";

const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
const th = "px-4 py-3 text-left text-xs font-semibold whitespace-nowrap text-muted-foreground";
const td = "border-t border-border/70 px-4 py-3 align-middle";
const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });

function href(view: "items" | "lots", q: string, warehouse: string, page?: number) {
  const params = new URLSearchParams();
  if (view === "lots") params.set("view", "lots");
  if (q) params.set("q", q);
  if (warehouse) params.set("warehouse", warehouse);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/inventory/stock${query ? `?${query}` : ""}`;
}

function ExpiryBadge({ expiresAt }: { expiresAt: Date | null }) {
  const expiry = expiryStatus(expiresAt);
  const tone = expiry.status === "expired" ? "danger" : expiry.status === "today" || expiry.status === "urgent" || expiry.status === "soon" ? "warning" : expiry.status === "valid" ? "success" : "neutral";
  const labels: Record<ExpiryStatus, string> = {
    expired: `Έληξε${expiry.days !== null ? ` πριν από ${-expiry.days} ημ.` : ""}`,
    today: "Λήγει σήμερα",
    urgent: `Λήγει σε ${expiry.days} ημ.`,
    soon: `Λήγει σε ${expiry.days} ημ.`,
    valid: "Εν ισχύι",
    none: "Χωρίς λήξη",
  };
  return <Badge tone={tone}>{labels[expiry.status]}</Badge>;
}

function Pager({ view, q, warehouse, page, pageSize, total }: { view: "items" | "lots"; q: string; warehouse: string; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Σελίδες αποθέματος" className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-sm">
      <span className="text-muted-foreground">Σελίδα {Math.min(page, pages)} από {pages} · {total} εγγραφές</span>
      <span className="flex gap-2">
        {page > 1 ? <Link href={href(view, q, warehouse, page - 1)} className={btn("outline", "sm")}><ArrowLeft /> Προηγούμενη</Link> : null}
        {page < pages ? <Link href={href(view, q, warehouse, page + 1)} className={btn("outline", "sm")}>Επόμενη <ArrowRight /></Link> : null}
      </span>
    </nav>
  );
}

// Read-only STK-02/STK-03: όλα τα δεδομένα και τα φίλτρα αποδίδονται στον server.
export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const view = filterParam(q, "view", ["items", "lots"]) ?? "items";
  const warehouse = typeof q.warehouse === "string" ? q.warehouse : "";
  const list = listParams(q, 50);
  const ctx = await requireStockContext("stock.read", { warehouseId: warehouse || undefined });
  const warehouses = await db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true, name: true, active: true }, orderBy: { name: "asc" } });
  const warehouseIds = warehouse ? [warehouse] : warehouses.map((item) => item.id);
  const input = { orgId: ctx.orgId, warehouseIds, q: list.q, skip: list.skip, take: list.take };
  const overview = view === "items" ? await stockOverview(db, input) : null;
  const lots = view === "lots" ? await stockLotBalances(db, input) : null;
  const total = overview?.total ?? lots?.total ?? 0;

  return (
    <Page
      section="Αποθήκη & αγορές"
      title="Απόθεμα"
      description="Πραγματικό υπόλοιπο πρώτων υλών από τις κινήσεις αποθήκης, με κόστος, λήξεις και σειρά FEFO"
      actions={<div className="flex flex-wrap gap-2"><Link href="/inventory/alerts" className={btn("outline", "sm")}><BellRing /> Ειδοποιήσεις</Link>{ctx.can("warehouses.read") ? <Link href="/inventory" className={btn("outline", "sm")}><Warehouse /> Αποθήκες</Link> : null}</div>}
    >
      <div className="grid max-w-[90rem] gap-4">
        <nav aria-label="Προβολή αποθέματος" className="flex w-fit flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          <Link href={href("items", list.q, warehouse)} aria-current={view === "items" ? "page" : undefined} className={btn(view === "items" ? "default" : "ghost", "sm")}><Boxes /> Υπόλοιπα</Link>
          <Link href={href("lots", list.q, warehouse)} aria-current={view === "lots" ? "page" : undefined} className={btn(view === "lots" ? "default" : "ghost", "sm")}><Layers3 /> Παρτίδες & FEFO</Link>
        </nav>

        <Card>
          <form method="get" action="/inventory/stock" role="search" className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,20rem)_auto] sm:items-end">
            {view === "lots" ? <input type="hidden" name="view" value="lots" /> : null}
            <label className="space-y-1 text-sm font-medium">
              {view === "items" ? "Αναζήτηση είδους" : "Είδος ή αριθμός παρτίδας"}
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input name="q" defaultValue={list.q} maxLength={80} placeholder={view === "items" ? "π.χ. γάλα ή ζάχαρη" : "π.χ. γάλα ή LOT-2026"} className={`${field} pl-9`} />
              </span>
            </label>
            <label className="space-y-1 text-sm font-medium">Αποθήκη
              <select name="warehouse" defaultValue={warehouse} className={field}>
                <option value="">Όλες οι επιτρεπτές</option>
                {warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : " (ανενεργή)"}</option>)}
              </select>
            </label>
            <button type="submit" className={btn("default")}>Εφαρμογή</button>
          </form>
        </Card>

        {overview ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="px-5 py-4"><p className="text-xs font-medium text-muted-foreground">Εγγραφές αποθέματος</p><p className="mt-1 text-2xl font-semibold tabular-nums">{overview.total}</p></Card>
              <Card className="px-5 py-4"><p className="text-xs font-medium text-muted-foreground">Καταγεγραμμένη αξία φίλτρου</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatStockValue(overview.totalValueHundredths)}</p></Card>
            </div>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[58rem] border-collapse text-sm">
                  <caption className="px-4 py-4 text-left"><span className="block text-lg font-semibold">Διαθέσιμο ανά είδος και αποθήκη</span><span className="text-muted-foreground">Aggregation απευθείας από το append-only ιστορικό κινήσεων</span></caption>
                  <thead className="bg-secondary/35"><tr><th className={th} scope="col">Είδος</th><th className={th} scope="col">Αποθήκη</th><th className={`${th} text-right`} scope="col">Διαθέσιμο</th><th className={`${th} text-right`} scope="col">Μέσο κόστος</th><th className={`${th} text-right`} scope="col">Αξία</th></tr></thead>
                  <tbody>
                    {overview.rows.map((row) => (
                      <tr key={`${row.warehouseId}-${row.genericItemId}`} className="hover:bg-secondary/20">
                        <td className={`${td} font-semibold`}>{ctx.can("items.read") ? <Link href={`/items/${row.genericItemId}`} className="underline-offset-2 hover:underline">{row.itemName}</Link> : row.itemName}</td>
                        <td className={td}>{row.warehouseName}</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{formatStockQuantity(row.quantity, row.baseUnit.dimension)}</td>
                        <td className={`${td} text-right tabular-nums`}>{row.unitCostHundredths > 0 ? <>{formatStockValue(stockUnitCostHundredths(row.unitCostHundredths, row.baseUnit.toBase))} <span className="text-xs text-muted-foreground">/ {row.baseUnit.code}</span></> : "—"}</td>
                        <td className={`${td} text-right font-medium tabular-nums`}>{row.unitCostHundredths > 0 ? formatStockValue(row.valueHundredths) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!overview.rows.length ? <p className="px-4 pb-6 text-sm text-muted-foreground">Δεν βρέθηκε μη μηδενικό απόθεμα με αυτά τα φίλτρα.</p> : null}
              <Pager view={view} q={list.q} warehouse={warehouse} page={list.page} pageSize={list.pageSize} total={total} />
            </Card>
            <p className="text-xs text-muted-foreground">Το διαθέσιμο ισούται με το on-hand. Δεν εμφανίζεται δεσμευμένη ποσότητα επειδή δεν υπάρχει ακόμη μοντέλο δεσμεύσεων. Η αποτίμηση χρησιμοποιεί το τρέχον μέσο σταθμισμένο κόστος· «—» σημαίνει ότι δεν έχει καταχωριστεί κόστος.</p>
          </>
        ) : null}

        {lots ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[70rem] border-collapse text-sm">
                <caption className="px-4 py-4 text-left"><span className="block text-lg font-semibold">Ανοιχτές παρτίδες με σειρά FEFO</span><span className="text-muted-foreground">Νωρίτερη λήξη πρώτη · παρτίδες χωρίς λήξη τελευταίες · μηδενικά υπόλοιπα εξαιρούνται</span></caption>
                <thead className="bg-secondary/35"><tr><th className={th} scope="col">Σειρά</th><th className={th} scope="col">Παρτίδα</th><th className={th} scope="col">Είδος</th><th className={th} scope="col">Αποθήκη</th><th className={`${th} text-right`} scope="col">Υπόλοιπο</th><th className={th} scope="col">Λήξη</th><th className={th} scope="col">Κατάσταση</th><th className={th} scope="col">Ιχνηλασιμότητα</th></tr></thead>
                <tbody>
                  {lots.rows.map((row, index) => (
                    <tr key={row.lotId} className="hover:bg-secondary/20">
                      <td className={`${td} text-muted-foreground tabular-nums`}>{list.skip + index + 1}</td>
                      <td className={`${td} font-semibold tabular-nums`}>{row.batchNumber ?? "(χύμα)"}</td>
                      <td className={td}>{row.itemName}</td>
                      <td className={td}>{row.warehouseName}</td>
                      <td className={`${td} text-right font-semibold tabular-nums`}>{formatStockQuantity(row.quantity, row.baseUnit.dimension)}</td>
                      <td className={`${td} whitespace-nowrap`}>{row.expiresAt ? day.format(row.expiresAt) : "—"}</td>
                      <td className={td}><ExpiryBadge expiresAt={row.expiresAt} /></td>
                      <td className={td}><Link href={`/inventory/stock/lots/${row.lotId}`} className={btn("outline", "sm")}>Άνοιγμα</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!lots.rows.length ? <p className="px-4 pb-6 text-sm text-muted-foreground">Δεν βρέθηκαν ανοιχτές παρτίδες με θετικό υπόλοιπο.</p> : null}
            <Pager view={view} q={list.q} warehouse={warehouse} page={list.page} pageSize={list.pageSize} total={total} />
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
