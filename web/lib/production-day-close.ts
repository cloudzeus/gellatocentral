// Καθαρός σχεδιασμός ημερήσιου κλεισίματος: demand propagation, stock offset και τοπολογική σειρά.
import type { RecipeGraphNode } from "./recipe-graph";

export type DayClosePlanInput = {
  id: string;
  recipeId: string;
  quantityGrams: number;
  actualQuantityGrams: number;
  scrapReason?: string | null;
  labourMinutes?: number;
  labourCostCents?: number;
  plannedFor?: Date;
};

export type DayCloseStockInput = {
  genericItemId: string;
  baseQuantity: number;
  dimension: string;
  gramsPerPiece?: number | null;
};

export type DayCloseJob = {
  key: string;
  recipeId: string;
  planId: string | null;
  expectedQuantityGrams: number;
  actualQuantityGrams: number;
  scrapReason: string | null;
  labourMinutes: number;
  labourCostCents: number;
  automatic: boolean;
  leafGenericItemIds: string[];
};

export function baseQuantityToGrams(input: { baseQuantity: number; dimension: string; gramsPerPiece?: number | null }): number {
  if (!Number.isSafeInteger(input.baseQuantity) || input.baseQuantity < 0) throw new Error("Άκυρη ποσότητα αποθέματος ημιέτοιμου");
  if (input.dimension === "mass") return Math.floor(input.baseQuantity / 1000);
  if (input.dimension === "volume") return input.baseQuantity;
  if (input.dimension === "count") {
    if (!input.gramsPerPiece || !Number.isSafeInteger(input.gramsPerPiece) || input.gramsPerPiece < 1) throw new Error("Είδος ημιέτοιμου σε τεμάχια χωρίς βάρος τεμαχίου");
    return input.baseQuantity * input.gramsPerPiece;
  }
  throw new Error("Άγνωστη διάσταση ημιέτοιμου είδους");
}

function scaledGrams(itemGrams: number, outputGrams: number, batchGrams: number): number {
  const value = Math.max(1, Math.round(itemGrams * outputGrams / batchGrams));
  if (!Number.isSafeInteger(value)) throw new Error("Η αναγκαία ποσότητα υπερβαίνει το ασφαλές όριο");
  return value;
}

