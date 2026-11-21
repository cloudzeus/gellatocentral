import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FlowGraphView } from "@/components/flow-graph";
import { Badge, btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { listParams } from "@/lib/paging";
import { batchTraceGraph } from "@/lib/traceability-graph";
import { formatBaseQty } from "@/lib/units";

// Καρτέλα παρτίδας παραγωγής: υλικά, προέλευση και πωλήσεις βιτρίνας.
export default async function ProductionBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org } = await currentOrg("production.read");
  const { id } = await params;
  const q = await searchParams;
  const list = listParams(q, 50, ["item", "grams", "quantity", "lot", "supplier", "expiry", "cost", "receipt", "store", "time", "pieces"]);
  const batch = await db.productionBatch.findFirst({
    where: { id, orgId: org.id },
    include: {
      recipe: { select: { id: true, name: true, productId: true, product: { select: { id: true, name: true } } } },
      warehouse: { select: { name: true } },
      items: { orderBy: { grams: "desc" }, include: { genericItem: { include: { baseUnit: true } }, lot: { select: { batchNumber: true, expiresAt: true, document: { select: { number: true, supplier: { select: { name: true } } } } } } } },
    },
  });
  if (!batch) notFound();
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });
  const timeFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
  const fmtQty = (qty: number, dimension: string) => {
    const unit = dimension === "mass" ? { code: "kg", dimension, toBase: 1_000_000 } : dimension === "volume" ? { code: "l", dimension, toBase: 1_000 } : { code: "τεμ", dimension, toBase: 1 };
    return formatBaseQty(qty, [unit]);
  };

  const product = batch.recipe.product;
  const [salesAgg, recentSales] = product
    ? await Promise.all([
        db.saleLine.aggregate({ where: { productId: product.id, sale: { orgId: org.id, status: "COMPLETED", issuedAt: { gte: batch.producedAt } } }, _count: true, _sum: { quantity: true } }),
        db.saleLine.findMany({ where: { productId: product.id, sale: { orgId: org.id, status: "COMPLETED", issuedAt: { gte: batch.producedAt } } }, orderBy: { sale: { issuedAt: "desc" } }, take: 15, include: { sale: { select: { id: true, issuedAt: true, series: true, aa: true, store: { select: { name: true } } } } } }),
      ])
    : [null, []];

  const graph = batchTraceGraph({
    batch: { batchNumber: batch.batchNumber, recipeName: batch.recipe.name, quantityLabel: `${(batch.quantityGrams / 1000).toLocaleString("el-GR")} kg`, producedLabel: dayFmt.format(batch.producedAt) },
    product: product ? { name: product.name, salesLabel: salesAgg ? `${salesAgg._count.toLocaleString("el-GR")} πωλήσεις έκτοτε` : "" } : null,
    items: batch.items.map((i) => ({ lotId: i.lotId, itemName: i.genericItem.name, lotBatchNumber: i.lot?.batchNumber ?? null, supplierName: i.lot?.document?.supplier.name ?? null, quantityLabel: i.lotId ? fmtQty(i.quantity, i.genericItem.baseUnit.dimension) : null })),
  });

  const items = [...batch.items];
  if (list.sort && ["item", "grams", "quantity", "lot", "supplier", "expiry", "cost"].includes(list.sort)) items.sort((a, b) => {
    const value = (i: (typeof items)[number]) => list.sort === "item" ? i.genericItem.name
      : list.sort === "grams" ? i.grams
        : list.sort === "quantity" ? i.quantity
          : list.sort === "lot" ? i.lot?.batchNumber ?? ""
            : list.sort === "supplier" ? i.lot?.document?.supplier.name ?? ""
              : list.sort === "expiry" ? i.lot?.expiresAt?.getTime() ?? 0
                : i.costHundredths;
    const av = value(a), bv = value(b);
    const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
    return list.dir === "asc" ? result : -result;
  });
  const sales = [...recentSales];
  if (list.sort && ["receipt", "store", "time", "pieces"].includes(list.sort)) sales.sort((a, b) => {
    const value = (l: (typeof sales)[number]) => list.sort === "receipt" ? `${l.sale.series ?? ""}${l.sale.aa ?? l.sale.id}`
      : list.sort === "store" ? l.sale.store.name
        : list.sort === "time" ? l.sale.issuedAt?.getTime() ?? 0
          : l.quantity;
    const av = value(a), bv = value(b);
    const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
    return list.dir === "asc" ? result : -result;
  });

  return (
    <Page section="Παραγωγή" title={`Παρτίδα ${batch.batchNumber}`} description={`${batch.recipe.name} · ${(batch.quantityGrams / 1000).toLocaleString("el-GR")} kg · ${batch.warehouse.name} · ${dayFmt.format(batch.producedAt)}${batch.createdByName ? ` · ${batch.createdByName}` : ""}`}
      actions={<Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παραγωγή</Link>}>
      <div className="grid max-w-7xl gap-4">
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η παρτίδα έκλεισε — τα υλικά καταναλώθηκαν FEFO από την αποθήκη</p> : null}

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Από πού ήρθαν τα υλικά</h2><p className="text-sm text-muted-foreground">Παρτίδες υλικών που τροφοδότησαν την παραγωγή — κλικ σε κόμβο για την καρτέλα ιχνηλασιμότητας</p></div>
          <FlowGraphView graph={graph} />
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Κατανάλωση υλικών</h2><p className="text-sm text-muted-foreground">Συνολικό κόστος {batch.costHundredths > 0 ? euro(batch.costHundredths / 100) : "—"}{batch.note ? ` · ${batch.note}` : ""}</p></div>
            {batch.costHundredths > 0 ? <Badge>{euro(Math.round(batch.costHundredths / (batch.quantityGrams / 1000)) / 100)} / kg</Badge> : null}
          </div>
          <DataTable
            id={`production-${batch.id}-items`}
            listing={{ ...list, total: items.length, placeholder: "Υλικό ή παρτίδα…", showSearch: false }}
            empty="Καμία κατανάλωση υλικού"
            columns={[
              { key: "item", label: "Υλικό", required: true, sortable: true },
              { key: "grams", label: "Συνταγή (g)", numeric: true, sortable: true },
              { key: "quantity", label: "Κατανάλωση", numeric: true, sortable: true },
              { key: "lot", label: "Παρτίδα υλικού", sortable: true },
              { key: "supplier", label: "Προμηθευτής", sortable: true },
              { key: "expiry", label: "Λήξη", sortable: true },
              { key: "cost", label: "Κόστος", numeric: true, sortable: true },
            ]}
            rows={items.map((i) => ({
              id: i.id,
              cells: {
                item: <Link href={`/items/${i.genericItemId}`} className="font-semibold underline-offset-2 hover:underline">{i.genericItem.name}</Link>,
                grams: i.grams.toLocaleString("el-GR"),
                quantity: i.lotId ? fmtQty(i.quantity, i.genericItem.baseUnit.dimension) : "χωρίς απόθεμα",
                lot: i.lot?.batchNumber ?? (i.lotId ? "(χύμα)" : "—"),
                supplier: i.lot?.document ? `${i.lot.document.supplier.name}${i.lot.document.number ? ` · ${i.lot.document.number}` : ""}` : "—",
                expiry: i.lot?.expiresAt ? dayFmt.format(i.lot.expiresAt) : "—",
                cost: i.costHundredths > 0 ? euro(i.costHundredths / 100) : "—",
              },
              details: {
                label: i.genericItem.name,
                view: <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Παρτίδα υλικού</dt><dd className="font-medium">{i.lot?.batchNumber ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Προμηθευτής</dt><dd className="font-medium">{i.lot?.document?.supplier.name ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Κατανάλωση</dt><dd className="font-medium">{i.lotId ? fmtQty(i.quantity, i.genericItem.baseUnit.dimension) : "Χωρίς απόθεμα"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Κόστος</dt><dd className="font-medium">{i.costHundredths > 0 ? euro(i.costHundredths / 100) : "—"}</dd></div>
                </dl>,
              },
            }))}
          />
        </Card>

        {product ? (
          <Card>
            <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Πούληση στη βιτρίνα</h2><p className="text-sm text-muted-foreground">Πωλήσεις «{product.name}» από {dayFmt.format(batch.producedAt)} και μετά{salesAgg ? ` — ${salesAgg._count.toLocaleString("el-GR")} αποδείξεις · ${(salesAgg._sum.quantity ?? 0).toLocaleString("el-GR")} τεμάχια` : ""}</p></div>
            <DataTable
              id={`production-${batch.id}-sales`}
              listing={{ ...list, total: sales.length, placeholder: "Απόδειξη ή κατάστημα…", showSearch: false }}
              empty="Δεν έχει πουληθεί ακόμη από αυτή τη γεύση μετά την παραγωγή"
              columns={[
                { key: "receipt", label: "Απόδειξη", required: true, sortable: true },
                { key: "store", label: "Κατάστημα", sortable: true },
                { key: "time", label: "Ώρα", sortable: true },
                { key: "pieces", label: "Τεμάχια", numeric: true, sortable: true },
              ]}
              rows={sales.map((l) => ({
                id: l.id,
                cells: {
                  receipt: <Link href={`/receipts/${l.sale.id}`} className="font-semibold tabular-nums underline-offset-2 hover:underline">{l.sale.series ?? ""}{l.sale.aa != null ? `-${l.sale.aa}` : l.sale.id.slice(0, 8)}</Link>,
                  store: l.sale.store.name,
                  time: l.sale.issuedAt ? timeFmt.format(l.sale.issuedAt) : "—",
                  pieces: l.quantity.toLocaleString("el-GR"),
                },
                details: {
                  label: l.sale.aa != null ? `Απόδειξη ${l.sale.aa}` : "Απόδειξη",
                  view: <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm">{l.sale.store.name} · {l.sale.issuedAt ? timeFmt.format(l.sale.issuedAt) : "—"} · {l.quantity.toLocaleString("el-GR")} τεμάχια</span><Link href={`/receipts/${l.sale.id}`} className={btn("outline", "sm")}>Άνοιγμα απόδειξης</Link></div>,
                },
              }))}
            />
            <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">Σε ανάκληση το εύρος είναι ενδεικτικό: η βιτρίνα μπορεί να αναμειγνύει διαδοχικές παρτίδες της ίδιας γεύσης{salesAgg && salesAgg._count > sales.length ? `. Εμφανίζονται οι ${sales.length} πιο πρόσφατες από ${salesAgg._count.toLocaleString("el-GR")} πωλήσεις` : ""}</p>
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
