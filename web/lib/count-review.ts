// Απογραφή βιτρίνας: πραγματική κατανάλωση (ζύγισμα) απέναντι στη θεωρητική (πωλήσεις × μερίδα) ανά είδος.
// Καθαρή λογική για την καρτέλα απογραφής· τα δεδομένα τα φέρνει η σελίδα.
import { countConsumption } from "./consumption-rules.ts";

/** Πάνω από ±10% απόκλιση θέλει έλεγχο (όπως το όριο της παλιάς εφαρμογής). */
export const COUNT_DEVIATION_LIMIT_PCT = 10;

export type CountReviewLine = {
  genericItemId: string;
  name: string;
  dimension: string;
  consumptionSource: string;
  expectedQty: number;
  actualQty: number | null;
  wasteQty: number;
  /** γραμμένο στην οριστικοποίηση· στο προσχέδιο υπολογίζεται */
  consumptionQty: number | null;
  unitCostHundredths: number;
};

export type CountReviewStatus = "ok" | "high" | "low" | "stockout" | "pending" | "noSales";
export type CountReviewItem = { genericItemId: string; name: string; dimension: string; consumption: number | null; theoretical: number; deviationPct: number | null; stockedOut: boolean; status: CountReviewStatus };

/** Οι γραμμές ενός είδους (μία ανά παρτίδα) ενώνονται· μόνο είδη COUNT έχουν κατανάλωση από απογραφή. */
export function countReview(lines: readonly CountReviewLine[], theoreticalByItem: ReadonlyMap<string, number>): CountReviewItem[] {
  const byItem = new Map<string, CountReviewLine[]>();
  for (const line of lines) if (line.consumptionSource === "COUNT") byItem.set(line.genericItemId, [...(byItem.get(line.genericItemId) ?? []), line]);
  return [...byItem.values()].map((group) => {
    const first = group[0]!;
    const pending = group.some((l) => l.actualQty === null && l.consumptionQty === null);
    const consumption = pending ? null : group.reduce((sum, l) => sum + (l.consumptionQty ?? lineConsumption(l)), 0);
    const actual = group.reduce((sum, l) => sum + (l.actualQty ?? 0), 0);
    const stockedOut = !pending && actual === 0;
    const theoretical = theoreticalByItem.get(first.genericItemId) ?? 0;
    const deviationPct = consumption !== null && theoretical > 0 ? Math.round(((consumption - theoretical) / theoretical) * 1000) / 10 : null;
    const status: CountReviewStatus = pending ? "pending"
      : stockedOut ? "stockout" // η ζήτηση ήταν τουλάχιστον όσο φάνηκε: η απόκλιση δεν λέει τίποτα
      : deviationPct === null ? "noSales"
      : deviationPct > COUNT_DEVIATION_LIMIT_PCT ? "high"
      : deviationPct < -COUNT_DEVIATION_LIMIT_PCT ? "low"
      : "ok";
    return { genericItemId: first.genericItemId, name: first.name, dimension: first.dimension, consumption, theoretical, deviationPct, stockedOut, status };
  });
}

function lineConsumption(line: CountReviewLine): number {
  try {
    return countConsumption({ expectedQty: line.expectedQty, actualQty: line.actualQty ?? 0, wasteQty: line.wasteQty }).consumption;
  } catch {
    return 0; // άκυρη μέτρηση (πεταμένα > αναμενόμενο): την πιάνει η οριστικοποίηση με δικό της μήνυμα
  }
}

/** Σύνολα στην επικρατέστερη διάσταση (κιλά στη βιτρίνα), ώστε να μη μπλέκονται kg με τεμάχια. */
export function countReviewTotals(items: readonly CountReviewItem[]) {
  const dims = new Map<string, number>();
  for (const item of items) dims.set(item.dimension, (dims.get(item.dimension) ?? 0) + 1);
  const dimension = [...dims].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "mass";
  const measured = items.filter((i) => i.dimension === dimension && i.consumption !== null);
  const consumption = measured.reduce((s, i) => s + i.consumption!, 0);
  // η σύγκριση μόνο σε όσα έχουν και πωλήσεις και δεν εξαντλήθηκαν
  const compared = measured.filter((i) => i.theoretical > 0 && !i.stockedOut);
  const cmpConsumption = compared.reduce((s, i) => s + i.consumption!, 0);
  const theoretical = compared.reduce((s, i) => s + i.theoretical, 0);
  const deviationPct = theoretical > 0 ? Math.round(((cmpConsumption - theoretical) / theoretical) * 1000) / 10 : null;
  return { dimension, consumption, theoretical: measured.reduce((s, i) => s + i.theoretical, 0), deviationPct, measured: measured.length, pending: items.filter((i) => i.status === "pending").length };
}
