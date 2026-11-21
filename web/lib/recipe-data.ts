// Δεδομένα ειδών για τον επεξεργαστή συνταγών: σύσταση (δική του είδους ή, ελλείψει αυτής,
// της πρώτης συνδεδεμένης συσκευασίας του καταλόγου), κόστος ανά γραμμάριο και βάρος τεμαχίου.
import { db } from "@/lib/db";
import { compositionFromRow } from "@/lib/composition";
import { costPerGramHundredths } from "@/lib/recipe-analysis";
import type { EditorItem } from "@/components/recipe-items-editor";

export async function recipeEditorItems(orgId: string): Promise<EditorItem[]> {
  const generics = await db.genericItem.findMany({
    where: { orgId, active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      avgCostHundredths: true,
      gramsPerPiece: true,
      baseUnit: { select: { code: true, dimension: true, toBase: true } },
      composition: true,
      mappings: { orderBy: { createdAt: "asc" }, select: { tradeItem: { select: { composition: true } } } },
    },
  });
  return generics.map((g) => {
    const row = g.composition ?? g.mappings.find((m) => m.tradeItem.composition)?.tradeItem.composition ?? null;
    return {
      id: g.id,
      name: g.name,
      unitCode: g.baseUnit.code,
      composition: row ? compositionFromRow(row as unknown as Record<string, unknown>) : null,
      costHundredthsPerGram: costPerGramHundredths(g),
      gramsPerPiece: g.gramsPerPiece,
    };
  });
}
