// Snapshots βιτρίνας χωρίς κόστη ή tenant internals· η δημόσια προβολή δέχεται μόνο αυτά τα πεδία.
import { analyzeRecipe, type MaterialComposition } from "./recipe-analysis.ts";

export type VitrineComposition = MaterialComposition & {
  name: string;
  allergensContains?: string[];
  allergensTraces?: string[];
  ingredientsText?: string | null;
  isVegan?: boolean;
  isVegetarian?: boolean;
  isSugarFree?: boolean;
  isGlutenFree?: boolean;
  isLactoseFree?: boolean;
  containsAlcohol?: boolean;
};

export function buildVitrineSnapshot(input: { productName: string; priceCents: number; recipeName?: string | null; batchGrams?: number | null; lines?: readonly { name: string; grams: number; composition?: VitrineComposition | null }[] }) {
  const lines = input.lines ?? [];
  const contains = new Set<string>(), traces = new Set<string>();
  for (const line of lines) {
    line.composition?.allergensContains?.forEach((key) => contains.add(key));
    line.composition?.allergensTraces?.forEach((key) => traces.add(key));
  }
  for (const key of contains) traces.delete(key);
  const analysis = analyzeRecipe(lines.map((line) => ({ grams: line.grams, material: line.composition ?? {} })));
  // Διατροφικός ισχυρισμός μόνο όταν τεκμηριώνεται ρητά σε κάθε συστατικό· το άγνωστο δεν γίνεται «vegan/χωρίς…».
  const every = (key: "isVegan" | "isVegetarian" | "isSugarFree" | "isGlutenFree" | "isLactoseFree") => lines.length > 0 && lines.every((line) => line.composition?.[key] === true);
  return {
    version: 1,
    productName: input.productName,
    recipeName: input.recipeName ?? null,
    batchGrams: input.batchGrams ?? null,
    ingredients: lines.map((line) => ({ name: line.name, grams: line.grams, labelText: line.composition?.ingredientsText ?? null })),
    allergensContains: [...contains].sort(), allergensTraces: [...traces].sort(),
    dietary: { vegan: every("isVegan"), vegetarian: every("isVegetarian"), sugarFree: every("isSugarFree"), glutenFree: every("isGlutenFree"), lactoseFree: every("isLactoseFree"), alcohol: lines.some((line) => line.composition?.containsAlcohol) },
    nutritionPer100g: lines.length ? { fat: round(analysis.fat), sugars: round(analysis.sugars), protein: round(analysis.totalProtein), salt: round(analysis.salt) } : null,
  };
}
const round = (value: number) => Math.round(value * 10) / 10;

export type PublicVitrineItem = { productId: string; name: string; priceCents: number | null; position: number; snapshot: unknown; selected: boolean; soldOut: boolean };
export function publicVitrineItems(items: readonly PublicVitrineItem[], availableGenericByProduct: ReadonlyMap<string, boolean> = new Map()) {
  return items.filter((item) => item.selected && !item.soldOut && availableGenericByProduct.get(item.productId) !== false).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "el")).map((item) => ({ productId: item.productId, name: item.name, priceCents: item.priceCents, position: item.position, snapshot: item.snapshot }));
}

export function publicVitrineSubscription(input: { suspendedAt: Date | null; closingAt: Date | null; subscription: { status: string; currentPeriodEnd: Date } | null }, at = new Date()) {
  if (input.suspendedAt || input.closingAt) return false;
  if (!input.subscription) return true;
  if (input.subscription.status === "CANCELLED") return false;
  return input.subscription.currentPeriodEnd.getTime() + 7 * 86_400_000 > at.getTime();
}
