import Link from "next/link";
import { Eye, Factory, Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Card, Page, btn } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { listParams } from "@/lib/paging";

// Παρτίδες παραγωγής: κάθε κλείσιμο τραβάει FEFO τα υλικά και κρατά πλήρη ιχνηλασιμότητα.
export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const { org, can } = await currentOrg("production.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["batch", "recipe", "warehouse", "quantity", "cost", "producedAt"]);
  const where = {
    orgId: org.id,
    ...(list.q ? { OR: [
      { batchNumber: { contains: list.q, mode: "insensitive" as const } },
      { recipe: { name: { contains: list.q, mode: "insensitive" as const } } },
      { warehouse: { name: { contains: list.q, mode: "insensitive" as const } } },
    ] } : {}),
  };
  const orderBy = list.sort === "batch" ? { batchNumber: list.dir }
    : list.sort === "recipe" ? { recipe: { name: list.dir } }
      : list.sort === "warehouse" ? { warehouse: { name: list.dir } }
        : list.sort === "quantity" ? { quantityGrams: list.dir }
          : list.sort === "cost" ? { costHundredths: list.dir }
            : { producedAt: list.sort === "producedAt" ? list.dir : "desc" as const };
  const [batches, total, recipes, warehouses] = await Promise.all([
    db.productionBatch.findMany({ where, orderBy, skip: list.skip, take: list.take, include: { recipe: { select: { name: true } }, warehouse: { select: { name: true } }, _count: { select: { items: true } } } }),
    db.productionBatch.count({ where }),
    db.recipe.findMany({ where: { orgId: org.id, active: true, items: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true, batchGrams: true } }),
    db.warehouse.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });

  return (
    <Page section="Παραγωγή" title="Παραγωγή" description="Παρτίδες παραγωγής με FEFO κατανάλωση υλικών και ιχνηλασιμότητα"
      actions={can("production.add") && recipes.length && warehouses.length ? <Link href="/production/new" className={btn("default", "sm")}><Plus /> Νέα παραγωγή</Link> : null}>
      <div className="grid gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Η παραγωγή δεν ολοκληρώθηκε: {q.error.slice(0, 300)}</p> : null}
        {!recipes.length ? <p className="rounded-lg bg-gold/15 px-4 py-3 text-sm text-gold-ink">Δεν υπάρχει ενεργή συνταγή με γραμμές — ξεκίνα από τις <Link href="/recipes" className="underline">Συνταγές</Link>.</p> : null}
        <Card>
          <DataTable
            id="production"
            listing={{ ...list, total, placeholder: "Παρτίδα, συνταγή ή αποθήκη…" }}
            empty={<><Factory className="mr-1 inline size-4" /> Καμία παρτίδα ακόμα — το «Κλείσιμο παρτίδας» τραβάει τα υλικά FEFO από την αποθήκη.</>}
            columns={[
              { key: "batch", label: "Παρτίδα", required: true, sortable: true },
              { key: "recipe", label: "Συνταγή", sortable: true },
              { key: "warehouse", label: "Αποθήκη", sortable: true },
              { key: "quantity", label: "Ποσότητα", numeric: true, sortable: true },
              { key: "cost", label: "Κόστος", numeric: true, sortable: true },
              { key: "costKg", label: "Κόστος/kg", numeric: true },
              { key: "producedAt", label: "Ημερομηνία", sortable: true },
            ]}
            rows={batches.map((b) => ({
              id: b.id,
              cells: {
                batch: <Link href={`/production/${b.id}`} className="font-semibold underline-offset-2 hover:underline tabular-nums">{b.batchNumber}</Link>,
                recipe: b.recipe.name,
                warehouse: b.warehouse.name,
                quantity: `${(b.quantityGrams / 1000).toLocaleString("el-GR")} kg`,
                cost: b.costHundredths > 0 ? euro(b.costHundredths / 100) : "—",
                costKg: b.costHundredths > 0 ? euro(Math.round(b.costHundredths / (b.quantityGrams / 1000)) / 100) : "—",
                producedAt: dayFmt.format(b.producedAt),
              },
              details: {
                label: b.batchNumber,
                view: <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Συνταγή</dt><dd className="font-medium">{b.recipe.name}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Αποθήκη</dt><dd className="font-medium">{b.warehouse.name}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Υλικά FEFO</dt><dd className="font-medium tabular-nums">{b._count.items}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Ποσότητα</dt><dd className="font-medium tabular-nums">{(b.quantityGrams / 1000).toLocaleString("el-GR")} kg</dd></div>
                  </dl>
                  <Link href={`/production/${b.id}`} className={btn("outline", "sm")}><Eye /> Πλήρης ιχνηλασιμότητα</Link>
                </div>,
              },
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
