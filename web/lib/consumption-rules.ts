// Καθαροί κανόνες της μηχανής κατανάλωσης (ενότητα 4α): σπάσιμο πώλησης σε είδη, επιχειρησιακή ημέρα,
// μοίρασμα κατανάλωσης απογραφής σε ημέρες. Ακέραιες βασικές μονάδες, χωρίς βάση δεδομένων.
import { allocateCents } from "./reports.ts";

export const CONSUMPTION_KINDS = ["SALE", "TREAT", "STAFF", "WASTE", "COUNT_CONSUMPTION", "CUSTOMER_RETURN", "VOID"] as const;
export type ConsumptionKind = (typeof CONSUMPTION_KINDS)[number];
export const WASTE_REASONS = ["EXPIRED", "BROKEN", "QUALITY", "HACCP", "OTHER"] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];
export const SALE_LINE_KINDS = ["SALE", "TREAT", "STAFF"] as const;
export type SaleLineKind = (typeof SALE_LINE_KINDS)[number];

/** Όριο βάθους στο σπάσιμο «φτιάχνεται τη στιγμή» (κρέπα → ζύμη → …). */
export const MAX_EXPLODE_DEPTH = 5;

export class ConsumptionRuleError extends Error {
  readonly code: "RECIPE_CYCLE" | "RECIPE_TOO_DEEP" | "INVALID_QUANTITY";
  constructor(code: "RECIPE_CYCLE" | "RECIPE_TOO_DEEP" | "INVALID_QUANTITY", message: string) {
    super(message);
    this.code = code;
    this.name = "ConsumptionRuleError";
  }
}

export type ExplodeGeneric = {
  id: string;
  consumptionSource: string; // SALE | COUNT
  madeToOrder: boolean;
  trackStock: boolean;
  dimension: string; // mass | volume | count
  gramsPerPiece: number | null;
};
export type ExplodeRecipe = { id: string; batchGrams: number; items: readonly { genericItemId: string; grams: number }[] };
export type RecipeLineInput = { genericItemId: string; quantityBase: number };
/** Μία ανάγκη: `theoretical` = είδος COUNT, μετρά μόνο στη θεωρητική κατανάλωση, όχι στο απόθεμα. */
export type Requirement = { genericItemId: string; quantity: number; theoretical: boolean };

/** Βασική μονάδα → γραμμάρια (mass: mg, volume: ml ≈ g, count: τεμάχια × βάρος), ως δεκαδικό για ακρίβεια. */
function baseToGrams(qty: number, generic: ExplodeGeneric): number {
  if (generic.dimension === "mass") return qty / 1000;
  if (generic.dimension === "volume") return qty;
  if (!generic.gramsPerPiece) throw new ConsumptionRuleError("INVALID_QUANTITY", "Είδος σε τεμάχια χωρίς βάρος τεμαχίου");
  return qty * generic.gramsPerPiece;
}

function gramsToBase(grams: number, generic: ExplodeGeneric): number {
  if (generic.dimension === "mass") return Math.round(grams * 1000);
  if (generic.dimension === "volume") return Math.round(grams);
  if (!generic.gramsPerPiece) throw new ConsumptionRuleError("INVALID_QUANTITY", "Είδος σε τεμάχια χωρίς βάρος τεμαχίου");
  return Math.max(1, Math.round(grams / generic.gramsPerPiece)); // όπως το recipe-graph: τουλάχιστον ένα τεμάχιο
}

/**
 * Συνταγή πώλησης (προϊόν + επιλογές) × τεμάχια → ανάγκες ανά είδος. Ό,τι είναι «φτιάχνεται τη στιγμή»
 * σπάει στη συνταγή παραγωγής του (ίδιος κανόνας με mrp-demand/production-day-close: ό,τι έχει απόθεμα
 * καταναλώνεται, ό,τι φτιάχνεται τη στιγμή σπάει). Οι αρνητικές γραμμές επιλογών αφαιρούνται από το βασικό.
 */
