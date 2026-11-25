import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { Badge, btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { scopedStockLot } from "@/lib/stock-read";
import { stockBalance } from "@/lib/stock-db";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { expiryStatus, formatStockQuantity } from "@/lib/stock-view";

const th = "px-4 py-3 text-left text-xs font-semibold whitespace-nowrap text-muted-foreground";
const td = "border-t border-border/70 px-4 py-3 align-middle";
const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });
const time = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
const SOURCE: Record<string, string> = { purchase: "Αγορά", production: "Παραγωγή", manual: "Διόρθωση", sale: "Πώληση", transfer: "Μεταφορά", count: "Απογραφή" };

/** Scoped, read-only ιχνηλασιμότητα παρτίδας για χρήστες stock.read. */
export default async function StockLotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStockContext("stock.read");
  const warehouses = await db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true } });
  const lot = await scopedStockLot(db, { orgId: ctx.orgId, warehouseIds: warehouses.map((item) => item.id), lotId: id });
  if (!lot) notFound();

  const [bySource, consumedIn, history, remaining] = await Promise.all([
    db.stockMovement.groupBy({ by: ["source"], where: { orgId: ctx.orgId, warehouseId: lot.warehouseId, lotId: lot.id }, _sum: { quantity: true } }),
    db.productionBatchItem.findMany({
      where: { orgId: ctx.orgId, lotId: lot.id },
      orderBy: { batch: { producedAt: "desc" } },
      take: 100,
      include: { batch: { select: { id: true, batchNumber: true, producedAt: true, quantityGrams: true, recipe: { select: { name: true } } } } },
    }),
    db.stockMovement.findMany({ where: { orgId: ctx.orgId, warehouseId: lot.warehouseId, lotId: lot.id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 50 }),
    stockBalance(db, { orgId: ctx.orgId, warehouseId: lot.warehouseId, genericItemId: lot.genericItemId, lotId: lot.id }),
  ]);
  const intake = bySource.reduce((sum, row) => sum + Math.max(0, row._sum.quantity ?? 0), 0);
  const consumed = Math.max(0, intake - remaining);
  const expiry = expiryStatus(lot.expiresAt);
  const quantity = (value: number) => formatStockQuantity(value, lot.genericItem.baseUnit.dimension);

  return (
    <Page
      section="Αποθήκη & αγορές"
      title={`Παρτίδα ${lot.batchNumber ?? "(χύμα)"} — ${lot.genericItem.name}`}
      description={`${lot.warehouse.name} · προέλευση, καταναλώσεις και κινήσεις με tenant/warehouse scope`}
      actions={<Link href="/inventory/stock?view=lots" className={btn("outline", "sm")}><ArrowLeft /> Παρτίδες & FEFO</Link>}
    >
      <div className="grid max-w-7xl gap-4">
        {expiry.status === "expired" ? <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"><TriangleAlert className="size-4" /> Η παρτίδα έληξε πριν από {-expiry.days!} ημέρες. Το υπόλοιπο πρέπει να αποσυρθεί με αιτιολογημένη ενέργεια.</p> : expiry.status === "today" || expiry.status === "urgent" || expiry.status === "soon" ? <p role="status" className="flex items-center gap-2 rounded-lg bg-warning/15 px-4 py-3 text-sm font-medium text-warning-ink"><TriangleAlert className="size-4" /> {expiry.status === "today" ? "Λήγει σήμερα" : `Λήγει σε ${expiry.days} ημέρες`} · προτεραιοποιείται από τη FEFO.</p> : null}

        <Card>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Συνολική είσοδος</dt><dd className="mt-1 font-semibold tabular-nums">{quantity(intake)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Κατανάλωση / έξοδος</dt><dd className="mt-1 font-semibold tabular-nums">{quantity(consumed)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Τρέχον υπόλοιπο</dt><dd className="mt-1 font-semibold tabular-nums">{quantity(remaining)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Λήξη</dt><dd className="mt-1 font-semibold">{lot.expiresAt ? day.format(lot.expiresAt) : "Χωρίς λήξη"}</dd></div>
          </dl>
        </Card>

        <Card className="px-5 py-4">
          <h2 className="text-lg">Προέλευση</h2>
          {lot.document ? (
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3 text-sm">
              <dl className="grid flex-1 gap-4 sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">Προμηθευτής</dt><dd className="mt-1 font-medium">{lot.document.supplier.name}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Παραστατικό</dt><dd className="mt-1 font-medium">{lot.document.number ?? "Χωρίς αριθμό"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Ημερομηνία</dt><dd className="mt-1 font-medium">{lot.document.issuedAt ? day.format(lot.document.issuedAt) : "—"}</dd></div>
              </dl>
              {ctx.can("purchases.read") ? <Link href={`/purchases/${lot.document.id}`} className={btn("outline", "sm")}>Τιμολόγιο αγοράς</Link> : null}
            </div>
          ) : <p className="mt-2 text-sm text-muted-foreground">Χωρίς συνδεδεμένο τιμολόγιο αγοράς · η προέλευση τεκμηριώνεται από τις κινήσεις.</p>}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border/70 px-4 py-4"><h2 className="text-lg">Καταναλώσεις σε παραγωγή</h2><p className="text-sm text-muted-foreground">Οι 100 πιο πρόσφατες συνδέσεις προορισμού της παρτίδας</p></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <thead className="bg-secondary/35"><tr><th className={th} scope="col">Παραγωγή</th><th className={th} scope="col">Συνταγή</th><th className={th} scope="col">Ημερομηνία</th><th className={`${th} text-right`} scope="col">Ποσότητα από παρτίδα</th></tr></thead>
              <tbody>{consumedIn.map((item) => <tr key={item.id}><td className={`${td} font-semibold`}>{ctx.can("production.read") ? <Link href={`/production/${item.batch.id}`} className="underline-offset-2 hover:underline">{item.batch.batchNumber}</Link> : item.batch.batchNumber}</td><td className={td}>{item.batch.recipe.name}</td><td className={td}>{day.format(item.batch.producedAt)}</td><td className={`${td} text-right tabular-nums`}>{quantity(item.quantity)}</td></tr>)}</tbody>
            </table>
          </div>
          {!consumedIn.length ? <p className="px-4 pb-5 text-sm text-muted-foreground">Δεν έχει καταναλωθεί σε παραγωγή.</p> : null}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border/70 px-4 py-4"><h2 className="text-lg">Κινήσεις παρτίδας</h2><p className="text-sm text-muted-foreground">Append-only ιστορικό · οι 50 πιο πρόσφατες εγγραφές</p></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] border-collapse text-sm">
              <thead className="bg-secondary/35"><tr><th className={th} scope="col">Ημερομηνία</th><th className={th} scope="col">Τύπος</th><th className={`${th} text-right`} scope="col">Ποσότητα</th><th className={th} scope="col">Αιτιολογία</th><th className={th} scope="col">Χρήστης</th></tr></thead>
              <tbody>{history.map((movement) => <tr key={movement.id}><td className={`${td} whitespace-nowrap tabular-nums`}>{time.format(movement.occurredAt)}</td><td className={td}><Badge tone={movement.source === "manual" ? "warning" : movement.source === "purchase" ? "success" : "neutral"}>{SOURCE[movement.source] ?? movement.source}</Badge></td><td className={`${td} text-right font-medium tabular-nums ${movement.quantity < 0 ? "text-destructive" : "text-success-ink"}`}>{movement.quantity > 0 ? "+" : "−"}{quantity(Math.abs(movement.quantity))}</td><td className={td}>{movement.note ?? "—"}</td><td className={td}>{movement.createdByName ?? "—"}</td></tr>)}</tbody>
            </table>
          </div>
          {!history.length ? <p className="px-4 pb-5 text-sm text-muted-foreground">Καμία κίνηση στην παρτίδα.</p> : null}
        </Card>
      </div>
    </Page>
  );
}
