import Link from "next/link";
import { ChefHat, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { RECIPE_TYPES, analyzeRecipe } from "@/lib/recipe-analysis";
import { recipeEditorItems } from "@/lib/recipe-data";
import { saveRecipe } from "./actions";

// Συνταγές παγωτού: λίστα με τύπο, πλήθος υλικών και κόστος/kg (από το μέσο κόστος των ειδών).
export default async function RecipesPage({ searchParams }: PageProps<"/recipes">) {
  const { org, can } = await currentOrg("recipes.read");
  const q = await searchParams;
  const [recipes, items, products] = await Promise.all([
    db.recipe.findMany({ where: { orgId: org.id }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { items: { include: { genericItem: true } }, product: { select: { name: true } } } }),
    recipeEditorItems(org.id),
    db.product.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const productOptions: [string, string][] = [["", "— Χωρίς σύνδεση —"], ...products.map((p): [string, string] => [p.id, p.name])];

  return (
    <Page
      section="Συνταγολόγιο"
      title="Συνταγές"
      description="Βάσεις και γεύσεις παγωτού με τεχνική ανάλυση (PAC/POD, στερεά, σημείο πήξης) και κόστος"
      actions={
        can("recipes.add") ? (
          <Modal label={<><Plus /> Νέα συνταγή</>} size="sm" title="Νέα συνταγή">
            <form action={saveRecipe} className="grid gap-4 [&>button]:justify-self-end">
              <Field label="Όνομα" name="name" required minLength={2} maxLength={80} hint="π.χ. Βάση γάλακτος, Κακάο βαρυπέννητο" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Τύπος" name="type" options={RECIPE_TYPES.map((t): [string, string] => [t.value, t.label])} />
                <Field label="Μέγεθος δόσης (g)" name="batchGrams" required inputMode="numeric" defaultValue="5000" hint="Τυπική παραγωγή, για κοστολόγηση" />
              </div>
              <Select label="Προϊόν βιτρίνας" name="productId" options={productOptions} />
              <Submit className={btn("default")}>Δημιουργία</Submit>
            </form>
          </Modal>
        ) : null
      }
    >
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η συνταγή αποθηκεύτηκε</p> : null}

        <Card>
          {recipes.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-semibold">Συνταγή</th>
                    <th className="px-3 py-2 font-semibold">Τύπος</th>
                    <th className="px-3 py-2 font-semibold">Βιτρίνα</th>
                    <th className="px-3 py-2 text-right font-semibold">Υλικά</th>
                    <th className="px-3 py-2 text-right font-semibold">Κόστος / kg</th>
                    <th className="px-5 py-2 font-semibold">Κατάσταση</th>
                  </tr>
                </thead>
                <tbody>
                  {recipes.map((r) => {
                    const analysis = analyzeRecipe(
                      r.items.map((l) => {
                        const item = byId.get(l.genericItemId);
                        return { grams: l.grams, material: { ...(item?.composition ?? {}), costHundredthsPerGram: item?.costHundredthsPerGram ?? 0 } };
                      }),
                      r.type,
                    );
                    return (
                      <tr key={r.id} className={cn("border-t border-border/70", r.active ? "" : "text-muted-foreground")}>
                        <td className="px-5 py-2 font-medium">
                          <Link href={`/recipes/${r.id}`} className="hover:underline">{r.name}</Link>
                        </td>
                        <td className="px-3 py-2">{RECIPE_TYPES.find((t) => t.value === r.type)?.label ?? r.type}</td>
                        <td className="px-3 py-2">{r.product?.name ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.items.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{analysis.costPerKgHundredths > 0 ? euro(analysis.costPerKgHundredths / 100) : "—"}</td>
                        <td className="px-5 py-2">{r.active ? <Badge tone="success">Ενεργή</Badge> : <Badge>Κρυφή</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              <ChefHat className="mr-1 inline size-4" /> Καμία συνταγή ακόμα — ξεκίνα με «Νέα συνταγή». Τα είδη της συνταγής είναι τα
              <Link href="/items" className="underline"> γενικά είδη</Link> με τη σύστασή τους.
            </p>
          )}
        </Card>
      </div>
    </Page>
  );
}
