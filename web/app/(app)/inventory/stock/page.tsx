import Link from "next/link";
import { BellRing, Boxes, Layers3, Warehouse } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { DetailGrid, Badge, btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { stockLotBalances, stockOverview } from "@/lib/stock-read";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { expiryStatus, formatStockQuantity, formatStockValue, stockDisplayUnit, stockUnitCostHundredths, type ExpiryStatus } from "@/lib/stock-view";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });

function href(view: "items" | "lots", q: string, warehouse: string) {
  const params = new URLSearchParams();
  if (view === "lots") params.set("view", "lots");
  if (q) params.set("q", q);
  if (warehouse) params.set("warehouse", warehouse);
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

// Read-only STK-02/STK-03: δεδομένα, φίλτρα, ταξινόμηση και σελίδες αποδίδονται στον server.
export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const view = filterParam(q, "view", ["items", "lots"]) ?? "items";
  const warehouse = typeof q.warehouse === "string" ? q.warehouse : "";
  const list = listParams(q, 50, ["item", "warehouse", "quantity", "cost", "value", "batch", "expiresAt"] as const);
  const ctx = await requireStockContext("stock.read", { warehouseId: warehouse || undefined });
  const warehouses = await db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true, name: true, active: true }, orderBy: { name: "asc" } });
  const warehouseIds = warehouse ? [warehouse] : warehouses.map((item) => item.id);
  const input = { orgId: ctx.orgId, warehouseIds, q: list.q, skip: list.skip, take: list.take, sort: list.sort, dir: list.dir };
  const overview = view === "items" ? await stockOverview(db, input) : null;
  const lots = view === "lots" ? await stockLotBalances(db, input) : null;
  const total = overview?.total ?? lots?.total ?? 0;
  const warehouseFilter = { key: "warehouse", label: "Αποθήκη", value: warehouse, options: warehouses.map((item): [string, string] => [item.id, `${item.name}${item.active ? "" : " (ανενεργή)"}`]) };

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

        {overview ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="px-5 py-4"><p className="text-xs font-medium text-muted-foreground">Εγγραφές αποθέματος</p><p className="mt-1 text-2xl font-semibold tabular-nums">{overview.total}</p></Card>
              <Card className="px-5 py-4"><p className="text-xs font-medium text-muted-foreground">Καταγεγραμμένη αξία φίλτρου</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatStockValue(overview.totalValueHundredths)}</p></Card>
            </div>
            <Card className="overflow-hidden">
              <div className="px-4 pt-4"><h2 className="text-lg font-semibold">Διαθέσιμο ανά είδος και αποθήκη</h2><p className="text-sm text-muted-foreground">Συγκέντρωση απευθείας από το append-only ιστορικό κινήσεων</p></div>
              <DataTable
                id="stock-items"
                listing={{ ...list, total, placeholder: "Αναζήτηση είδους…", filters: [warehouseFilter] }}
                empty="Δεν βρέθηκε μη μηδενικό απόθεμα με αυτά τα φίλτρα."
                columns={[
                  { key: "item", label: "Είδος", required: true, sortable: true, wrap: true },
                  { key: "warehouse", label: "Αποθήκη", sortable: true, wrap: true },
                  { key: "quantity", label: "Διαθέσιμο", numeric: true, sortable: true },
                  { key: "cost", label: "Μέσο κόστος", numeric: true, sortable: true },
                  { key: "value", label: "Αξία", numeric: true, sortable: true },
                ]}
                rows={overview.rows.map((row) => {
                  const unit = stockDisplayUnit(row.baseUnit);
                  const cost = row.unitCostHundredths > 0 ? formatStockValue(stockUnitCostHundredths(row.unitCostHundredths, unit.toBase, row.baseUnit.dimension)) : null;
                  return {
                    id: `${row.warehouseId}-${row.genericItemId}`,
                    cells: {
                      item: ctx.can("items.read") ? <Link href={`/items/${row.genericItemId}`} className="font-semibold leading-snug underline-offset-2 hover:underline">{row.itemName}</Link> : <span className="font-semibold">{row.itemName}</span>,
                      warehouse: row.warehouseName,
                      quantity: <span className="whitespace-nowrap font-semibold">{formatStockQuantity(row.quantity, row.baseUnit.dimension)}</span>,
                      cost: cost ? <span className="whitespace-nowrap">{cost} <span className="text-xs text-muted-foreground">/ {unit.code}</span></span> : "—",
                      value: row.unitCostHundredths > 0 ? <span className="whitespace-nowrap">{formatStockValue(row.valueHundredths)}</span> : "—",
                    },
                    details: {
                      label: `${row.itemName} · ${row.warehouseName}`,
                      view: <div className="grid gap-4">
                        <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                          <div><dt className="text-xs text-muted-foreground">Είδος</dt><dd className="mt-1 font-semibold break-words">{row.itemName}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Αποθήκη</dt><dd className="mt-1 font-semibold">{row.warehouseName}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Πραγματικό on-hand</dt><dd className="mt-1 font-semibold tabular-nums">{formatStockQuantity(row.quantity, row.baseUnit.dimension)}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Μονάδα εμφάνισης κόστους</dt><dd className="mt-1 font-semibold">{unit.code}</dd></div>
                        </DetailGrid>
                        <div className="flex flex-wrap gap-2"><Link href={href("lots", row.itemName, row.warehouseId)} className={btn("outline", "sm")}><Layers3 /> Παρτίδες & λήξεις</Link>{ctx.can("items.read") ? <Link href={`/items/${row.genericItemId}`} className={btn("outline", "sm")}>Καρτέλα είδους</Link> : null}</div>
                      </div>,
                    },
                  };
                })}
              />
            </Card>
            <p className="text-xs text-muted-foreground">Το διαθέσιμο ισούται με το on-hand. Δεν εμφανίζεται δεσμευμένη ποσότητα επειδή δεν υπάρχει ακόμη μοντέλο δεσμεύσεων. Η αποτίμηση χρησιμοποιεί το τρέχον μέσο σταθμισμένο κόστος· «—» σημαίνει ότι δεν έχει καταχωριστεί κόστος.</p>
          </>
        ) : null}

        {lots ? (
          <Card className="overflow-hidden">
            <div className="px-4 pt-4"><h2 className="text-lg font-semibold">Ανοιχτές παρτίδες με σειρά FEFO</h2><p className="text-sm text-muted-foreground">Νωρίτερη λήξη πρώτη · παρτίδες χωρίς λήξη τελευταίες · μηδενικά υπόλοιπα εξαιρούνται</p></div>
            <DataTable
              id="stock-lots"
              listing={{ ...list, total, placeholder: "Είδος ή αριθμός παρτίδας…", params: { view: "lots" }, filters: [warehouseFilter] }}
              empty="Δεν βρέθηκαν ανοιχτές παρτίδες με θετικό υπόλοιπο."
              columns={[
                { key: "batch", label: "Παρτίδα", required: true, sortable: true, wrap: true },
                { key: "item", label: "Είδος", sortable: true, wrap: true },
                { key: "warehouse", label: "Αποθήκη", sortable: true, wrap: true },
                { key: "quantity", label: "Υπόλοιπο", numeric: true, sortable: true },
                { key: "expiresAt", label: "Λήξη", sortable: true },
                { key: "status", label: "Κατάσταση" },
              ]}
              rows={lots.rows.map((row) => ({
                id: row.lotId,
                cells: {
                  batch: <Link href={`/inventory/stock/lots/${row.lotId}`} className="font-semibold tabular-nums underline-offset-2 hover:underline">{row.batchNumber ?? "(χύμα)"}</Link>,
                  item: row.itemName,
                  warehouse: row.warehouseName,
                  quantity: <span className="whitespace-nowrap font-semibold">{formatStockQuantity(row.quantity, row.baseUnit.dimension)}</span>,
                  expiresAt: <span className="whitespace-nowrap">{row.expiresAt ? day.format(row.expiresAt) : "—"}</span>,
                  status: <ExpiryBadge expiresAt={row.expiresAt} />,
                },
                details: {
                  label: `${row.batchNumber ?? "(χύμα)"} · ${row.itemName}`,
                  view: <div className="grid gap-4">
                    <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-xs text-muted-foreground">Παρτίδα</dt><dd className="mt-1 font-semibold break-words">{row.batchNumber ?? "(χύμα)"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Υπόλοιπο</dt><dd className="mt-1 font-semibold tabular-nums">{formatStockQuantity(row.quantity, row.baseUnit.dimension)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Λήξη</dt><dd className="mt-1 font-semibold">{row.expiresAt ? day.format(row.expiresAt) : "Χωρίς λήξη"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Σειρά κατανάλωσης</dt><dd className="mt-1"><ExpiryBadge expiresAt={row.expiresAt} /></dd></div>
                    </DetailGrid>
                    <div><Link href={`/inventory/stock/lots/${row.lotId}`} className={btn("outline", "sm")}>Προέλευση & κινήσεις παρτίδας</Link></div>
                  </div>,
                },
              }))}
            />
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
