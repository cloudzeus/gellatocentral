import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FlowGraphView } from "@/components/flow-graph";
import { Submit } from "@/components/submit";
import { DetailGrid, Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { requireStockContext } from "@/lib/stock-context";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { listParams } from "@/lib/paging";
import { batchTraceGraph } from "@/lib/traceability-graph";
import { formatBaseQty } from "@/lib/units";
import { correctBatch } from "../actions";
import { changeLotHold, checkOutputLot } from "../workflow-actions";

// Καρτέλα παρτίδας παραγωγής: υλικά, προέλευση και πωλήσεις βιτρίνας.
export default async function ProductionBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireStockContext("production.read");
  const { id } = await params;
  const q = await searchParams;
  const list = listParams(q, 50, ["item", "grams", "quantity", "lot", "supplier", "expiry", "cost", "receipt", "store", "time", "pieces"]);
  const batch = await db.productionBatch.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      recipe: { select: { id: true, name: true, productId: true, product: { select: { id: true, name: true } } } },
      warehouse: { select: { name: true } },
      items: { orderBy: { grams: "desc" }, include: { genericItem: { include: { baseUnit: true } }, lot: { select: { batchNumber: true, expiresAt: true, document: { select: { number: true, supplier: { select: { name: true } } } } } } } },
    },
  });
  if (!batch) notFound();
  await requireStockContext("production.read", { warehouseIds: [batch.warehouseId, batch.destinationWarehouseId ?? batch.warehouseId] });
  const [outputLot, lotChecks, corrections] = await Promise.all([
    batch.outputLotId ? db.stockLot.findFirst({ where: { id: batch.outputLotId, orgId: ctx.orgId }, include: { genericItem: { include: { baseUnit: true } } } }) : null,
    batch.outputLotId ? db.haccpLotCheck.findMany({ where: { orgId: ctx.orgId, lotId: batch.outputLotId }, orderBy: { createdAt: "desc" }, take: 20 }) : [],
    db.productionCorrection.findMany({ where: { orgId: ctx.orgId, batchId: batch.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });
  const timeFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
  const fmtQty = (qty: number, dimension: string) => {
    const unit = dimension === "mass" ? { code: "kg", dimension, toBase: 1_000_000 } : dimension === "volume" ? { code: "l", dimension, toBase: 1_000 } : { code: "τεμ", dimension, toBase: 1 };
    return formatBaseQty(qty, [unit]);
  };

  const product = batch.recipe.product;
  const [salesAgg, recentSales] = product
    ? await Promise.all([
        db.saleLine.aggregate({ where: { productId: product.id, sale: { orgId: ctx.orgId, status: "COMPLETED", issuedAt: { gte: batch.producedAt } } }, _count: true, _sum: { quantity: true } }),
        db.saleLine.findMany({ where: { productId: product.id, sale: { orgId: ctx.orgId, status: "COMPLETED", issuedAt: { gte: batch.producedAt } } }, orderBy: { sale: { issuedAt: "desc" } }, take: 15, include: { sale: { select: { id: true, issuedAt: true, series: true, aa: true, store: { select: { name: true } } } } } }),
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
      actions={<div className="flex gap-2"><Link href={`/print/production/${batch.id}`} target="_blank" className={btn("outline", "sm")}><Printer /> Ετικέτα</Link><Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παραγωγή</Link></div>}>
      <div className="grid max-w-7xl gap-4">
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η παρτίδα έκλεισε — τα υλικά καταναλώθηκαν FEFO από την αποθήκη</p> : null}
        {q.corrected ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η ποσότητα output διορθώθηκε με append-only κίνηση</p> : null}
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{q.error}</p> : null}

        <Card className="p-4"><DetailGrid className="sm:grid-cols-2 lg:grid-cols-5"><div><dt>Αναμενόμενη</dt><dd>{((batch.expectedQuantityGrams ?? batch.quantityGrams) / 1000).toLocaleString("el-GR")} kg</dd></div><div><dt>Πραγματική</dt><dd>{(batch.quantityGrams / 1000).toLocaleString("el-GR")} kg</dd></div><div><dt>Φύρα</dt><dd>{batch.wasteGrams.toLocaleString("el-GR")} g</dd></div><div><dt>Εργασία</dt><dd>{batch.labourMinutes} λεπτά · {euro(batch.labourCostCents)}</dd></div><div><dt>Output lot</dt><dd>{outputLot ? <Badge tone={outputLot.holdStatus === "HELD" || outputLot.holdStatus === "REJECTED" ? "danger" : "success"}>{outputLot.holdStatus}</Badge> : "Χωρίς απόθεμα"}</dd></div></DetailGrid>{batch.scrapReason ? <p className="mt-3 text-sm text-muted-foreground">Αιτιολογία: {batch.scrapReason}</p> : null}</Card>

        {outputLot ? <div className="grid gap-4 lg:grid-cols-2">
          {ctx.can("production.add") ? <Card className="p-4"><h2 className="mb-3 font-semibold">Διόρθωση μόνο του output</h2><p className="mb-3 text-xs text-muted-foreground">Δεν ξαναεκτελούνται αναλώσεις υλικών. Κάθε αλλαγή κλειδώνει την προηγούμενη τιμή και καταγράφεται.</p><form action={correctBatch} className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]"><input type="hidden" name="batchId" value={batch.id} /><Field label="Νέα ποσότητα g" name="correctedQuantityGrams" type="number" min={1} defaultValue={batch.quantityGrams} required /><Field label="Αιτιολογία" name="reason" required maxLength={300} /><Submit className={btn("outline")}>Διόρθωση</Submit></form>{corrections.length ? <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">{corrections.map((row) => <li key={row.id}>{row.previousQuantityGrams} → {row.correctedQuantityGrams} g · {row.reason}</li>)}</ul> : null}</Card> : null}
          {ctx.can("haccp.add") ? <Card className="p-4"><h2 className="mb-3 font-semibold">CCP / έλεγχος output lot</h2><form action={checkOutputLot} className="grid items-end gap-2 sm:grid-cols-3"><input type="hidden" name="batchId" value={batch.id} /><input type="hidden" name="lotId" value={outputLot.id} /><Field label="Έλεγχος" name="kind" placeholder="Παστερίωση / ψύξη" required /><Field label="Μέτρηση" name="measuredValue" inputMode="decimal" required /><Field label="Μονάδα" name="unit" placeholder="°C" required /><Field label="Ελάχιστο" name="minimum" inputMode="decimal" /><Field label="Μέγιστο" name="maximum" inputMode="decimal" /><Field label="Σημειώσεις" name="notes" /><div className="sm:col-span-2"><Field label="Διορθωτική ενέργεια (για απόκλιση)" name="correctiveAction" /></div><Submit className={btn("outline")}>Καταγραφή</Submit></form>{lotChecks.length ? <ul className="mt-3 grid gap-1 text-xs">{lotChecks.map((check) => <li key={check.id} className={check.conforming ? "text-success-ink" : "text-destructive"}>{check.kind}: {check.measuredValue ?? "—"} {check.unit} · {check.conforming ? "Εντός" : "Απόκλιση / HOLD"}</li>)}</ul> : null}</Card> : null}
        </div> : null}

        {outputLot && ctx.can("haccp.edit") ? <Card className="p-4"><form action={changeLotHold} className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]"><input type="hidden" name="batchId" value={batch.id} /><input type="hidden" name="lotId" value={outputLot.id} /><Select label="Ποιοτική κατάσταση" name="status" defaultValue={outputLot.holdStatus === "AVAILABLE" ? "HELD" : outputLot.holdStatus} options={[["HELD", "Δέσμευση"], ["RELEASED", "Αποδέσμευση"], ["REJECTED", "Απόρριψη"]]} /><Field label="Αιτιολογία" name="reason" required maxLength={300} /><Submit className={btn("outline")}>Αλλαγή κατάστασης</Submit></form></Card> : null}

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
                view: <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Παρτίδα υλικού</dt><dd className="font-medium">{i.lot?.batchNumber ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Προμηθευτής</dt><dd className="font-medium">{i.lot?.document?.supplier.name ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Κατανάλωση</dt><dd className="font-medium">{i.lotId ? fmtQty(i.quantity, i.genericItem.baseUnit.dimension) : "Χωρίς απόθεμα"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Κόστος</dt><dd className="font-medium">{i.costHundredths > 0 ? euro(i.costHundredths / 100) : "—"}</dd></div>
                </DetailGrid>,
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
