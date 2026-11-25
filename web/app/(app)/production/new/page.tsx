import Link from "next/link";
import { ArrowLeft, Factory } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Submit } from "@/components/submit";
import { DetailGrid, Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { requireStockContext } from "@/lib/stock-context";
import { warehouseScopeWhere } from "@/lib/stock-scope";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { listParams } from "@/lib/paging";
import { ProductionError, planProduction } from "@/lib/production-db";
import { formatBaseQty } from "@/lib/units";
import { createBatch } from "../actions";

// Server-driven FEFO προεπισκόπηση: ο ίδιος σχεδιασμός χρησιμοποιείται και στο κλείσιμο.
export default async function NewProductionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireStockContext("production.add");
  const q = await searchParams;
  const [recipes, warehouses, generics] = await Promise.all([
    db.recipe.findMany({ where: { orgId: ctx.orgId, active: true, items: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true, batchGrams: true, outputGenericItemId: true } }),
    db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });
  const fmtQty = (qty: number, dimension: string) =>
    formatBaseQty(qty, [dimension === "mass" ? { code: "kg", dimension, toBase: 1_000_000 } : dimension === "volume" ? { code: "l", dimension, toBase: 1_000 } : { code: "τεμ", dimension, toBase: 1 }]);

  const recipeId = typeof q.recipeId === "string" ? q.recipeId : "";
  const warehouseId = typeof q.warehouseId === "string" ? q.warehouseId : "";
  const quantityGrams = Math.round(Number(String(typeof q.quantityGrams === "string" ? q.quantityGrams : "").replace(",", ".")));
  const list = listParams(q, 50, ["item", "grams", "lot", "supplier", "expiry", "quantity"]);

  let plan: Awaited<ReturnType<typeof planProduction>> | null = null;
  let planError: string | null = null;
  if (recipeId && warehouseId && Number.isInteger(quantityGrams) && quantityGrams > 0) {
    try {
      await requireStockContext("production.add", { warehouseId });
      plan = await planProduction(db, ctx.orgId, recipeId, warehouseId, quantityGrams);
    } catch (e) {
      planError = e instanceof ProductionError ? e.message : "Άγνωστο σφάλμα σχεδιασμού";
    }
  }

  type PreviewRow = { id: string; item: string; grams: number; dimension: string; lot: string; supplier: string; expiry: string; expiryAt: number; quantity: number | null; quantityLabel: string; note: string; blocked: boolean };
  const previewRows = (plan?.lines ?? []).flatMap<PreviewRow>((l) => {
    const base = { item: l.name, grams: l.grams, dimension: l.dimension };
    if (!l.trackStock) return [{ ...base, id: l.genericItemId, lot: "—", supplier: "—", expiry: "—", expiryAt: 0, quantity: null, quantityLabel: "—", note: "Χωρίς απόθεμα — κοστολογείται μόνο", blocked: false }];
    if (l.shortfall > 0) return [{ ...base, id: l.genericItemId, lot: "—", supplier: "—", expiry: "—", expiryAt: 0, quantity: l.quantity, quantityLabel: fmtQty(l.quantity, l.dimension), note: `Λείπουν ${l.shortfall.toLocaleString("el-GR")} ${l.unitCode}`, blocked: true }];
    return (l.allocations ?? []).map((a) => ({
      ...base,
      id: `${l.genericItemId}-${a.lotId}`,
      lot: a.lot.batchNumber ?? "(χύμα)",
      supplier: `${a.lot.supplierName ?? "—"}${a.lot.docNumber ? ` · ${a.lot.docNumber}` : ""}`,
      expiry: a.lot.expiresAt ? dayFmt.format(a.lot.expiresAt) : "—",
      expiryAt: a.lot.expiresAt?.getTime() ?? 0,
      quantity: a.qty,
      quantityLabel: fmtQty(a.qty, l.dimension),
      note: a.lot.supplierName ?? "Χωρίς προμηθευτή",
      blocked: false,
    }));
  });
  const sort = list.sort;
  if (sort) previewRows.sort((a, b) => {
    const av = sort === "quantity" ? a.quantity : sort === "expiry" ? a.expiryAt : a[sort];
    const bv = sort === "quantity" ? b.quantity : sort === "expiry" ? b.expiryAt : b[sort];
    const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
    return list.dir === "asc" ? result : -result;
  });

  return (
    <Page section="Παραγωγή" title="Νέα παρτίδα παραγωγής" description="Διάλεξε συνταγή και ποσότητα — η προεπισκόπηση δείχνει ακριβώς ποιες παρτίδες θα καταναλωθούν"
      actions={<Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παραγωγή</Link>}>
      <div className="grid max-w-7xl gap-4">
        {!recipes.length ? (
          <p className="rounded-lg bg-warning/15 px-4 py-3 text-sm text-warning-ink">Δεν υπάρχει ενεργή συνταγή με γραμμές — ξεκίνα από τις <Link href="/recipes" className="underline">Συνταγές</Link>.</p>
        ) : (
          <Card>
            <form method="get" action="/production/new" className="grid gap-4 px-5 py-4 sm:grid-cols-4">
              <Select label="Συνταγή" name="recipeId" defaultValue={recipeId || recipes[0]!.id} options={recipes.map((r): [string, string] => [r.id, r.name])} />
              <Select label="Αποθήκη υλικών" name="warehouseId" defaultValue={warehouseId || warehouses[0]?.id || ""} options={warehouses.map((w): [string, string] => [w.id, w.name])} />
              <Field label="Ποσότητα (g)" name="quantityGrams" required inputMode="numeric" defaultValue={String(quantityGrams > 0 ? quantityGrams : recipes.find((r) => r.id === recipeId)?.batchGrams ?? recipes[0]!.batchGrams)} />
              <div className="flex items-end"><Submit className={btn("outline")}>Προεπισκόπηση</Submit></div>
            </form>
          </Card>
        )}

        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Η παραγωγή δεν ολοκληρώθηκε: {q.error.slice(0, 300)}</p> : null}
        {planError ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{planError}</p> : null}

        {plan ? (
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg">Προεπισκόπηση κατανάλωσης</h2>
                <p className="text-sm text-muted-foreground">{plan.recipe.name} · {(plan.quantityGrams / 1000).toLocaleString("el-GR")} kg · {plan.warehouse.name} · κόστος {plan.costHundredths > 0 ? euro(plan.costHundredths / 100) : "—"}</p>
              </div>
              {plan.blocked ? <Badge tone="danger">Ανεπαρκές απόθεμα</Badge> : <Badge tone="success">Έτοιμο προς κλείσιμο</Badge>}
            </div>
            <DataTable
              id="production-preview"
              listing={{ ...list, total: previewRows.length, placeholder: "Υλικό ή παρτίδα…", showSearch: false, params: { recipeId, warehouseId, quantityGrams: String(quantityGrams) } }}
              empty="Καμία κατανάλωση υλικών"
              columns={[
                { key: "item", label: "Υλικό", required: true, sortable: true },
                { key: "grams", label: "Συνταγή (g)", numeric: true, sortable: true },
                { key: "lot", label: "Παρτίδα υλικού", sortable: true },
                { key: "supplier", label: "Προμηθευτής", sortable: true },
                { key: "expiry", label: "Λήξη", sortable: true },
                { key: "quantity", label: "Ποσότητα", numeric: true, sortable: true },
              ]}
              rows={previewRows.map((r) => ({
                id: r.id,
                cells: {
                  item: <span className={r.blocked ? "font-semibold text-destructive" : "font-semibold"}>{r.item}</span>,
                  grams: r.grams.toLocaleString("el-GR"),
                  lot: r.lot,
                  supplier: r.supplier,
                  expiry: r.expiry,
                  quantity: r.quantityLabel,
                },
                details: {
                  label: `${r.item} · ${r.lot}`,
                  view: <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Υλικό</dt><dd className="font-medium">{r.item}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Παρτίδα</dt><dd className="font-medium">{r.lot}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Ποσότητα</dt><dd className="font-medium">{r.quantityLabel}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Κατάσταση</dt><dd className={r.blocked ? "font-medium text-destructive" : "font-medium"}>{r.note}</dd></div>
                  </DetailGrid>,
                },
              }))}
            />
            <form action={createBatch} className="grid items-end gap-3 border-t border-border/70 px-5 py-4 md:grid-cols-3">
              <input type="hidden" name="recipeId" value={plan.recipe.id} />
              <input type="hidden" name="warehouseId" value={plan.warehouse.id} />
              <input type="hidden" name="quantityGrams" value={plan.quantityGrams} />
              <Select label="Αποθήκη output" name="destinationWarehouseId" defaultValue={plan.warehouse.id} options={warehouses.map((row): [string, string] => [row.id, row.name])} />
              <Select label="Παραγόμενο είδος" name="outputGenericItemId" defaultValue={plan.recipe.outputGenericItemId ?? ""} options={[["", "Χωρίς απόθεμα output (παλιή συμπεριφορά)"], ...generics.map((row): [string, string] => [row.id, row.name])]} />
              <Field label="Πραγματική ποσότητα (g)" name="actualQuantityGrams" type="number" min={1} max={plan.quantityGrams} defaultValue={plan.quantityGrams} required />
              <Field label="Αιτιολογία φύρας" name="scrapReason" maxLength={300} hint="Υποχρεωτική όταν η απόδοση είναι μικρότερη" />
              <Field label="Εργασία (λεπτά)" name="labourMinutes" type="number" min={0} defaultValue={0} />
              <Field label="Εργατικό κόστος €" name="labourCost" inputMode="decimal" defaultValue="0" />
              <Field label="Αριθμός παρτίδας" name="batchNumber" maxLength={80} hint="Κενό = αυτόματος (YYYYMMDD-N)" />
              <Field label="Σημείωση" name="note" maxLength={500} hint="π.χ. «πρωινή βάρδια»" />
              <div className="flex items-end">
                {plan.blocked ? <span className="text-sm text-muted-foreground">Συμπλήρωσε απόθεμα για να κλείσει</span> : <Submit className={btn("default")}><Factory /> Κλείσιμο παρτίδας</Submit>}
              </div>
            </form>
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
