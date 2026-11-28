// Συνταγή πώλησης (ενότητα 4α): τι φεύγει από την αποθήκη για κάθε τεμάχιο ενός προϊόντος του ταμείου
// και για κάθε επιλογή του (γεύση, topping). Κάθε αποθήκευση γράφει νέα έκδοση· οι παλιές πωλήσεις
// καταναλώνουν με την έκδοση που ίσχυε τη στιγμή τους (activeSalesRecipes).
import type { Prisma } from "./generated/prisma/client.ts";
import { stockCostScale } from "./units.ts";

type Db = Prisma.TransactionClient;

export class SalesRecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesRecipeError";
  }
}

export const DIMENSION_UNIT: Record<string, string> = { mass: "g", volume: "ml", count: "τμχ" };

/** Ποσότητα όπως τη γράφει ο χρήστης (g / ml / τμχ, με κόμμα) → ακέραιες βασικές μονάδες. */
export function parseRecipeQty(raw: string, dimension: string, allowNegative = false): number {
  const n = Number(raw.trim().replace(",", "."));
  if (!raw.trim() || !Number.isFinite(n) || n === 0) throw new SalesRecipeError("Γράψε ποσότητα, π.χ. 70");
  if (n < 0 && !allowNegative) throw new SalesRecipeError("Η ποσότητα είναι θετικός αριθμός");
  const base = dimension === "mass" ? Math.round(n * 1000) : Math.round(n);
  if (dimension === "count" && !Number.isInteger(n)) throw new SalesRecipeError("Τα τεμάχια είναι ακέραιος αριθμός");
  if (base === 0 || Math.abs(base) > 100_000_000) throw new SalesRecipeError("Η ποσότητα είναι εκτός ορίων");
  return base;
}

/** Βασικές μονάδες → «70 g», «0,5 g», «20 ml», «1 τμχ». */
export function formatRecipeQty(base: number, dimension: string): string {
  const qty = dimension === "mass" ? base / 1000 : base;
  return `${new Intl.NumberFormat("el-GR", { maximumFractionDigits: 3 }).format(qty)} ${DIMENSION_UNIT[dimension] ?? ""}`.trim();
}

/** Ίδιο με τη μορφή του πεδίου: χωρίς μονάδα, με κόμμα. */
export const recipeQtyInput = (base: number, dimension: string) => String(dimension === "mass" ? base / 1000 : base).replace(".", ",");

/** Κόστος γραμμής σε λεπτά (δεκαδικό: στρογγυλοποίηση μόνο στο σύνολο). */
export const lineCost = (quantityBase: number, avgCostHundredths: number, dimension: string) => quantityBase * avgCostHundredths / stockCostScale(dimension) / 100;

export type CostGroup = { kind: string; pick: number; optionCosts: readonly (number | null)[] };

/**
 * Τυπικό κόστος τεμαχίου: βασικά υλικά + για κάθε υποχρεωτική ομάδα «πόσες» × μέσο κόστος των επιλογών
 * που έχουν συνταγή. Οι προαιρετικές ομάδες δεν μπαίνουν (φαίνονται χωριστά ως «με …»).
 */
export function typicalCost(baseCost: number, groups: readonly CostGroup[]): { cents: number; missingOptions: number } {
  let cents = baseCost, missingOptions = 0;
  for (const g of groups) {
    const known = g.optionCosts.filter((c): c is number => c !== null);
    missingOptions += g.optionCosts.length - known.length;
    if (g.kind === "REQUIRED" && known.length) cents += g.pick * known.reduce((a, c) => a + c, 0) / known.length;
  }
  return { cents: Math.round(cents), missingOptions };
}

const RECIPE_INCLUDE = { lines: { orderBy: { id: "asc" }, select: { id: true, genericItemId: true, quantityBase: true } } } as const;

