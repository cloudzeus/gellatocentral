import Link from "next/link";
import { Boxes, Layers3, PackageSearch } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Badge, btn, Card, DetailGrid, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { expiryStatus, formatStockQuantity } from "@/lib/stock-view";

const date = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });
const ALLERGENS: Record<string, string> = { milk: "Γάλα", eggs: "Αυγά", nuts: "Ξηροί καρποί", peanuts: "Φιστίκια", gluten: "Γλουτένη", soy: "Σόγια", sesame: "Σουσάμι", celery: "Σέλινο", mustard: "Σινάπι", fish: "Ψάρι", crustaceans: "Οστρακοειδή", molluscs: "Μαλάκια", lupin: "Λούπινο", sulphites: "Θειώδη" };

// Συγκεντρωτική, μόνο-για-ανάγνωση Α΄ υλών. Η επεξεργασία μένει στις υπάρχουσες καρτέλες ειδών.
export default async function MaterialsPage({ searchParams }: PageProps<"/materials">) {
  const q = await searchParams;
  const warehouse = typeof q.warehouse === "string" ? q.warehouse : "";
  const status = filterParam(q, "status", ["active", "hidden", "low", "expiring"]);
  const list = listParams(q, 50, ["name", "stock"] as const);
  const ctx = await requireStockContext("items.read", { warehouseId: warehouse || undefined });
  const warehouses = await db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true, name: true, active: true }, orderBy: { name: "asc" } });
  const warehouseIds = warehouse ? [warehouse] : warehouses.map((row) => row.id);
  const where = {
    orgId: ctx.orgId,
    ...(list.q ? { name: { contains: list.q, mode: "insensitive" as const } } : {}),
    ...(status === "active" ? { active: true } : status === "hidden" ? { active: false } : {}),
  };
  const [items, total, movements, thresholds] = await Promise.all([
    db.genericItem.findMany({
      where,
      include: {
        baseUnit: true,
        composition: true,
        mappings: { include: { tradeItem: { include: { brand: true, supplierItems: { where: { active: true }, include: { supplier: { select: { id: true, name: true } } } } } } } },
      },
      orderBy: { name: list.dir },
    }),
    db.genericItem.count({ where }),
    warehouseIds.length ? db.stockMovement.groupBy({ by: ["genericItemId"], where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, genericItemId: { not: null } }, _sum: { quantity: true } }) : Promise.resolve([]),
    warehouseIds.length ? db.stockThreshold.findMany({ where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds } } }) : Promise.resolve([]),
  ]);
  const balances = new Map(movements.map((row) => [row.genericItemId!, row._sum.quantity ?? 0]));
  const minimums = new Map<string, number>();
  for (const row of thresholds) minimums.set(row.genericItemId, (minimums.get(row.genericItemId) ?? 0) + row.minimumQty);
  const lots = items.length && warehouseIds.length ? await db.stockLot.findMany({
    where: { orgId: ctx.orgId, warehouseId: { in: warehouseIds }, genericItemId: { in: items.map((row) => row.id) } },
    include: { warehouse: { select: { name: true } } },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
  }) : [];
  const lotBalances = lots.length ? await db.stockMovement.groupBy({ by: ["lotId"], where: { orgId: ctx.orgId, lotId: { in: lots.map((row) => row.id) } }, _sum: { quantity: true } }) : [];
  const lotQuantity = new Map(lotBalances.map((row) => [row.lotId!, row._sum.quantity ?? 0]));
  const lotsByItem = new Map<string, typeof lots>();
  for (const lot of lots) {
    if ((lotQuantity.get(lot.id) ?? 0) <= 0) continue;
    const rows = lotsByItem.get(lot.genericItemId) ?? [];
    rows.push(lot); lotsByItem.set(lot.genericItemId, rows);
  }
  let visible = items.map((item) => {
    const quantity = balances.get(item.id) ?? 0;
    const minimum = minimums.get(item.id) ?? 0;
    const itemLots = lotsByItem.get(item.id) ?? [];
    const expiring = itemLots.some((lot) => ["expired", "today", "urgent", "soon"].includes(expiryStatus(lot.expiresAt).status));
    return { item, quantity, minimum, lots: itemLots, low: minimum > 0 && quantity < minimum, expiring };
  });
  if (status === "low") visible = visible.filter((row) => row.low);
  if (status === "expiring") visible = visible.filter((row) => row.expiring);
  if (list.sort === "stock") visible.sort((a, b) => (a.quantity - b.quantity) * (list.dir === "asc" ? 1 : -1));
  const pageRows = visible.slice(list.skip, list.skip + list.take);

  return (
    <Page section="Συνταγολόγιο" title="Α΄ Ύλες" description="Συστατικά, συσκευασίες προμηθευτών, πραγματικό απόθεμα και λήξεις στο επιτρεπόμενο warehouse scope"
      actions={<div className="flex flex-wrap gap-2"><Link href="/items" className={btn("outline", "sm")}><Boxes /> Γενικά είδη</Link>{ctx.can("stock.read") ? <Link href="/inventory/stock" className={btn("outline", "sm")}><Layers3 /> Απόθεμα</Link> : null}</div>}>
      <div className="grid max-w-[90rem] gap-4">
        <Card className="overflow-hidden">
          <DataTable
            id="materials"
            listing={{ ...list, total: status === "low" || status === "expiring" ? visible.length : total, placeholder: "Αναζήτηση Α΄ ύλης…", filters: [
              { key: "warehouse", label: "Αποθήκη", value: warehouse, options: warehouses.map((row): [string, string] => [row.id, `${row.name}${row.active ? "" : " (ανενεργή)"}`]) },
              { key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργά"], ["hidden", "Κρυφά"], ["low", "Κάτω από το όριο"], ["expiring", "Λήξεις έως 14 ημέρες"]] },
            ] }}
            empty="Δεν βρέθηκαν Α΄ ύλες με αυτά τα φίλτρα."
            columns={[
              { key: "name", label: "Α΄ ύλη", required: true, sortable: true, wrap: true },
              { key: "stock", label: "Απόθεμα / όριο", numeric: true, sortable: true },
              { key: "packaging", label: "Συσκευασίες & προμηθευτές", wrap: true },
              { key: "allergens", label: "Σύνθεση & αλλεργιογόνα", wrap: true },
              { key: "lots", label: "Παρτίδες / λήξεις", wrap: true },
            ]}
            rows={pageRows.map(({ item, quantity, minimum, lots: itemLots, low }) => {
              const packages = item.mappings.flatMap((mapping) => mapping.tradeItem.supplierItems.map((supplierItem) => ({ supplier: supplierItem.supplier, trade: mapping.tradeItem, packQty: supplierItem.packQty })));
              const allergens = [...new Set([...(item.composition?.allergensContains ?? []), ...(item.composition?.allergensTraces ?? [])])];
              return {
                id: item.id,
                cells: {
                  name: <div><Link href={`/items/${item.id}`} className="font-semibold underline-offset-2 hover:underline">{item.name}</Link><p className="mt-1 text-xs text-muted-foreground">{item.baseUnit.nameEL} · {item.active ? "ενεργό" : "κρυφό"}</p></div>,
                  stock: <div className="whitespace-nowrap"><span className="font-semibold">{formatStockQuantity(quantity, item.baseUnit.dimension)}</span>{minimum ? <p className={`mt-1 text-xs ${low ? "font-medium text-destructive" : "text-muted-foreground"}`}>όριο {formatStockQuantity(minimum, item.baseUnit.dimension)}</p> : null}{low ? <div className="mt-1"><Badge tone="danger">Έλλειψη</Badge></div> : null}</div>,
                  packaging: packages.length ? <div className="grid max-w-md gap-1 text-xs">{packages.slice(0, 4).map((row, index) => <p key={`${row.trade.id}-${row.supplier.id}-${index}`}><span className="font-medium">{row.supplier.name}</span> · {row.trade.brand?.name ? `${row.trade.brand.name} ` : ""}{row.trade.name}{row.packQty > 1 ? ` · ${row.packQty} συσκ.` : ""}</p>)}{packages.length > 4 ? <p className="text-muted-foreground">+ {packages.length - 4} ακόμη</p> : null}</div> : <span className="text-muted-foreground">Χωρίς σύνδεση</span>,
                  allergens: <div className="max-w-xs"><p className="text-xs text-muted-foreground">{item.composition?.ingredientsText || "Δεν έχει καταχωριστεί τεκμηρίωση σύνθεσης."}</p>{allergens.length ? <div className="mt-2 flex flex-wrap gap-1">{allergens.map((key) => <Badge key={key} tone="warning">{ALLERGENS[key] ?? key}</Badge>)}</div> : null}</div>,
                  lots: itemLots.length ? <div className="grid max-w-xs gap-1 text-xs">{itemLots.slice(0, 4).map((lot) => { const expiry = expiryStatus(lot.expiresAt); return <p key={lot.id}><span className="font-medium">{lot.batchNumber ?? "(χύμα)"}</span> · {formatStockQuantity(lotQuantity.get(lot.id) ?? 0, item.baseUnit.dimension)}<br /><span className={["expired", "today", "urgent", "soon"].includes(expiry.status) ? "text-destructive" : "text-muted-foreground"}>{lot.expiresAt ? date.format(lot.expiresAt) : "Χωρίς λήξη"} · {lot.warehouse.name}</span></p>; })}{itemLots.length > 4 ? <p>+ {itemLots.length - 4} ακόμη</p> : null}</div> : <span className="text-muted-foreground">Καμία ανοιχτή παρτίδα</span>,
                },
                details: {
                  label: item.name,
                  view: <div className="grid gap-4"><DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                    <div><dt>Πραγματικό on-hand</dt><dd>{formatStockQuantity(quantity, item.baseUnit.dimension)}</dd></div>
                    <div><dt>Συνολικό ελάχιστο όριο</dt><dd>{minimum ? formatStockQuantity(minimum, item.baseUnit.dimension) : "Χωρίς όριο"}</dd></div>
                    <div><dt>Συνδεδεμένες συσκευασίες</dt><dd>{item.mappings.length}</dd></div>
                    <div><dt>Ανοιχτές παρτίδες</dt><dd>{itemLots.length}</dd></div>
                  </DetailGrid><div className="flex flex-wrap gap-2"><Link href={`/items/${item.id}`} className={btn("outline", "sm")}><PackageSearch /> Καρτέλα & επεξεργασία</Link>{ctx.can("stock.read") ? <Link href={`/inventory/stock?q=${encodeURIComponent(item.name)}${warehouse ? `&warehouse=${encodeURIComponent(warehouse)}` : ""}`} className={btn("outline", "sm")}><Layers3 /> Κινήσεις αποθέματος</Link> : null}</div></div>,
                },
              };
            })}
          />
        </Card>
        <p className="text-xs text-muted-foreground">Τα υπόλοιπα αθροίζουν μόνο τις κινήσεις των αποθηκών που επιτρέπει η ιδιότητα μέλους. Τα κενή λήξης δεν θεωρούνται επείγουσα παρτίδα.</p>
      </div>
    </Page>
  );
}