/** Η πρώτη διάσταση είναι parent → child· η εκτέλεση επιστρέφεται child → parent. */
export function prepareProductionDayClose(
  recipes: readonly RecipeGraphNode[],
  plans: readonly DayClosePlanInput[],
  stock: readonly DayCloseStockInput[],
): DayCloseJob[] {
  if (!plans.length) throw new Error("Δεν υπάρχουν προγραμματισμένες παραγωγές για κλείσιμο");
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const byOutput = new Map<string, RecipeGraphNode>();
  for (const recipe of recipes) {
    if (recipe.active === false || !recipe.outputGenericItemId) continue;
    if (byOutput.has(recipe.outputGenericItemId)) throw new Error("Περισσότερες από μία ενεργές συνταγές παράγουν το ίδιο είδος");
    byOutput.set(recipe.outputGenericItemId, recipe);
  }
  for (const plan of plans) {
    if (!Number.isSafeInteger(plan.quantityGrams) || plan.quantityGrams < 1 || !Number.isSafeInteger(plan.actualQuantityGrams) || plan.actualQuantityGrams < 1 || plan.actualQuantityGrams > plan.quantityGrams) throw new Error("Άκυρη πραγματική απόδοση προγραμματισμένης παραγωγής");
    if (!byId.has(plan.recipeId)) throw new Error("Η συνταγή προγραμματισμού δεν βρέθηκε");
  }

  const children = (recipe: RecipeGraphNode) => {
    const result = new Map<string, { recipe: RecipeGraphNode; itemGrams: number }>();
    for (const item of recipe.items) {
      const child = byOutput.get(item.genericItemId);
      if (child && child.id !== recipe.id) result.set(child.id, { recipe: child, itemGrams: item.grams + (result.get(child.id)?.itemGrams ?? 0) });
    }
    return result;
  };
  const roots = [...new Set(plans.map((plan) => plan.recipeId))].map((id) => byId.get(id)!);
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const involved = new Set<string>();
  function depth(recipe: RecipeGraphNode): number {
    const known = depths.get(recipe.id);
    if (known !== undefined) return known;
    if (visiting.has(recipe.id)) throw new Error(`Κυκλική αναφορά συνταγών στο ημερήσιο κλείσιμο: ${recipe.name}`);
    visiting.add(recipe.id);
    involved.add(recipe.id);
    const direct = [...children(recipe).values()].map((entry) => entry.recipe);
    const value = direct.length ? 1 + Math.max(...direct.map(depth)) : 0;
    visiting.delete(recipe.id);
    depths.set(recipe.id, value);
    return value;
  }
  roots.forEach(depth);

  const explicit = new Map<string, DayClosePlanInput[]>();
  for (const plan of plans) explicit.set(plan.recipeId, [...(explicit.get(plan.recipeId) ?? []), plan]);
  const stockBase = new Map<string, { baseQuantity: number; dimension: string; gramsPerPiece?: number | null }>();
  for (const row of stock) {
    const current = stockBase.get(row.genericItemId);
    if (current && (current.dimension !== row.dimension || current.gramsPerPiece !== row.gramsPerPiece)) throw new Error("Ασυνεπείς μονάδες ημιέτοιμου είδους");
    stockBase.set(row.genericItemId, { baseQuantity: (current?.baseQuantity ?? 0) + row.baseQuantity, dimension: row.dimension, gramsPerPiece: row.gramsPerPiece });
  }
  const stockGrams = new Map<string, number>();
  for (const [genericItemId, row] of stockBase) stockGrams.set(genericItemId, baseQuantityToGrams(row));
  const demand = new Map<string, number>();
  const automatic = new Map<string, number>();
  const propagation = [...involved].map((id) => byId.get(id)!).sort((a, b) => depths.get(b.id)! - depths.get(a.id)! || a.id.localeCompare(b.id));

  // Ο γονέας υπολογίζεται πριν από το παιδί· το auto top-up προστίθεται στις απαιτήσεις των δικών του παιδιών.
  for (const recipe of propagation) {
    const planned = explicit.get(recipe.id) ?? [];
    const actual = planned.reduce((sum, plan) => sum + plan.actualQuantityGrams, 0);
    const available = recipe.outputGenericItemId ? stockGrams.get(recipe.outputGenericItemId) ?? 0 : 0;
    const missing = Math.max(0, (demand.get(recipe.id) ?? 0) - available - actual);
    automatic.set(recipe.id, missing);
    const gross = planned.reduce((sum, plan) => sum + plan.quantityGrams, 0) + missing;
    if (!gross) continue;
    for (const entry of children(recipe).values()) {
      const required = scaledGrams(entry.itemGrams, gross, recipe.batchGrams);
      demand.set(entry.recipe.id, (demand.get(entry.recipe.id) ?? 0) + required);
    }
  }

  const descendants = new Map<string, string[]>();
  function outputsBelow(recipe: RecipeGraphNode): string[] {
    const known = descendants.get(recipe.id);
    if (known) return known;
    const outputIds = new Set<string>();
    for (const entry of children(recipe).values()) {
      if (entry.recipe.outputGenericItemId) outputIds.add(entry.recipe.outputGenericItemId);
      outputsBelow(entry.recipe).forEach((id) => outputIds.add(id));
    }
    const result = [...outputIds].sort();
    descendants.set(recipe.id, result);
    return result;
  }

  const jobs: DayCloseJob[] = [];
  for (const recipe of [...propagation].reverse()) {
    const planned = explicit.get(recipe.id) ?? [];
    for (const plan of planned) jobs.push({
      key: `plan:${plan.id}`, recipeId: recipe.id, planId: plan.id,
      expectedQuantityGrams: plan.quantityGrams, actualQuantityGrams: plan.actualQuantityGrams,
      scrapReason: plan.scrapReason ?? null, labourMinutes: plan.labourMinutes ?? 0, labourCostCents: plan.labourCostCents ?? 0,
      automatic: false, leafGenericItemIds: outputsBelow(recipe),
    });
    const missing = automatic.get(recipe.id) ?? 0;
    if (missing) jobs.push({
      key: `auto:${recipe.id}`, recipeId: recipe.id, planId: null,
      expectedQuantityGrams: missing, actualQuantityGrams: missing,
      scrapReason: null, labourMinutes: 0, labourCostCents: 0,
      automatic: true, leafGenericItemIds: outputsBelow(recipe),
    });
  }
  return jobs;
}

/** Η επιχειρησιακή ημερομηνία του UI ερμηνεύεται πάντα στην Αθήνα, όχι στη ζώνη του server. */
export function athensDayRange(isoDate: string): { date: Date; start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error("Άκυρη ημερομηνία κλεισίματος");
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) throw new Error("Άκυρη ημερομηνία κλεισίματος");
  const offset = (utcMillis: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", timeZoneName: "shortOffset" }).formatToParts(new Date(utcMillis));
    const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+2";
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(value);
    return match ? (Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000 * (match[1] === "-" ? -1 : 1) : 0;
  };
  const utcNoon = Date.parse(`${isoDate}T12:00:00.000Z`);
  const start = new Date(Date.parse(`${isoDate}T00:00:00.000Z`) - offset(utcNoon));
  const next = new Date(date.getTime() + 86400000);
  const nextNoon = Date.parse(`${next.toISOString().slice(0, 10)}T12:00:00.000Z`);
  const end = new Date(next.getTime() - offset(nextNoon));
  return { date, start, end };
}
