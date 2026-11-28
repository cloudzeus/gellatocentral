// Βέβαιη ζήτηση Α΄ υλών από προγραμματισμένες παρτίδες (μεταφορά του mrp-demand της παλιάς).
// Ίδιος κανόνας με το κλείσιμο ημέρας: ό,τι ημιέτοιμο υπάρχει αναλώνεται, μόνο το υπόλοιπο παράγεται
// και σπάει σε Α΄ ύλες. Όλα σε ακέραια γραμμάρια (η μονάδα των συνταγών)· η μετατροπή σε βασική μονάδα
// γίνεται στο επίπεδο της βάσης.
import type { RecipeGraphNode } from "../recipe-graph.ts";
import { addDays } from "./production-suggest.ts";

/** Μία παρτίδα: παράγει `grams` από το είδος `genericItemId` την ημέρα `day`. */
export type PlannedBatch = { genericItemId: string; day: string; grams: number };
export type FirmDemand = { firm: Record<string, Record<string, number>>; usedChildStock: Record<string, number> };

/**
 * Οι παρτίδες με σειρά ημέρας· το απόθεμα ημιέτοιμων μοιράζεται μία φορά. Η προγραμματισμένη παραγωγή
 * ημιέτοιμου της ίδιας ημέρας πιστώνεται πριν σπάσουν οι παρτίδες που το χρησιμοποιούν, αλλιώς οι
 * Α΄ ύλες της βάσης μετρούν δύο φορές. `excluded`: είδη που δεν είναι υλικά συνταγής (εμπορεύματα).
 */
export function firmDemandFromBatches(recipes: readonly RecipeGraphNode[], batches: readonly PlannedBatch[], childStockGrams: Readonly<Record<string, number | undefined>>, excluded: ReadonlySet<string> = new Set()): FirmDemand {
  const byOutput = new Map(recipes.filter((r) => r.active !== false && r.outputGenericItemId).map((r) => [r.outputGenericItemId!, r]));
  const pool: Record<string, number> = {};
  for (const [id, q] of Object.entries(childStockGrams)) pool[id] = Math.max(0, q ?? 0);
  const plannedPool: Record<string, number> = {};
  const firm: Record<string, Record<string, number>> = {};
  const usedChildStock: Record<string, number> = {};

  const addMaterials = (day: Record<string, number>, genericItemId: string, grams: number, seen: ReadonlySet<string>) => {
    const recipe = byOutput.get(genericItemId);
    if (!recipe || grams <= 0) return;
    for (const item of recipe.items) {
      const need = Math.max(1, Math.round(item.grams * grams / recipe.batchGrams));
      const child = byOutput.get(item.genericItemId);
      if (!child) {
        if (!excluded.has(item.genericItemId)) day[item.genericItemId] = (day[item.genericItemId] ?? 0) + need;
        continue;
      }
      if (seen.has(item.genericItemId)) continue; // κύκλος: το πιάνει η αποθήκευση της συνταγής
      const fromPlanned = Math.min(plannedPool[item.genericItemId] ?? 0, need);
      if (fromPlanned > 0) plannedPool[item.genericItemId]! -= fromPlanned;
      const fromStock = Math.min(pool[item.genericItemId] ?? 0, need - fromPlanned);
      if (fromStock > 0) {
        pool[item.genericItemId]! -= fromStock;
        usedChildStock[item.genericItemId] = (usedChildStock[item.genericItemId] ?? 0) + fromStock;
      }
      const toProduce = need - fromPlanned - fromStock;
      if (toProduce > 0) addMaterials(day, item.genericItemId, toProduce, new Set([...seen, item.genericItemId]));
    }
  };

  const valid = batches.filter((b) => b.grams > 0 && byOutput.has(b.genericItemId)).sort((a, b) => a.day.localeCompare(b.day));
  for (let i = 0; i < valid.length;) {
    const date = valid[i]!.day;
    let j = i;
    while (j < valid.length && valid[j]!.day === date) j++;
    const dayBatches = valid.slice(i, j);
    for (const b of dayBatches) plannedPool[b.genericItemId] = (plannedPool[b.genericItemId] ?? 0) + b.grams;
    const day = (firm[date] ??= {});
    for (const b of dayBatches) addMaterials(day, b.genericItemId, b.grams, new Set([b.genericItemId]));
    i = j;
  }
  return { firm, usedChildStock };
}

export type WholesaleLine = { genericItemId: string; day: string; grams: number };

/**
 * Χονδρική που δεν καλύπτεται από το έτοιμο του εργαστηρίου ούτε από παρτίδες με ημέρα ≤ της
 * παράδοσης: γίνεται ψευδο-παρτίδα την προηγούμενη ημέρα (όχι πριν από σήμερα).
 */
export function wholesaleShortfall(orders: readonly WholesaleLine[], planned: readonly PlannedBatch[], labStockGrams: Readonly<Record<string, number | undefined>>, today: string) {
  const byItem = new Map<string, WholesaleLine[]>();
  for (const o of orders) {
    if (!(o.grams > 0) || o.day < today) continue;
    byItem.set(o.genericItemId, [...(byItem.get(o.genericItemId) ?? []), o]);
  }
  const batches: PlannedBatch[] = [];
  const usedStock: Record<string, number> = {};
  const usedPlanned: Record<string, number> = {};
  for (const [id, list] of byItem) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    let stock = Math.max(0, labStockGrams[id] ?? 0);
    const queue = planned.filter((b) => b.genericItemId === id && b.grams > 0).map((b) => ({ day: b.day, left: b.grams })).sort((a, b) => a.day.localeCompare(b.day));
    for (const o of list) {
      let need = o.grams;
      const fromStock = Math.min(stock, need);
      stock -= fromStock;
      need -= fromStock;
      if (fromStock > 0) usedStock[id] = (usedStock[id] ?? 0) + fromStock;
      for (const p of queue) {
        if (need <= 0) break;
        if (p.day > o.day || p.left <= 0) continue;
        const take = Math.min(p.left, need);
        p.left -= take;
        need -= take;
        usedPlanned[id] = (usedPlanned[id] ?? 0) + take;
      }
      if (need > 0) {
        const prev = addDays(o.day, -1);
        batches.push({ genericItemId: id, day: prev < today ? today : prev, grams: need });
      }
    }
  }
  return { batches, usedStock, usedPlanned };
}

/** Χονδρική = (παρτίδες + ψευδο-παρτίδες) − (μόνο παρτίδες), ώστε το απόθεμα ημιέτοιμων να μοιράζεται μία φορά. */
export function firmDemandWithWholesale(recipes: readonly RecipeGraphNode[], planned: readonly PlannedBatch[], wholesaleBatches: readonly PlannedBatch[], childStockGrams: Readonly<Record<string, number | undefined>>, excluded?: ReadonlySet<string>) {
  const { firm } = firmDemandFromBatches(recipes, planned, childStockGrams, excluded);
  const wholesale: Record<string, Record<string, number>> = {};
  if (!wholesaleBatches.length) return { firm, wholesale };
  const all = firmDemandFromBatches(recipes, [...planned, ...wholesaleBatches], childStockGrams, excluded).firm;
  for (const [day, items] of Object.entries(all)) for (const [id, q] of Object.entries(items)) {
    const extra = q - (firm[day]?.[id] ?? 0);
    if (extra > 0) (wholesale[day] ??= {})[id] = extra;
  }
  return { firm, wholesale };
}
