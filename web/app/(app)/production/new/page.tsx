import Link from "next/link";
import { ArrowLeft, Factory } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { ProductionError, planProduction } from "@/lib/production-db";
import { formatBaseQty } from "@/lib/units";
import { createBatch } from "../actions";

// Νέα παρτίδα παραγωγής με προεπισκόπηση FEFO: ο χρήστης βλέπει ΠΡΙΝ το κλείσιμο ποιες παρτίδες
// υλικών (και από ποιον προμηθευτή) θα καταναλωθούν — το ίδιο είδος μπορεί να τραβηχτεί από
// παρτίδες διαφορετικών προμηθευτών. Server-driven: η φόρμα είναι GET και η προεπισκόπηση
// υπολογίζεται στον server με τον ίδιο σχεδιασμό που εκτελεί και το κλείσιμο.
export default async function NewProductionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org } = await currentOrg("production.add");
  const q = await searchParams;
  const [recipes, warehouses] = await Promise.all([
    db.recipe.findMany({ where: { orgId: org.id, active: true, items: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true, batchGrams: true } }),
    db.warehouse.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });
  // εμφάνιση ποσότητας στην καθημερινή μονάδα της διάστασης (kg / l / τεμ)
  const fmtQty = (qty: number, dimension: string) =>
    formatBaseQty(qty, [dimension === "mass" ? { code: "kg", dimension, toBase: 1_000_000 } : dimension === "volume" ? { code: "l", dimension, toBase: 1_000 } : { code: "τεμ", dimension, toBase: 1 }]);

  const recipeId = typeof q.recipeId === "string" ? q.recipeId : "";
  const warehouseId = typeof q.warehouseId === "string" ? q.warehouseId : "";
  const quantityGrams = Math.round(Number(String(typeof q.quantityGrams === "string" ? q.quantityGrams : "").replace(",", ".")));
  const recipe = recipes.find((r) => r.id === recipeId);

  let plan: Awaited<ReturnType<typeof planProduction>> | null = null;
  let planError: string | null = null;
  if (recipeId && warehouseId && Number.isInteger(quantityGrams) && quantityGrams > 0) {
    try {
      plan = await planProduction(db, org.id, recipeId, warehouseId, quantityGrams);
    } catch (e) {
      planError = e instanceof ProductionError ? e.message : "Άγνωστο σφάλμα σχεδιασμού";
    }
  }

  return (
    <Page
      section="Παραγωγή"
      title="Νέα παρτίδα παραγωγής"
      description="Διάλεξε συνταγή και ποσότητα — η προεπισκόπηση δείχνει ακριβώς ποιες παρτίδες θα καταναλωθούν"
      actions={
        <Link href="/production" className={btn("outline", "sm")}>
          <ArrowLeft /> Παραγωγή
        </Link>
      }
    >
      <div className="grid max-w-5xl gap-4">
        {!recipes.length ? (
          <p className="rounded-lg bg-gold/15 px-4 py-3 text-sm text-gold-ink">
            Δεν υπάρχει ενεργή συνταγή με γραμμές — ξεκίνα από τις <Link href="/recipes" className="underline">Συνταγές</Link>.
          </p>
        ) : (
          <Card>
            <form method="get" action="/production/new" className="grid gap-4 px-5 py-4 sm:grid-cols-4">
              <Select label="Συνταγή" name="recipeId" defaultValue={recipeId || recipes[0]!.id} options={recipes.map((r): [string, string] => [r.id, r.name])} />
              <Select label="Αποθήκη υλικών" name="warehouseId" defaultValue={warehouseId || warehouses[0]?.id || ""} options={warehouses.map((w): [string, string] => [w.id, w.name])} />
              <Field label="Ποσότητα (g)" name="quantityGrams" required inputMode="numeric" defaultValue={String(quantityGrams > 0 ? quantityGrams : recipe?.batchGrams ?? recipes[0]!.batchGrams)} />
              <div className="flex items-end">
                <Submit className={btn("outline")}>Προεπισκόπηση</Submit>
              </div>
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
                <p className="text-sm text-muted-foreground">
                  {plan.recipe.name} · {(plan.quantityGrams / 1000).toLocaleString("el-GR")} kg · {plan.warehouse.name} · κόστος{" "}
                  {plan.costHundredths > 0 ? euro(plan.costHundredths / 100) : "—"}
                </p>
              </div>
              {plan.blocked ? <Badge tone="danger">Ανεπαρκές απόθεμα</Badge> : <Badge tone="success">Έτοιμο προς κλείσιμο</Badge>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-semibold">Υλικό</th>
                    <th className="px-3 py-2 text-right font-semibold">Συνταγή (g)</th>
                    <th className="px-3 py-2 font-semibold">Παρτίδα υλικού</th>
                    <th className="px-3 py-2 font-semibold">Προμηθευτής</th>
                    <th className="px-3 py-2 font-semibold">Λήξη</th>
                    <th className="px-5 py-2 text-right font-semibold">Ποσότητα</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.lines.map((l) =>
                    !l.trackStock ? (
                      <tr key={l.genericItemId} className="border-t border-border/70">
                        <td className="px-5 py-2 font-medium">{l.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.grams.toLocaleString("el-GR")}</td>
                        <td className="px-3 py-2 text-muted-foreground" colSpan={3}>χωρίς απόθεμα — κοστολογείται μόνο</td>
                        <td className="px-5 py-2 text-right tabular-nums">—</td>
                      </tr>
                    ) : l.shortfall > 0 ? (
                      <tr key={l.genericItemId} className="border-t border-border/70 bg-destructive/5">
                        <td className="px-5 py-2 font-medium">{l.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.grams.toLocaleString("el-GR")}</td>
                        <td className="px-3 py-2 text-destructive" colSpan={3}>
                          λείπουν {l.shortfall.toLocaleString("el-GR")} {l.unitCode}
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums">{fmtQty(l.quantity, l.dimension)}</td>
                      </tr>
                    ) : (
                      (l.allocations ?? []).map((a, i) => (
                        <tr key={`${l.genericItemId}-${a.lotId}`} className="border-t border-border/70">
                          <td className="px-5 py-2 font-medium">{i === 0 ? l.name : ""}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{i === 0 ? l.grams.toLocaleString("el-GR") : ""}</td>
                          <td className="px-3 py-2 tabular-nums">{a.lot.batchNumber ?? "(χύμα)"}</td>
                          <td className="px-3 py-2">{a.lot.supplierName ?? "—"}{a.lot.docNumber ? <span className="text-xs text-muted-foreground"> · {a.lot.docNumber}</span> : null}</td>
                          <td className="px-3 py-2">{a.lot.expiresAt ? dayFmt.format(a.lot.expiresAt) : "—"}</td>
                          <td className="px-5 py-2 text-right tabular-nums">{fmtQty(a.qty, l.dimension)}</td>
                        </tr>
                      ))
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <form action={createBatch} className="grid gap-3 border-t border-border/70 px-5 py-4 sm:grid-cols-[1fr_1fr_auto]">
              <input type="hidden" name="recipeId" value={plan.recipe.id} />
              <input type="hidden" name="warehouseId" value={plan.warehouse.id} />
              <input type="hidden" name="quantityGrams" value={plan.quantityGrams} />
              <Field label="Αριθμός παρτίδας" name="batchNumber" maxLength={40} hint="Κενό = αυτόματος (YYYYMMDD-N)" />
              <Field label="Σημείωση" name="note" maxLength={120} hint="π.χ. «πρωινή βάρδια»" />
              <div className="flex items-end">
                {plan.blocked ? (
                  <span className="text-sm text-muted-foreground">Συμπλήρωσε απόθεμα για να κλείσει</span>
                ) : (
                  <Submit className={btn("default")}>
                    <Factory /> Κλείσιμο παρτίδας
                  </Submit>
                )}
              </div>
            </form>
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
