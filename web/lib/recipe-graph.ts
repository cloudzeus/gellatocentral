// Αναδρομική ανάλυση συνταγών σε πρώτες ύλες. Καθαρή λογική με ακέραια γραμμάρια και cycle guard.
export type RecipeGraphNode = {
  id: string;
  name: string;
  batchGrams: number;
  outputGenericItemId?: string | null;
  shelfLifeDays?: number | null;
  active?: boolean;
  items: readonly { genericItemId: string; grams: number; sortOrder?: number }[];
};

export type ExpandedRecipeLine = { genericItemId: string; grams: number; viaRecipeIds: string[] };

export function expandRecipe(
  recipes: readonly RecipeGraphNode[],
  rootRecipeId: string,
  quantityGrams: number,
  leafGenericItemIds: readonly string[] = [],
): { root: RecipeGraphNode; lines: ExpandedRecipeLine[]; snapshot: Record<string, unknown> } {
  const leaves = new Set(leafGenericItemIds);
  if (!Number.isSafeInteger(quantityGrams) || quantityGrams < 1) throw new Error("Η ποσότητα παραγωγής είναι θετικός ακέραιος");
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const byOutput = new Map(recipes.filter((recipe) => recipe.active !== false && recipe.outputGenericItemId).map((recipe) => [recipe.outputGenericItemId!, recipe]));
  const root = byId.get(rootRecipeId);
  if (!root || root.active === false) throw new Error("Η συνταγή δεν βρέθηκε ή είναι κρυφή");
  if (!root.items.length) throw new Error("Η συνταγή δεν έχει γραμμές");
  const totals = new Map<string, { grams: number; viaRecipeIds: Set<string> }>();
  let visitedNodes = 0;

  function visit(recipe: RecipeGraphNode, grams: number, path: readonly string[]) {
    if (path.includes(recipe.id)) throw new Error(`Κυκλική αναφορά συνταγών: ${[...path, recipe.id].map((id) => byId.get(id)?.name ?? id).join(" → ")}`);
    if (path.length >= 32 || ++visitedNodes > 1000) throw new Error("Η ανάλυση συνταγών υπερβαίνει το ασφαλές όριο");
    if (!Number.isSafeInteger(recipe.batchGrams) || recipe.batchGrams < 1) throw new Error(`Η συνταγή «${recipe.name}» έχει άκυρη δόση`);
    for (const item of [...recipe.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      if (!Number.isSafeInteger(item.grams) || item.grams < 1) throw new Error(`Η συνταγή «${recipe.name}» έχει άκυρη γραμμή`);
      const required = Math.max(1, Math.round(item.grams * grams / recipe.batchGrams));
      if (!Number.isSafeInteger(required)) throw new Error("Η ποσότητα συνταγής υπερβαίνει το ασφαλές όριο");
      const child = byOutput.get(item.genericItemId);
      if (child && child.id !== recipe.id && !leaves.has(item.genericItemId)) {
        visit(child, required, [...path, recipe.id]);
      } else {
        if (!leaves.has(item.genericItemId) && (child?.id === recipe.id || path.includes(child?.id ?? ""))) throw new Error(`Κυκλική αναφορά στη συνταγή «${recipe.name}»`);
        const current = totals.get(item.genericItemId) ?? { grams: 0, viaRecipeIds: new Set<string>() };
        current.grams += required;
        if (!Number.isSafeInteger(current.grams)) throw new Error("Το άθροισμα υλικών υπερβαίνει το ασφαλές όριο");
        path.forEach((id) => current.viaRecipeIds.add(id));
        current.viaRecipeIds.add(recipe.id);
        totals.set(item.genericItemId, current);
      }
    }
  }

  visit(root, quantityGrams, []);
  if (!totals.size) throw new Error("Η ανάλυση δεν παράγει γραμμές πρώτων υλών");
  const lines = [...totals].map(([genericItemId, value]) => ({ genericItemId, grams: value.grams, viaRecipeIds: [...value.viaRecipeIds] }));
  return {
    root,
    lines,
    snapshot: {
      recipe: { id: root.id, name: root.name, batchGrams: root.batchGrams, outputGenericItemId: root.outputGenericItemId ?? null, shelfLifeDays: root.shelfLifeDays ?? null },
      quantityGrams,
      nodes: recipes.filter((recipe) => lines.some((line) => line.viaRecipeIds.includes(recipe.id)) || recipe.id === root.id).map((recipe) => ({ id: recipe.id, name: recipe.name, batchGrams: recipe.batchGrams, outputGenericItemId: recipe.outputGenericItemId ?? null, items: recipe.items })),
      expandedLines: lines,
    },
  };
}
