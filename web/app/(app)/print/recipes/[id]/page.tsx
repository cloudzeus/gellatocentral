import { notFound } from "next/navigation";
import { PrintableDocument } from "@/components/printable-document";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyzeRecipe, RECIPE_TYPES, type MaterialComposition } from "@/lib/recipe-analysis";
import { expandRecipe } from "@/lib/recipe-graph";
import { buildVitrineSnapshot } from "@/lib/vitrine";

const ALLERGENS: Record<string, string> = { milk: "Γάλα", eggs: "Αυγά", nuts: "Ξηροί καρποί", peanuts: "Φιστίκια", gluten: "Γλουτένη", soy: "Σόγια", sesame: "Σουσάμι", celery: "Σέλινο", mustard: "Σινάπι", fish: "Ψάρι", crustaceans: "Οστρακοειδή", molluscs: "Μαλάκια", lupin: "Λούπινο", sulphites: "Θειώδη" };
const percentageFields = { fatPm: "fatPct", msnfPm: "msnfPct", sucrosePm: "sucrosePct", dextrosePm: "dextrosePct", glucoseSyrupPm: "glucoseSyrupPct", invertSugarPm: "invertSugarPct", fructosePm: "fructosePct", lactosePm: "lactosePct", cocoaNonfatPm: "cocoaNonfatPct", stabilizerPm: "stabilizerPct", emulsifierPm: "emulsifierPct", saltPm: "saltPct", alcoholPm: "alcoholPct", otherSolidsPm: "otherSolidsPct", proteinAvailablePm: "proteinAvailablePct", otherProteinPm: "otherProteinPct", fiberPm: "fiberPct", pacOverridePm: "pacOverride", podOverridePm: "podOverride", totalSolidsOverridePm: "totalSolidsOverride" } as const;

function composition(input: Record<string, unknown> | null | undefined): MaterialComposition {
  const result: MaterialComposition = { acidityLevel: String(input?.acidityLevel ?? "none"), containsStarch: input?.containsStarch === true, containsCocoa: input?.containsCocoa === true, glucoseDe: typeof input?.glucoseDe === "number" ? input.glucoseDe : null };
  for (const [source, target] of Object.entries(percentageFields)) { const value = input?.[source]; (result as Record<string, unknown>)[target] = typeof value === "number" ? value / 100 : null; }
  return result;
}

export default async function RecipeTechnicalSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { org } = await currentOrg("recipes.read");
  const { id } = await params;
  const recipes = await db.recipe.findMany({ where: { orgId: org.id }, include: { items: { include: { genericItem: { include: { composition: true } } }, orderBy: { sortOrder: "asc" } } } });
  const root = recipes.find((row) => row.id === id);
  if (!root) notFound();
  const expanded = expandRecipe(recipes, root.id, root.batchGrams);
  const byGeneric = new Map(recipes.flatMap((recipe) => recipe.items.map((item) => [item.genericItemId, item.genericItem] as const)));
  const lines = expanded.lines.map((line) => { const generic = byGeneric.get(line.genericItemId)!; const raw = generic.composition as unknown as Record<string, unknown> | null; return { name: generic.name, grams: line.grams, material: composition(raw), composition: generic.composition ? { ...generic.composition, ...composition(raw), name: generic.name } : null }; });
  const analysis = analyzeRecipe(lines, root.type);
  const snapshot = buildVitrineSnapshot({ productName: root.name, recipeName: root.name, batchGrams: root.batchGrams, priceCents: 0, lines });
  return <PrintableDocument org={org} entityType="recipe" entityId={root.id} title={`Τεχνικό δελτίο — ${root.name}`} subtitle={`${RECIPE_TYPES.find((row) => row.value === root.type)?.label ?? root.type} · δόση ${root.batchGrams.toLocaleString("el-GR")} g`}>
    <section><h2>Συστατικά μετά την ανάπτυξη υποσυνταγών</h2><table><thead><tr><th>Α΄ ύλη</th><th>Ποσότητα</th><th>% δόσης</th></tr></thead><tbody>{lines.map((line) => <tr key={line.name}><td>{line.name}</td><td>{line.grams.toLocaleString("el-GR")} g</td><td>{(line.grams * 100 / root.batchGrams).toLocaleString("el-GR", { maximumFractionDigits: 2 })}%</td></tr>)}</tbody></table></section>
    <section><h2>Τεχνική ανάλυση δόσης</h2><dl className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div><dt>Ολικά στερεά</dt><dd>{analysis.totalSolids.toLocaleString("el-GR", { maximumFractionDigits: 2 })}%</dd></div><div><dt>Λιπαρά</dt><dd>{analysis.fat.toLocaleString("el-GR", { maximumFractionDigits: 2 })}%</dd></div><div><dt>Σάκχαρα</dt><dd>{analysis.sugars.toLocaleString("el-GR", { maximumFractionDigits: 2 })}%</dd></div><div><dt>PAC / POD</dt><dd>{analysis.pac.toLocaleString("el-GR", { maximumFractionDigits: 1 })} / {analysis.pod.toLocaleString("el-GR", { maximumFractionDigits: 1 })}</dd></div></dl></section>
    <section><h2>Δήλωση αλλεργιογόνων</h2><p><strong>Περιέχει:</strong> {snapshot.allergensContains.length ? snapshot.allergensContains.map((key) => ALLERGENS[key] ?? key).join(", ") : "Δεν έχει δηλωθεί αλλεργιογόνο στα τεκμηριωμένα συστατικά."}</p>{snapshot.allergensTraces.length ? <p><strong>Μπορεί να περιέχει ίχνη:</strong> {snapshot.allergensTraces.map((key) => ALLERGENS[key] ?? key).join(", ")}</p> : null}<p className="text-xs">Η δήλωση προέρχεται από τα αποθηκευμένα δεδομένα σύνθεσης. Ελέγχεται πριν από κάθε αλλαγή προμηθευτή ή συνταγής.</p></section>
    {root.notes ? <section><h2>Σημειώσεις παραγωγής</h2><p>{root.notes}</p></section> : null}
  </PrintableDocument>;
}
