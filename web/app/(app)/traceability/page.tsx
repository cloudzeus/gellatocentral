import Link from "next/link";
import { ScanSearch, Search } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";

// Ιχνηλασιμότητα (Καν. 178/2002 άρ. 18 — ΕΦΕΤ): αναζήτηση με αριθμό παρτίδας υλικού ή
// παρτίδας παραγωγής. Από την παρτίδα υλικού βλέπεις που πήγε (παραγωγές)· από την παρτίδα
// παραγωγής βλέπεις από πού ήρθε (προμηθευτές, τιμολόγια, λήξεις).
export default async function TraceabilityPage({ searchParams }: PageProps<"/traceability">) {
  const { org } = await currentOrg("production.read");
  const q = await searchParams;
  const term = typeof q.q === "string" ? q.q.trim() : "";
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });

  const [lots, batches] = term
    ? await Promise.all([
        db.stockLot.findMany({
          where: { orgId: org.id, batchNumber: { contains: term, mode: "insensitive" } },
          include: { genericItem: { select: { name: true } }, warehouse: { select: { name: true } }, document: { select: { number: true, supplier: { select: { name: true } } } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        db.productionBatch.findMany({
          where: { orgId: org.id, batchNumber: { contains: term, mode: "insensitive" } },
          include: { recipe: { select: { name: true } } },
          orderBy: { producedAt: "desc" },
          take: 50,
        }),
      ])
    : [[], []];

  return (
    <Page section="Παραγωγή" title="Ιχνηλασιμότητα" description="Αριθμός παρτίδας υλικού ή παραγωγής — προέλευση και προορισμός σε ένα βήμα (Καν. 178/2002 αρ. 18)">
      <div className="grid max-w-5xl gap-4">
        <Card>
          <form method="get" action="/traceability" className="flex flex-wrap items-end gap-3 px-5 py-4">
            <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
              Αριθμός παρτίδας
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input name="q" defaultValue={term} placeholder="π.χ. L24105 ή 20261120-1" className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm" />
              </span>
            </label>
            <Submit className={btn("default")}>Αναζήτηση</Submit>
          </form>
        </Card>

        {term ? (
          <>
            <Card>
              <div className="border-b border-border/70 px-5 py-4">
                <h2 className="text-lg">Παρτίδες υλικών</h2>
                <p className="text-sm text-muted-foreground">{lots.length ? `${lots.length} αποτελέσματα` : "Καμία παρτίδα υλικού"} για «{term}»</p>
              </div>
              {lots.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-5 py-2 font-semibold">Παρτίδα</th>
                        <th className="px-3 py-2 font-semibold">Υλικό</th>
                        <th className="px-3 py-2 font-semibold">Προμηθευτής</th>
                        <th className="px-3 py-2 font-semibold">Αποθήκη</th>
                        <th className="px-5 py-2 font-semibold">Λήξη</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lots.map((l) => (
                        <tr key={l.id} className="border-t border-border/70">
                          <td className="px-5 py-2 font-medium">
                            <Link href={`/traceability/lot/${l.id}`} className="hover:underline tabular-nums">{l.batchNumber}</Link>
                          </td>
                          <td className="px-3 py-2">{l.genericItem.name}</td>
                          <td className="px-3 py-2">{l.document ? `${l.document.supplier.name}${l.document.number ? ` · ${l.document.number}` : ""}` : "—"}</td>
                          <td className="px-3 py-2">{l.warehouse.name}</td>
                          <td className="px-5 py-2">
                            {l.expiresAt ? dayFmt.format(l.expiresAt) : "—"}
                            {l.expiresAt && l.expiresAt.getTime() < Date.now() ? <> <Badge tone="danger">Έληξε</Badge></> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Card>

            <Card>
              <div className="border-b border-border/70 px-5 py-4">
                <h2 className="text-lg">Παρτίδες παραγωγής</h2>
                <p className="text-sm text-muted-foreground">{batches.length ? `${batches.length} αποτελέσματα` : "Καμία παρτίδα παραγωγής"} για «{term}»</p>
              </div>
              {batches.length ? (
                <ul className="divide-y divide-border/70">
                  {batches.map((b) => (
                    <li key={b.id}>
                      <Link href={`/production/${b.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-secondary/50">
                        <span className="font-medium tabular-nums">{b.batchNumber}</span>
                        <span className="flex-1 text-sm text-muted-foreground">{b.recipe.name} · {(b.quantityGrams / 1000).toLocaleString("el-GR")} kg</span>
                        <span className="text-sm text-muted-foreground">{dayFmt.format(b.producedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </>
        ) : (
          <p className="px-1 text-sm text-muted-foreground">
            <ScanSearch className="mr-1 inline size-4" /> Γράψε αριθμό παρτίδας (από το τιμολόγιο/την ετικέτα υλικού ή της παραγωγής) — η αναζήτηση είναι μερική και χωρίς διάκριση πεζών.
          </p>
        )}
      </div>
    </Page>
  );
}
