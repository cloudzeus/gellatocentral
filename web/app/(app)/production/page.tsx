import Link from "next/link";
import { Factory, Plus } from "lucide-react";
import { Card, Page, btn } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";

// Παρτίδες παραγωγής: κάθε κλείσιμο τραβάει FEFO τις παρτίδες υλικών από την αποθήκη
// και κρατά πλήρη ιχνηλασιμότητα (ποια παρτίδα υλικού μπήκε σε ποια παρτίδα παγωτού).
export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const { org, can } = await currentOrg("production.read");
  const q = await searchParams;
  const [batches, recipes, warehouses] = await Promise.all([
    db.productionBatch.findMany({
      where: { orgId: org.id },
      orderBy: { producedAt: "desc" },
      take: 100,
      include: { recipe: { select: { name: true } }, warehouse: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    db.recipe.findMany({ where: { orgId: org.id, active: true, items: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true, batchGrams: true } }),
    db.warehouse.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });

  return (
    <Page
      section="Παραγωγή"
      title="Παραγωγή"
      description="Παρτίδες παραγωγής με FEFO κατανάλωση υλικών και ιχνηλασιμότητα"
      actions={
        can("production.add") && recipes.length && warehouses.length ? (
          <Link href="/production/new" className={btn("default", "sm")}>
            <Plus /> Νέα παραγωγή
          </Link>
        ) : null
      }
    >
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Η παραγωγή δεν ολοκληρώθηκε: {q.error.slice(0, 300)}</p> : null}
        {!recipes.length ? (
          <p className="rounded-lg bg-gold/15 px-4 py-3 text-sm text-gold-ink">
            Δεν υπάρχει ενεργή συνταγή με γραμμές — ξεκίνα από τις <Link href="/recipes" className="underline">Συνταγές</Link>.
          </p>
        ) : null}

        <Card>
          {batches.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-semibold">Παρτίδα</th>
                    <th className="px-3 py-2 font-semibold">Συνταγή</th>
                    <th className="px-3 py-2 font-semibold">Αποθήκη</th>
                    <th className="px-3 py-2 text-right font-semibold">Ποσότητα</th>
                    <th className="px-3 py-2 text-right font-semibold">Κόστος</th>
                    <th className="px-3 py-2 text-right font-semibold">Κόστος/kg</th>
                    <th className="px-5 py-2 font-semibold">Ημερομηνία</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-t border-border/70">
                      <td className="px-5 py-2 font-medium">
                        <Link href={`/production/${b.id}`} className="hover:underline tabular-nums">{b.batchNumber}</Link>
                      </td>
                      <td className="px-3 py-2">{b.recipe.name}</td>
                      <td className="px-3 py-2">{b.warehouse.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(b.quantityGrams / 1000).toLocaleString("el-GR")} kg</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.costHundredths > 0 ? euro(b.costHundredths / 100) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.costHundredths > 0 ? euro(Math.round(b.costHundredths / (b.quantityGrams / 1000)) / 100) : "—"}</td>
                      <td className="px-5 py-2">{dayFmt.format(b.producedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              <Factory className="mr-1 inline size-4" /> Καμία παρτίδα ακόμα — το «Κλείσιμο παρτίδας» τραβάει τα υλικά FEFO από την αποθήκη.
            </p>
          )}
        </Card>
      </div>
    </Page>
  );
}