export function explodeSale(
  lines: readonly RecipeLineInput[],
  units: number,
  generics: ReadonlyMap<string, ExplodeGeneric>,
  recipesByOutput: ReadonlyMap<string, ExplodeRecipe>,
): Requirement[] {
  if (!Number.isSafeInteger(units) || units < 1) throw new ConsumptionRuleError("INVALID_QUANTITY", "Η ποσότητα πώλησης είναι θετικός ακέραιος");
  const totals = new Map<string, number>();
  const visit = (genericItemId: string, quantity: number, path: readonly string[]) => {
    if (path.includes(genericItemId)) throw new ConsumptionRuleError("RECIPE_CYCLE", "Κυκλική αναφορά στη συνταγή");
    const generic = generics.get(genericItemId);
    const recipe = recipesByOutput.get(genericItemId);
    if (generic?.madeToOrder && recipe && quantity > 0) {
      if (path.length >= MAX_EXPLODE_DEPTH) throw new ConsumptionRuleError("RECIPE_TOO_DEEP", "Η συνταγή έχει περισσότερα από 5 επίπεδα");
      const grams = baseToGrams(quantity, generic);
      for (const item of recipe.items) {
        const child = generics.get(item.genericItemId);
        if (!child) continue;
        visit(item.genericItemId, gramsToBase(item.grams * grams / recipe.batchGrams, child), [...path, genericItemId]);
      }
      return;
    }
    totals.set(genericItemId, (totals.get(genericItemId) ?? 0) + quantity);
  };
  // Πρώτα το καθαρό άθροισμα ανά είδος (π.χ. «χωρίς σαντιγί» = −30 g), μετά το σπάσιμο.
  const net = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantityBase)) throw new ConsumptionRuleError("INVALID_QUANTITY", "Άκυρη ποσότητα συνταγής");
    net.set(line.genericItemId, (net.get(line.genericItemId) ?? 0) + line.quantityBase * units);
  }
  for (const [genericItemId, quantity] of net) if (quantity > 0) visit(genericItemId, quantity, []);
  return [...totals].flatMap(([genericItemId, quantity]) => {
    const generic = generics.get(genericItemId);
    if (!generic || quantity <= 0 || !generic.trackStock) return [];
    return [{ genericItemId, quantity, theoretical: generic.consumptionSource === "COUNT" }];
  });
}

/** Επιχειρησιακή ημέρα Αθήνας ως DATE (UTC μεσάνυχτα), όπως το StockCount.countedOn. */
export function businessDay(at: Date): Date {
  return new Date(`${at.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" })}T00:00:00.000Z`);
}

export const isoDay = (day: Date) => day.toISOString().slice(0, 10);
export const addDaysUtc = (day: Date, n: number) => new Date(day.getTime() + n * 86_400_000);

/**
 * Απογραφή που κάλυψε περισσότερες ημέρες (λείπει η ενδιάμεση): η κατανάλωση μοιράζεται στις ημέρες με
 * βάρη τις πωλήσεις του ταμείου (θεωρητική κατανάλωση), αλλιώς ισόποσα. Το άθροισμα μένει ακριβές.
 */
export function spreadOverDays(total: number, days: readonly { day: string; weight: number }[]): Map<string, number> {
  if (!days.length) return new Map();
  if (total <= 0) return new Map(days.map((d) => [d.day, 0]));
  const weighted = days.some((d) => d.weight > 0);
  return allocateCents(total, days.map((d) => ({ id: d.day, weight: weighted ? Math.max(0, d.weight) : 1 })));
}

/**
 * Απογραφή είδους COUNT: αναμενόμενο (προηγούμενη + εισαγωγές) − καταμέτρηση − πεταμένα = κατανάλωση.
 * Αρνητική κατανάλωση = εισαγωγή που δεν καταχωρήθηκε ή λάθος μέτρησης → έλεγχος, εκτός πρόβλεψης.
 */
export function countConsumption(input: { expectedQty: number; actualQty: number; wasteQty: number }) {
  const { expectedQty, actualQty, wasteQty } = input;
  if (![expectedQty, actualQty, wasteQty].every(Number.isSafeInteger) || actualQty < 0 || wasteQty < 0) throw new ConsumptionRuleError("INVALID_QUANTITY", "Άκυρη μέτρηση απογραφής");
  if (wasteQty > expectedQty) throw new ConsumptionRuleError("INVALID_QUANTITY", "Τα πεταμένα ξεπερνούν το αναμενόμενο απόθεμα");
  const consumption = expectedQty - actualQty - wasteQty;
  return { consumption, waste: wasteQty, needsReview: consumption < 0, stockedOut: actualQty === 0 };
}
