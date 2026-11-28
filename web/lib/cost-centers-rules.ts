// Κανόνες κέντρων κόστους χωρίς βάση: έλεγχοι εγκυρότητας και κατανομή ποσού. Η κατανομή είναι διοικητική:
// δεν αλλάζει παραστατικό, myDATA ή εξαγωγή προς τον λογιστή.
import { allocateCents } from "./reports.ts";

export const BASES = ["FIXED", "REVENUE", "AREA", "ORDERS", "EQUAL"] as const;
export type Basis = (typeof BASES)[number];
export const FIXED_TOTAL = 10_000; // FIXED σε μονάδες 0,01%: 50% = 5000
export type Share = { costCenterId: string; weight: number };

export class CostCenterError extends Error {}

/** Προεπιλογές demo (ενότητα 5)· ίδιες με το backfill του migration 20261128300000_cost_centers. */
export const DEFAULT_CENTERS = [
  { code: "10", name: "Καταστήματα", kind: "STORE", basis: null },
  { code: "20", name: "Εργαστήριο παραγωγής", kind: "PRODUCTION", basis: "REVENUE" },
  { code: "30", name: "Διοίκηση / έδρα", kind: "HQ", basis: "REVENUE" },
  { code: "40", name: "Διανομή", kind: "DELIVERY", basis: "ORDERS" },
  { code: "50", name: "Μάρκετινγκ", kind: "HQ", basis: "EQUAL" },
] as const satisfies readonly { code: string; name: string; kind: string; basis: Basis | null }[];
export const STORES_CODE = "10";
export const HQ_CODE = "30";

export function checkShares(basis: Basis, shares: readonly Share[]) {
  if (basis !== "FIXED" && basis !== "AREA") {
    if (shares.length) throw new CostCenterError("Μόνο τα σταθερά ποσοστά και τα τετραγωνικά παίρνουν μερίδια");
    return;
  }
  if (!shares.length) throw new CostCenterError("Βάλε τουλάχιστον ένα κατάστημα στον κανόνα");
  const ids = new Set(shares.map((s) => s.costCenterId));
  if (ids.size !== shares.length) throw new CostCenterError("Το ίδιο κέντρο εμφανίζεται δύο φορές");
  if (shares.some((s) => !Number.isSafeInteger(s.weight) || s.weight <= 0)) throw new CostCenterError("Κάθε μερίδιο πρέπει να είναι θετικός αριθμός");
  if (basis === "FIXED" && shares.reduce((t, s) => t + s.weight, 0) !== FIXED_TOTAL) throw new CostCenterError("Τα ποσοστά πρέπει να αθροίζουν 100%");
}

type Period = { id?: string; validFrom: Date; validTo: Date | null };
/** Δύο κανόνες του ίδιου κέντρου δεν ισχύουν την ίδια μέρα. Τα όρια είναι ημερομηνίες, συμπεριλαμβάνονται. */
export function overlaps(a: Period, b: Period) {
  const end = (p: Period) => p.validTo?.getTime() ?? Infinity;
  if (a.validTo && a.validTo < a.validFrom) throw new CostCenterError("Η λήξη είναι πριν από την έναρξη");
  return a.validFrom.getTime() <= end(b) && b.validFrom.getTime() <= end(a);
}

/** Αλλαγή γονικού: απορρίπτεται αν δημιουργεί κύκλο (το κέντρο θα γινόταν πρόγονος του εαυτού του). */
export function assertNoCycle(id: string, parentId: string | null, parentOf: ReadonlyMap<string, string | null>) {
  for (let p = parentId, steps = 0; p; p = parentOf.get(p) ?? null, steps++) {
    if (p === id || steps > 1000) throw new CostCenterError("Το κέντρο δεν μπορεί να είναι κάτω από τον εαυτό του");
  }
}

export type AllocationResult = { cents: Map<string, number>; warning: string | null };

/**
 * Κατανομή ποσού στα κέντρα καταστημάτων. `stores` = τα ενεργά κέντρα καταστημάτων. `measure` = τζίρος ή παραγγελίες
 * ανά κέντρο για REVENUE/ORDERS. Αν η βάση είναι μηδενική παντού, μοιράζει ισόποσα με προειδοποίηση.
 */
export function allocate(amountCents: number, basis: Basis, shares: readonly Share[], stores: readonly string[], measure: ReadonlyMap<string, number> = new Map()): AllocationResult {
  if (basis === "FIXED" || basis === "AREA") return { cents: allocateCents(amountCents, shares.map((s) => ({ id: s.costCenterId, weight: s.weight }))), warning: null };
  if (!stores.length) throw new CostCenterError("Δεν υπάρχει ενεργό κατάστημα για να μοιραστεί το ποσό");
  const equal = () => allocateCents(amountCents, stores.map((id) => ({ id, weight: 1 })));
  if (basis === "EQUAL") return { cents: equal(), warning: null };
  const weights = stores.map((id) => ({ id, weight: Math.max(0, measure.get(id) ?? 0) }));
  if (!weights.some((w) => w.weight > 0)) return { cents: equal(), warning: basis === "REVENUE" ? "Κανένα κατάστημα δεν έχει τζίρο στην περίοδο: μοιράστηκε ισόποσα" : "Κανένα κατάστημα δεν έχει παραγγελίες στην περίοδο: μοιράστηκε ισόποσα" };
  return { cents: allocateCents(amountCents, weights), warning: null };
}
