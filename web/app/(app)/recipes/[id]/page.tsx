import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Factory, Pencil, Printer } from "lucide-react";
import { Modal } from "@/components/modal";
import { RecipeAnalysisPanel } from "@/components/recipe-analysis-panel";
import { RecipeItemsEditor } from "@/components/recipe-items-editor";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { RECIPE_TYPES, analyzeRecipe } from "@/lib/recipe-analysis";
import { recipeEditorItems } from "@/lib/recipe-data";
import { saveRecipe, saveRecipeItems, toggleRecipe } from "../actions";

// Καρτέλα συνταγής: αποθηκευμένη ανάλυση (server) και επεξεργαστής γραμμών με ζωντανό preview,
// αναζήτηση είδους και drag & drop ταξινόμηση.
export default async function RecipePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, can } = await currentOrg("recipes.read");
  const { id } = await params;
  const q = await searchParams;
  const [recipe, items, products, outputItems] = await Promise.all([
    db.recipe.findFirst({ where: { id, orgId: org.id }, include: { items: { orderBy: { sortOrder: "asc" } }, product: { select: { name: true } } } }),
    recipeEditorItems(org.id),
    db.product.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.genericItem.findMany({ where: { orgId: org.id, active: true, trackStock: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!recipe) notFound();
  const productOptions: [string, string][] = [["", "— Χωρίς σύνδεση —"], ...products.map((p): [string, string] => [p.id, p.name])];
  const outputOptions: [string, string][] = [["", "— Χωρίς παραγόμενο απόθεμα —"], ...outputItems.map((item): [string, string] => [item.id, item.name])];
  const byId = new Map(items.map((i) => [i.id, i]));
  const savedAnalysis = analyzeRecipe(
    recipe.items.map((l) => {
      const item = byId.get(l.genericItemId);
      return { grams: l.grams, material: { ...(item?.composition ?? {}), costHundredthsPerGram: item?.costHundredthsPerGram ?? 0 } };
    }),
    recipe.type,
  );

  return (
    <Page
      section="Συνταγολόγιο"
      title={recipe.name}
      description={`${RECIPE_TYPES.find((t) => t.value === recipe.type)?.label ?? recipe.type} · δόση ${recipe.batchGrams.toLocaleString("el-GR")} g${recipe.product ? ` · βιτρίνα: ${recipe.product.name}` : ""}${recipe.notes ? ` · ${recipe.notes}` : ""}`}
      actions={
        <div className="flex gap-2">
          <Link href="/recipes" className={btn("outline", "sm")}>
            <ArrowLeft /> Συνταγές
          </Link>
          {recipe.items.length ? <Link href={`/print/recipes/${recipe.id}`} target="_blank" className={btn("outline", "sm")}><Printer /> Τεχνικό δελτίο</Link> : null}
          {can("production.add") && recipe.active && recipe.items.length ? (
            <Link href="/production" className={btn("outline", "sm")}>
              <Factory /> Παραγωγή
            </Link>
          ) : null}
          {can("recipes.edit") ? (
            <>
              <Modal label={<><Pencil /> Στοιχεία</>} size="sm" title={`Στοιχεία: ${recipe.name}`}>
                <form action={saveRecipe} className="grid gap-4 [&>button]:justify-self-end">
                  <input type="hidden" name="recipeId" value={recipe.id} />
                  <Field label="Όνομα" name="name" required minLength={2} maxLength={80} defaultValue={recipe.name} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select label="Τύπος" name="type" defaultValue={recipe.type} options={RECIPE_TYPES.map((t): [string, string] => [t.value, t.label])} />
                    <Field label="Μέγεθος δόσης (g)" name="batchGrams" required inputMode="numeric" defaultValue={String(recipe.batchGrams)} />
                  </div>
                  <Select label="Προϊόν βιτρίνας" name="productId" defaultValue={recipe.productId ?? ""} options={productOptions} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select label="Παραγόμενο είδος αποθέματος" name="outputGenericItemId" defaultValue={recipe.outputGenericItemId ?? ""} options={outputOptions} />
                    <Field label="Διάρκεια ζωής (ημέρες)" name="shelfLifeDays" type="number" min={1} max={3650} step={1} defaultValue={recipe.shelfLifeDays ?? ""} />
                  </div>
                  <Field label="Σημειώσεις" name="notes" maxLength={500} defaultValue={recipe.notes ?? ""} />
                  <Submit className={btn("default")}>Αποθήκευση</Submit>
                </form>
              </Modal>
              <form action={toggleRecipe.bind(null, recipe.id)}>
                <Submit className={btn("ghost", "sm")}>{recipe.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit>
              </form>
            </>
          ) : null}
        </div>
      }
    >
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η συνταγή αποθηκεύτηκε</p> : null}
        {!recipe.active ? <p role="status" className="rounded-lg bg-gold/15 px-4 py-3 text-sm font-medium text-gold-ink">Η συνταγή είναι κρυφή — δεν προσφέρεται για παραγωγή</p> : null}

        {recipe.items.length ? (
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg">Αποθηκευμένη ανάλυση</h2>
                <p className="text-sm text-muted-foreground">Σύνολο {savedAnalysis.totalWeight.toLocaleString("el-GR")} g · στόχοι τύπου «{RECIPE_TYPES.find((t) => t.value === recipe.type)?.label ?? recipe.type}»</p>
              </div>
              {can("recipes.edit") ? null : <Badge>Μόνο προβολή</Badge>}
            </div>
            <div className="px-5 py-4">
              <RecipeAnalysisPanel analysis={savedAnalysis} recipeType={recipe.type} />
            </div>
          </Card>
        ) : null}

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Γραμμές συνταγής</h2>
              <p className="text-sm text-muted-foreground">Ποσότητες σε γραμμάρια · σύρε τη λαβή για αλλαγή σειράς · η ανάλυση ενημερώνεται ζωντανά</p>
            </div>
          </div>
          <div className="px-5 py-4">
            {can("recipes.edit") ? (
              <RecipeItemsEditor
                items={items}
                initialLines={recipe.items.map((l) => ({ key: l.id, genericItemId: l.genericItemId, grams: l.grams }))}
                recipeType={recipe.type}
                action={saveRecipeItems}
                recipeId={recipe.id}
              />
            ) : (
              <ul className="grid gap-1 text-sm">
                {recipe.items.map((l) => (
                  <li key={l.id} className="flex justify-between border-b border-border/50 py-1.5 last:border-0">
                    <span>{byId.get(l.genericItemId)?.name ?? "—"}</span>
                    <span className="tabular-nums">{l.grams.toLocaleString("el-GR")} g</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
