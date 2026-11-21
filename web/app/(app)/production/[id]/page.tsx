import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, btn, Card, Page } from "@/components/ui";
import { FlowGraphView } from "@/components/flow-graph";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { batchTraceGraph } from "@/lib/traceability-graph";
import { formatBaseQty } from "@/lib/units";

// Καρτέλα παρτίδας παραγωγής: ποια υλικά καταναλώθηκαν και από ποια παρτίδα τους (ιχνηλασιμότητα).
export default async function ProductionBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org } = await currentOrg("production.read");
  const { id } = await params;
  const q = await searchParams;
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
    // εμφάνιση στην καθημερινή μονάδα της διάστασης
    const unit = dimension === "mass" ? { code: "kg", dimension, toBase: 1_000_000 } : dimension === "volume" ? { code: "l", dimension, toBase: 1_000 } : { code: "τεμ", dimension, toBase: 1 };
    return formatBaseQty(qty, [unit]);
  };

  // Δεύτερο βήμα μπροστά (Καν. 178/2002 αρ. 18): αν η συνταγή είναι δεμένη με προϊόν βιτρίνας,
  // οι πωλήσεις του προϊόντος από την παραγωγή και μετά είναι το εύρος αναζήτησης σε ανάκληση
  // (η βιτρίνα μπορεί να αναμειγνύει διαδοχικές παρτίδες της ίδιας γεύσης).
  const product = batch.recipe.product;
  const [salesAgg, recentSales] = product
    ? await Promise.all([
        db.saleLine.aggregate({
          where: { productId: product.id, sale: { orgId: org.id, status: "COMPLETED", issuedAt: { gte: batch.producedAt } } },
          _count: true,
          _sum: { quantity: true },
        }),
        db.saleLine.findMany({
          where: { productId: product.id, sale: { orgId: org.id, status: "COMPLETED", issuedAt: { gte: batch.producedAt } } },
          orderBy: { sale: { issuedAt: "desc" } },
          take: 15,
          include: { sale: { select: { id: true, issuedAt: true, series: true, aa: true, store: { select: { name: true } } } } },
        }),
      ])
    : [null, []];

  // Αντίστροφη όψη ιχνηλασιμότητας: από ποιες παρτίδες υλικών τροφοδοτήθηκε η παραγωγή.
  const graph = batchTraceGraph({
    batch: {
      batchNumber: batch.batchNumber,
      recipeName: batch.recipe.name,
      quantityLabel: `${(batch.quantityGrams / 1000).toLocaleString("el-GR")} kg`,
      producedLabel: dayFmt.format(batch.producedAt),
    },
    product: product ? { name: product.name, salesLabel: salesAgg ? `${salesAgg._count.toLocaleString("el-GR")} πωλήσεις έκτοτε` : "" } : null,
    items: batch.items.map((i) => ({
      lotId: i.lotId,
      itemName: i.genericItem.name,
      lotBatchNumber: i.lot?.batchNumber ?? null,
      supplierName: i.lot?.document?.supplier.name ?? null,
      quantityLabel: i.lotId ? fmtQty(i.quantity, i.genericItem.baseUnit.dimension) : null,
    })),
  });

  return (
    <Page
      section="Παραγωγή"
      title={`Παρτίδα ${batch.batchNumber}`}
      description={`${batch.recipe.name} · ${(batch.quantityGrams / 1000).toLocaleString("el-GR")} kg · ${batch.warehouse.name} · ${dayFmt.format(batch.producedAt)}${batch.createdByName ? ` · ${batch.createdByName}` : ""}`}
      actions={
        <Link href="/production" className={btn("outline", "sm")}>
          <ArrowLeft /> Παραγωγή
        </Link>
      }
    >
      <div className="grid max-w-5xl gap-4">
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η παρτίδα έκλεισε — τα υλικά καταναλώθηκαν FEFO από την αποθήκη</p> : null}

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Από πού ήρθαν τα υλικά</h2>
            <p className="text-sm text-muted-foreground">Παρτίδες υλικών που τροφοδότησαν την παραγωγή — κλικ σε κόμβο για την καρτέλα ιχνηλασιμότητας</p>
          </div>
          <FlowGraphView graph={graph} />
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Κατανάλωση υλικών</h2>
              <p className="text-sm text-muted-foreground">
                Συνολικό κόστος {batch.costHundredths > 0 ? euro(batch.costHundredths / 100) : "—"}
                {batch.note ? ` · ${batch.note}` : ""}
              </p>
            </div>
            {batch.costHundredths > 0 ? <Badge tone="neutral">{euro(Math.round(batch.costHundredths / (batch.quantityGrams / 1000)) / 100)} / kg</Badge> : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2 font-semibold">Υλικό</th>
                  <th className="px-3 py-2 text-right font-semibold">Συνταγή (g)</th>
                  <th className="px-3 py-2 text-right font-semibold">Κατανάλωση</th>
                  <th className="px-3 py-2 font-semibold">Παρτίδα υλικού</th>
                  <th className="px-3 py-2 font-semibold">Προμηθευτής</th>
                  <th className="px-3 py-2 font-semibold">Λήξη</th>
                  <th className="px-5 py-2 text-right font-semibold">Κόστος</th>
                </tr>
              </thead>
              <tbody>
                {batch.items.map((i) => (
                  <tr key={i.id} className="border-t border-border/70">
                    <td className="px-5 py-2 font-medium">
                      <Link href={`/items/${i.genericItemId}`} className="hover:underline">{i.genericItem.name}</Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.grams.toLocaleString("el-GR")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.lotId ? fmtQty(i.quantity, i.genericItem.baseUnit.dimension) : <span className="text-muted-foreground">χωρίς απόθεμα</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{i.lot?.batchNumber ?? (i.lotId ? "(χύμα)" : "—")}</td>
                    <td className="px-3 py-2">{i.lot?.document ? `${i.lot.document.supplier.name}${i.lot.document.number ? ` · ${i.lot.document.number}` : ""}` : "—"}</td>
                    <td className="px-3 py-2">{i.lot?.expiresAt ? dayFmt.format(i.lot.expiresAt) : "—"}</td>
                    <td className="px-5 py-2 text-right tabular-nums">{i.costHundredths > 0 ? euro(i.costHundredths / 100) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {product ? (
          <Card>
            <div className="border-b border-border/70 px-5 py-4">
              <h2 className="text-lg">Πούληση στη βιτρίνα</h2>
              <p className="text-sm text-muted-foreground">
                Πωλήσεις «{product.name}» από {dayFmt.format(batch.producedAt)} και μετά
                {salesAgg ? ` — ${salesAgg._count.toLocaleString("el-GR")} αποδείξεις · ${(salesAgg._sum.quantity ?? 0).toLocaleString("el-GR")} τεμάχια` : ""}
              </p>
            </div>
            {recentSales.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-5 py-2 font-semibold">Απόδειξη</th>
                      <th className="px-3 py-2 font-semibold">Κατάστημα</th>
                      <th className="px-3 py-2 font-semibold">Ώρα</th>
                      <th className="px-5 py-2 text-right font-semibold">Τεμάχια</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSales.map((l) => (
                      <tr key={l.id} className="border-t border-border/70">
                        <td className="px-5 py-2 font-medium">
                          <Link href={`/receipts/${l.sale.id}`} className="hover:underline tabular-nums">
                            {l.sale.series ?? ""}{l.sale.aa != null ? `-${l.sale.aa}` : l.sale.id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{l.sale.store.name}</td>
                        <td className="px-3 py-2">{l.sale.issuedAt ? timeFmt.format(l.sale.issuedAt) : "—"}</td>
                        <td className="px-5 py-2 text-right tabular-nums">{l.quantity.toLocaleString("el-GR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {salesAgg && salesAgg._count > recentSales.length ? (
                  <p className="border-t border-border/70 px-5 py-2 text-xs text-muted-foreground">Εμφανίζονται οι {recentSales.length} πιο πρόσφατες από {salesAgg._count.toLocaleString("el-GR")} πωλήσεις</p>
                ) : null}
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">Δεν έχει πουληθεί ακόμη από αυτή τη γεύση μετά την παραγωγή</p>
            )}
            <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">
              Σε ανάκληση, το εύρος αυτό είναι ενδεικτικό: η βιτρίνα μπορεί να αναμειγνύει διαδοχικές παρτίδες της ίδιας γεύσης.
            </p>
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
