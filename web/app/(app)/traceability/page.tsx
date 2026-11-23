import Link from "next/link";
import { ScanSearch, Search } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Submit } from "@/components/submit";
import { DetailGrid, Badge, btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { listParams } from "@/lib/paging";
import { isExpired } from "@/lib/production";

// Ιχνηλασιμότητα (Καν. 178/2002 άρ. 18 — ΕΦΕΤ): κοινή αναζήτηση σε παρτίδες υλικού και παραγωγής.
export default async function TraceabilityPage({ searchParams }: PageProps<"/traceability">) {
  const { org } = await currentOrg("production.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["batch", "item", "supplier", "warehouse", "expiry", "recipe", "quantity", "produced"]);
  const term = list.q;
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });
  const direction = list.sort ? list.dir : "desc";
  const lotOrderBy = list.sort === "batch" ? { batchNumber: direction }
    : list.sort === "item" ? { genericItem: { name: direction } }
      : list.sort === "supplier" ? { document: { supplier: { name: direction } } }
        : list.sort === "warehouse" ? { warehouse: { name: direction } }
          : list.sort === "expiry" ? { expiresAt: direction }
            : { createdAt: "desc" as const };
  const batchOrderBy = list.sort === "batch" ? { batchNumber: direction }
    : list.sort === "recipe" ? { recipe: { name: direction } }
      : list.sort === "quantity" ? { quantityGrams: direction }
        : { producedAt: "desc" as const };

  const [lots, batches, lotTotal, batchTotal] = term
    ? await Promise.all([
        db.stockLot.findMany({
          where: { orgId: org.id, batchNumber: { contains: term, mode: "insensitive" } },
          include: { genericItem: { select: { name: true } }, warehouse: { select: { name: true } }, document: { select: { number: true, supplier: { select: { name: true } } } } },
          orderBy: lotOrderBy,
          skip: list.skip,
          take: list.take,
        }),
        db.productionBatch.findMany({
          where: { orgId: org.id, batchNumber: { contains: term, mode: "insensitive" } },
          include: { recipe: { select: { name: true } } },
          orderBy: batchOrderBy,
          skip: list.skip,
          take: list.take,
        }),
        db.stockLot.count({ where: { orgId: org.id, batchNumber: { contains: term, mode: "insensitive" } } }),
        db.productionBatch.count({ where: { orgId: org.id, batchNumber: { contains: term, mode: "insensitive" } } }),
      ])
    : [[], [], 0, 0];

  return (
    <Page section="Παραγωγή" title="Ιχνηλασιμότητα" description="Αριθμός παρτίδας υλικού ή παραγωγής — προέλευση και προορισμός σε ένα βήμα (Καν. 178/2002 αρ. 18)">
      <div className="grid max-w-7xl gap-4">
        <Card>
          <form method="get" action="/traceability" className="flex flex-wrap items-end gap-3 px-5 py-4">
            <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
              Αριθμός παρτίδας
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input name="q" defaultValue={term} placeholder="π.χ. L24105 ή 20261120-1" className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm" />
              </span>
            </label>
            {list.sort ? <><input type="hidden" name="sort" value={list.sort} /><input type="hidden" name="dir" value={list.dir} /></> : null}
            <Submit className={btn("default")}>Αναζήτηση</Submit>
          </form>
        </Card>

        {term ? (
          <>
            <Card>
              <div className="border-b border-border/70 px-5 py-4">
                <h2 className="text-lg">Παρτίδες υλικών</h2>
                <p className="text-sm text-muted-foreground">{lotTotal ? `${lotTotal} αποτελέσματα` : "Καμία παρτίδα υλικού"} για «{term}»</p>
              </div>
              <DataTable
                id="traceability-lots"
                listing={{ ...list, total: lotTotal, placeholder: "Αριθμός παρτίδας…", showSearch: false }}
                empty="Καμία παρτίδα υλικού για αυτή την αναζήτηση"
                columns={[
                  { key: "batch", label: "Παρτίδα", required: true, sortable: true },
                  { key: "item", label: "Υλικό", sortable: true },
                  { key: "supplier", label: "Προμηθευτής", sortable: true },
                  { key: "warehouse", label: "Αποθήκη", sortable: true },
                  { key: "expiry", label: "Λήξη", sortable: true },
                ]}
                rows={lots.map((l) => ({
                  id: l.id,
                  cells: {
                    batch: <Link href={`/traceability/lot/${l.id}`} className="font-semibold tabular-nums underline-offset-2 hover:underline">{l.batchNumber}</Link>,
                    item: l.genericItem.name,
                    supplier: l.document ? `${l.document.supplier.name}${l.document.number ? ` · ${l.document.number}` : ""}` : "—",
                    warehouse: l.warehouse.name,
                    expiry: <span className="inline-flex flex-wrap items-center gap-1">{l.expiresAt ? dayFmt.format(l.expiresAt) : "—"}{isExpired(l.expiresAt) ? <Badge tone="danger">Έληξε</Badge> : null}</span>,
                  },
                  details: {
                    label: l.batchNumber ?? "Παρτίδα χωρίς αριθμό",
                    view: <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-xs text-muted-foreground">Υλικό</dt><dd className="font-medium">{l.genericItem.name}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Προμηθευτής / παραστατικό</dt><dd className="font-medium">{l.document ? `${l.document.supplier.name}${l.document.number ? ` · ${l.document.number}` : ""}` : "—"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Αποθήκη</dt><dd className="font-medium">{l.warehouse.name}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Πλήρης ιχνηλασιμότητα</dt><dd><Link href={`/traceability/lot/${l.id}`} className={btn("outline", "sm")}>Άνοιγμα παρτίδας</Link></dd></div>
                    </DetailGrid>,
                  },
                }))}
              />
            </Card>

            <Card>
              <div className="border-b border-border/70 px-5 py-4">
                <h2 className="text-lg">Παρτίδες παραγωγής</h2>
                <p className="text-sm text-muted-foreground">{batchTotal ? `${batchTotal} αποτελέσματα` : "Καμία παρτίδα παραγωγής"} για «{term}»</p>
              </div>
              <DataTable
                id="traceability-batches"
                listing={{ ...list, total: batchTotal, placeholder: "Αριθμός παρτίδας…", showSearch: false }}
                empty="Καμία παρτίδα παραγωγής για αυτή την αναζήτηση"
                columns={[
                  { key: "batch", label: "Παρτίδα", required: true, sortable: true },
                  { key: "recipe", label: "Συνταγή", sortable: true },
                  { key: "quantity", label: "Ποσότητα", numeric: true, sortable: true },
                  { key: "produced", label: "Παραγωγή", sortable: true },
                ]}
                rows={batches.map((b) => ({
                  id: b.id,
                  cells: {
                    batch: <Link href={`/production/${b.id}`} className="font-semibold tabular-nums underline-offset-2 hover:underline">{b.batchNumber}</Link>,
                    recipe: b.recipe.name,
                    quantity: `${(b.quantityGrams / 1000).toLocaleString("el-GR")} kg`,
                    produced: dayFmt.format(b.producedAt),
                  },
                  details: {
                    label: b.batchNumber,
                    view: <div className="flex flex-wrap items-end justify-between gap-4">
                      <DetailGrid className="flex-1 sm:grid-cols-3">
                        <div><dt className="text-xs text-muted-foreground">Συνταγή</dt><dd className="font-medium">{b.recipe.name}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Ποσότητα</dt><dd className="font-medium">{(b.quantityGrams / 1000).toLocaleString("el-GR")} kg</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Ημερομηνία</dt><dd className="font-medium">{dayFmt.format(b.producedAt)}</dd></div>
                      </DetailGrid>
                      <Link href={`/production/${b.id}`} className={btn("outline", "sm")}>Προέλευση και υλικά</Link>
                    </div>,
                  },
                }))}
              />
            </Card>
          </>
        ) : (
          <p className="px-1 text-sm text-muted-foreground">
            <ScanSearch className="mr-1 inline size-4" /> Γράψε αριθμό παρτίδας από το τιμολόγιο ή την ετικέτα — η αναζήτηση είναι μερική και χωρίς διάκριση πεζών.
          </p>
        )}
      </div>
    </Page>
  );
}