/** Όλα όσα χρειάζεται η σελίδα: προϊόν, ομάδες/επιλογές, τρέχουσες εκδόσεις και τα είδη για επιλογή. */
export async function salesRecipePage(db: Db, orgId: string, productId: string) {
  const product = await db.product.findFirst({
    where: { id: productId, orgId },
    select: {
      id: true, name: true, priceCents: true, vatRate: { select: { rate: true } }, category: { select: { name: true } },
      modifierGroups: { orderBy: { position: "asc" }, select: { pick: true, group: { select: { id: true, name: true, kind: true, options: { where: { active: true }, orderBy: { position: "asc" }, select: { id: true, name: true } } } } } },
    },
  });
  if (!product) return null;
  const optionIds = product.modifierGroups.flatMap((g) => g.group.options.map((o) => o.id));
  const [recipes, generics] = await Promise.all([
    db.salesRecipe.findMany({
      where: { orgId, validFrom: { lte: new Date() }, OR: [{ productId }, ...(optionIds.length ? [{ modifierOptionId: { in: optionIds } }] : [])] },
      orderBy: [{ validFrom: "desc" }, { version: "desc" }],
      include: RECIPE_INCLUDE,
    }),
    db.genericItem.findMany({ where: { orgId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, avgCostHundredths: true, consumptionSource: true, baseUnit: { select: { dimension: true } } } }),
  ]);
  const productRecipe = recipes.find((r) => r.productId === productId) ?? null;
  const optionRecipes = new Map<string, (typeof recipes)[number]>();
  for (const r of recipes) if (r.modifierOptionId && !optionRecipes.has(r.modifierOptionId)) optionRecipes.set(r.modifierOptionId, r);
  return { product, productRecipe, optionRecipes, generics: generics.map((g) => ({ id: g.id, name: g.name, avgCostHundredths: g.avgCostHundredths, consumptionSource: g.consumptionSource, dimension: g.baseUnit.dimension })) };
}

export type SalesRecipeLineDraft = { genericItemId: string; qty: string };

/** Νέα έκδοση συνταγής για προϊόν ή επιλογή. Κενή λίστα = «χωρίς υλικά» (π.χ. επιλογή που δεν καταναλώνει). */
export async function saveSalesRecipe(db: Db, input: { orgId: string; productId?: string | null; modifierOptionId?: string | null; lines: readonly SalesRecipeLineDraft[]; createdByName: string }) {
  if (!!input.productId === !!input.modifierOptionId) throw new SalesRecipeError("Η συνταγή ανήκει σε προϊόν ή σε επιλογή");
  if (input.productId && !(await db.product.findFirst({ where: { id: input.productId, orgId: input.orgId }, select: { id: true } }))) throw new SalesRecipeError("Το προϊόν δεν βρέθηκε");
  if (input.modifierOptionId && !(await db.modifierOption.findFirst({ where: { id: input.modifierOptionId, group: { orgId: input.orgId } }, select: { id: true } }))) throw new SalesRecipeError("Η επιλογή δεν βρέθηκε");
  const drafts = input.lines.filter((l) => l.genericItemId || l.qty.trim());
  if (drafts.length > 40) throw new SalesRecipeError("Έως 40 υλικά ανά συνταγή");
  const ids = [...new Set(drafts.map((l) => l.genericItemId))];
  if (ids.length !== drafts.length) throw new SalesRecipeError("Κάθε υλικό μπαίνει μία φορά· ένωσε τις ποσότητες");
  const generics = ids.length ? await db.genericItem.findMany({ where: { orgId: input.orgId, id: { in: ids } }, select: { id: true, name: true, baseUnit: { select: { dimension: true } } } }) : [];
  const byId = new Map(generics.map((g) => [g.id, g]));
  const lines = drafts.map((l) => {
    const generic = byId.get(l.genericItemId);
    if (!generic) throw new SalesRecipeError("Διάλεξε υλικό σε κάθε γραμμή με ποσότητα");
    try {
      // αρνητικό μόνο στις επιλογές: «χωρίς σιρόπι» = λιγότερο από το βασικό
      return { orgId: input.orgId, genericItemId: generic.id, quantityBase: parseRecipeQty(l.qty, generic.baseUnit.dimension, !!input.modifierOptionId) };
    } catch (error) {
      throw new SalesRecipeError(`${generic.name}: ${error instanceof Error ? error.message : "άκυρη ποσότητα"}`);
    }
  });
  const owner = input.productId ? { productId: input.productId } : { modifierOptionId: input.modifierOptionId! };
  const last = await db.salesRecipe.findFirst({ where: { orgId: input.orgId, ...owner }, orderBy: { version: "desc" }, select: { version: true } });
  return db.salesRecipe.create({ data: { orgId: input.orgId, ...owner, version: (last?.version ?? 0) + 1, createdByName: input.createdByName, lines: { create: lines } }, select: { id: true, version: true } });
}
