// Τεχνική ανάλυση συνταγής παγωτού (ισορροπία PAC/POD, στερεά, σημείο πήξης, κόστος).
// Πιστή μεταφορά του engine του παλιού Gelato System προσαρμοσμένη στη δική μας δομή:
// η σύσταση κρέμεται στο Composition (κεντρικός κατάλογος TradeItem ή GenericItem του tenant)
// και η ποσότητα της γραμμής είναι πάντα σε γραμμάρια.
// Όλα τα ποσοστά σύστασης είναι % ανά 100 g είδους. Καθαρές συναρτήσεις — δοκιμάζονται με node --test.

import { SERVING_TEMP_C, STORAGE_TEMP_C, frozenPctAt, tempAtFrozenFraction } from "./freezing-curve.ts";

/** Μετατροπή σε αριθμό — δέχεται και κόμμα ως υποδιαστολή */
export const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  const s = String(v).trim().replace(",", ".");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// ---- Σύσταση είδους (% ανά 100 g) ----

export type AcidityLevel = "none" | "high" | "very_high";

export interface MaterialComposition {
  fatPct?: number | null;
  msnfPct?: number | null;
  sucrosePct?: number | null;
  dextrosePct?: number | null;
  glucoseSyrupPct?: number | null;
  glucoseDe?: number | null;
  invertSugarPct?: number | null;
  fructosePct?: number | null;
  lactosePct?: number | null;
  cocoaNonfatPct?: number | null;
  stabilizerPct?: number | null;
  emulsifierPct?: number | null;
  saltPct?: number | null;
  alcoholPct?: number | null; // % vol, όπως η ετικέτα
  otherSolidsPct?: number | null;
  /** Διαθέσιμες πρωτεΐνες γάλακτος (οδηγούν την εκτίμηση λακτόζης και τη «γεύση γάλακτος») */
  proteinAvailablePct?: number | null;
  /** Άλλες πρωτεΐνες (αυγό, ξηροί καρποί, φυτικές) — ανεξάρτητα στερεά */
  otherProteinPct?: number | null;
  fiberPct?: number | null;
  pacOverride?: number | null;
  podOverride?: number | null;
  /** Χειροκίνητη τιμή ολικών στερεών — υπερισχύει του αυτόματου υπολογισμού */
  totalSolidsOverride?: number | null;
  acidityLevel?: AcidityLevel | string | null;
  containsStarch?: boolean | null;
  containsCocoa?: boolean | null;
}

// ---- Σταθερές (Corvitto / Goff & Hartel) ----

/** Η λακτόζη εκτιμάται ως ποσοστό των MSNF όταν δεν δίνεται ρητά */
export const LACTOSE_IN_MSNF = 0.545;

/** Συντελεστές αντιψυκτικής δύναμης (PAC) — ζάχαρη = 100 */
export const PAC = {
  sucrose: 100,
  dextrose: 190,
  fructose: 190,
  invert: 190,
  lactose: 100,
  salt: 585,
  /** Αιθανόλη: 342,3 / 46,07 ≈ 7,43 × ζάχαρη (Corvitto ~740). Η τιμή είναι ανά g αιθανόλης. */
  alcohol: 740,
} as const;

/** Συντελεστές γλυκύτητας (POD) — ζάχαρη = 100 */
export const POD = {
  sucrose: 100,
  dextrose: 70,
  fructose: 170,
  invert: 125,
  lactose: 16,
} as const;

/** Σιρόπι γλυκόζης: οι συντελεστές εξαρτώνται από το DE */
export const glucosePac = (de: number) => Math.round(de * 1.45 * 10) / 10;
export const glucosePod = (de: number) => Math.round(de * 0.65 * 10) / 10;

// ---- Υπολογισμοί ανά είδος ----

/** Σύνολο σακχάρων (%) του είδους — η λακτόζη μετριέται μέσα στα MSNF */
export function materialSugars(m: MaterialComposition): number {
  return num(m.sucrosePct) + num(m.dextrosePct) + num(m.glucoseSyrupPct) + num(m.invertSugarPct) + num(m.fructosePct);
}

/** Ολικά στερεά (%) — υπολογίζονται αυτόματα από τα επιμέρους */
export function materialTotalSolids(m: MaterialComposition): number {
  if (m.totalSolidsOverride != null) return num(m.totalSolidsOverride);
  return (
    num(m.fatPct) +
    num(m.msnfPct) +
    materialSugars(m) +
    num(m.cocoaNonfatPct) +
    num(m.stabilizerPct) +
    num(m.emulsifierPct) +
    num(m.saltPct) +
    // Η αιθανόλη είναι υγρό: δεν μετράει στα ολικά στερεά (μόνο στο PAC)
    num(m.otherSolidsPct) +
    num(m.fiberPct) +
    num(m.otherProteinPct)
  );
}

/**
 * Πυκνότητα διαλύματος νερού–αιθανόλης στους 20 °C (g/ml) ανά % vol (OIV).
 * Χρησιμοποιείται για τη μετατροπή του αλκοόλ της ετικέτας (% vol) σε % κατά βάρος.
 */
const ETHANOL_DENSITY_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.9982],
  [10, 0.9857],
  [20, 0.9739],
  [30, 0.9614],
  [40, 0.948],
  [50, 0.9302],
  [60, 0.9091],
  [70, 0.8858],
  [80, 0.8611],
  [90, 0.834],
  [100, 0.7893],
];
const ETHANOL_DENSITY = 0.7893;

/** Αλκοόλ κατά βάρος (% w/w) από τον αλκοολικό τίτλο της ετικέτας (% vol). Π.χ. 40% vol ≈ 33,3% κατά βάρος. */
export function alcoholByWeight(abvPct: number): number {
  const v = Math.min(100, Math.max(0, num(abvPct)));
  if (v === 0) return 0;
  let density = ETHANOL_DENSITY;
  for (let i = 1; i < ETHANOL_DENSITY_TABLE.length; i++) {
    const [v1, d1] = ETHANOL_DENSITY_TABLE[i]!;
    if (v <= v1) {
      const [v0, d0] = ETHANOL_DENSITY_TABLE[i - 1]!;
      density = d0 + ((d1 - d0) * (v - v0)) / (v1 - v0);
      break;
    }
  }
  return (v * ETHANOL_DENSITY) / density;
}

/** Νερό (%) = 100 − ολικά στερεά */
export function materialWater(m: MaterialComposition): number {
  return 100 - materialTotalSolids(m);
}

/**
 * Λακτόζη (%) — ρητή τιμή αν δοθεί, αλλιώς εκτίμηση από τα MSNF.
 * Η εκτίμηση γίνεται μόνο για γαλακτοκομικά είδη (όσα έχουν πρωτεΐνες γάλακτος).
 */
export function materialLactose(m: MaterialComposition): number {
  if (num(m.lactosePct) > 0) return num(m.lactosePct);
  if (num(m.proteinAvailablePct) <= 0) return 0;
  return num(m.msnfPct) * LACTOSE_IN_MSNF;
}

/** PAC ανά 100 g είδους */
export function materialPac(m: MaterialComposition): number {
  if (m.pacOverride != null) return num(m.pacOverride);
  return (
    (num(m.sucrosePct) * PAC.sucrose +
      num(m.dextrosePct) * PAC.dextrose +
      num(m.fructosePct) * PAC.fructose +
      num(m.invertSugarPct) * PAC.invert +
      num(m.glucoseSyrupPct) * glucosePac(num(m.glucoseDe) || 38) +
      materialLactose(m) * PAC.lactose +
      num(m.saltPct) * PAC.salt +
      // Το alcoholPct είναι % vol (όπως η ετικέτα) — το PAC θέλει κατά βάρος
      alcoholByWeight(num(m.alcoholPct)) * PAC.alcohol) /
    100
  );
}

/** POD ανά 100 g είδους */
export function materialPod(m: MaterialComposition): number {
  if (m.podOverride != null) return num(m.podOverride);
  return (
    (num(m.sucrosePct) * POD.sucrose +
      num(m.dextrosePct) * POD.dextrose +
      num(m.fructosePct) * POD.fructose +
      num(m.invertSugarPct) * POD.invert +
      num(m.glucoseSyrupPct) * glucosePod(num(m.glucoseDe) || 38) +
      materialLactose(m) * POD.lactose) /
    100
  );
}

// ---- Δόση σταθεροποιητή ----

/** Πάνω από αυτό το ποσοστό το είδος θεωρείται καθαρός σταθεροποιητής (Neutro 5) */
export const STABILIZER_PURE_THRESHOLD = 50;

export type StabilizerDoseType = "neutro5" | "base50" | "mixed" | "none";
export type StabilizerRecipeKind = "milk" | "fruit";

/** Συνταγές φρούτου (sorbet/χωρίς γαλακτοκομικά) vs γάλακτος */
export const stabilizerRecipeKind = (recipeType?: string | null): StabilizerRecipeKind =>
  recipeType === "sorbet" || recipeType === "nonDairy" ? "fruit" : "milk";

const DOSE_RULES: Record<StabilizerRecipeKind, Record<"neutro5" | "base50", { solids: number; value: number; step: number; tol: number }>> = {
  milk: {
    neutro5: { solids: 34, value: 0.5, step: 0.01, tol: 0.01 },
    base50: { solids: 34, value: 3.8, step: 0.07, tol: 0.07 },
  },
  fruit: {
    neutro5: { solids: 27, value: 0.5, step: 0.01, tol: 0.01 },
    base50: { solids: 28, value: 3.5, step: 0.07, tol: 0.07 },
  },
};

export interface StabilizerDoseCheck {
  doseType: "neutro5" | "base50";
  kind: StabilizerRecipeKind;
  totalSolids: number;
  recommendedPct: number;
  tolerance: number;
  actualPct: number;
  actualGrams: number;
  /** Διαφορά σε γραμμάρια: θετική = περισσεύουν, αρνητική = λείπουν */
  deltaGrams: number;
  status: "ok" | "low" | "high";
}

/** Έλεγχος δόσης σταθεροποιητή σύμφωνα με τον κανόνα ολικών στερεών */
export function stabilizerDoseCheck(
  a: Pick<RecipeAnalysis, "totalSolids" | "totalWeight" | "stabilizerDoseType" | "stabilizerDosePct" | "stabilizerDoseGrams">,
  recipeType?: string | null,
): StabilizerDoseCheck | null {
  if (a.stabilizerDoseType !== "neutro5" && a.stabilizerDoseType !== "base50") return null;
  if (a.totalWeight <= 0) return null;
  const kind = stabilizerRecipeKind(recipeType);
  const rule = DOSE_RULES[kind][a.stabilizerDoseType];
  const recommendedPct = Math.max(0, rule.value - rule.step * (a.totalSolids - rule.solids));
  const actualPct = a.stabilizerDosePct;
  const status = actualPct < recommendedPct - rule.tol ? "low" : actualPct > recommendedPct + rule.tol ? "high" : "ok";
  return {
    doseType: a.stabilizerDoseType,
    kind,
    totalSolids: a.totalSolids,
    recommendedPct,
    tolerance: rule.tol,
    actualPct,
    actualGrams: a.stabilizerDoseGrams,
    deltaGrams: a.stabilizerDoseGrams - (recommendedPct / 100) * a.totalWeight,
    status,
  };
}

// ---- Συνταγή ----

export interface RecipeLine {
  /** ποσότητα σε γραμμάρια — η ποσότητα συνταγής είναι πάντα μάζα */
  grams: number;
  material: MaterialComposition & {
    /** κόστος ανά γραμμάριο σε εκατοστά του λεπτού (από το avgCostHundredths του GenericItem) */
    costHundredthsPerGram?: number | null;
    /** για είδη σε τεμάχια: πόσα γραμμάρια ζυγίζει ένα τεμάχιο (π.χ. αυγό 55 g) */
    gramsPerPiece?: number | null;
  };
}

/** Γραμμάρια συνταγής → τεμάχια, για είδη που μετρώνται σε τεμάχια. 0 αν δεν έχει οριστεί βάρος τεμαχίου. */
export function piecesFromGrams(m: { gramsPerPiece?: number | null }, grams: number): number {
  const gpp = num(m.gramsPerPiece);
  return gpp > 0 ? num(grams) / gpp : 0;
}

/**
 * Μέσο κόστος ανά 1.000 βασικές μονάδες (εκατοστά λεπτού) → κόστος ανά γραμμάριο συνταγής.
 * Μάζα/όγκος: μέσω του toBase της μονάδας (1 g = 1000 mg, 1 ml νερού ≈ 1 g).
 * Τεμάχια: μέσω του βάρους τεμαχίου· χωρίς βάρος δεν κοστολογείται ανά γραμμάριο.
 */
export function costPerGramHundredths(item: { avgCostHundredths: number; baseUnit: { dimension: string; toBase: number }; gramsPerPiece?: number | null }): number {
  const avg = num(item.avgCostHundredths);
  if (avg <= 0) return 0;
  if (item.baseUnit.dimension === "count") {
    const gpp = num(item.gramsPerPiece);
    return gpp > 0 ? avg / 1000 / gpp : 0;
  }
  return item.baseUnit.toBase > 0 ? (avg * 1000) / item.baseUnit.toBase : 0;
}

export interface RecipeAnalysis {
  totalWeight: number;
  totalSolids: number;
  fat: number;
  msnf: number;
  sugars: number;
  otherSolids: number;
  water: number;
  lactose: number;
  stabilizer: number;
  emulsifier: number;
  cocoaNonfat: number;
  salt: number;
  alcohol: number;
  pac: number;
  pod: number;
  lactoseWaterRatio: number;
  /** Γεύση γάλακτος = διαθέσιμες πρωτεΐνες × 80% */
  milkFlavour: number;
  /** Πρωτεΐνες γάλακτος (% της μάζας) */
  milkProtein: number;
  /** Πρωτεΐνες γάλακτος ως % των ολικών στερεών (ιδανικό 10) */
  milkProteinOverSolids: number;
  totalProtein: number;
  totalProteinOverSolids: number;
  sugarsOverSolids: number;
  stabilizerGPerKg: number;
  stabilizerDoseType: StabilizerDoseType;
  stabilizerDosePct: number;
  stabilizerDoseGrams: number;
  fatMsnfBalance: number;
  /** Αρχικό σημείο πήξης (°C) — Goff & Hartel */
  freezingPoint: number;
  afpFactor: number;
  afpReason: string;
  afpChoices: AfpRule[];
  afpBorderline: boolean;
  /** Θερμοκρασία σερβιρίσματος = −PAC / AFP */
  servingTemp: number;
  /** % παγωμένου νερού στη θερμοκρασία σερβιρίσματος */
  frozenAtServing: number;
  /** % παγωμένου νερού στους −12 °C / −18 °C */
  frozenAtMinus12: number;
  frozenAtMinus18: number;
  /** Δείκτης σκληρότητας = % παγωμένου νερού στους −12 °C */
  hardnessIndex: number;
  /** Κόστος σε εκατοστά του λεπτού (ακέραιοι) — ανά κιλό και ανά δόση */
  costPerKgHundredths: number;
  costBatchHundredths: number;
}

const EMPTY: RecipeAnalysis = {
  totalWeight: 0, totalSolids: 0, fat: 0, msnf: 0, sugars: 0, otherSolids: 0, water: 0, lactose: 0,
  stabilizer: 0, emulsifier: 0, cocoaNonfat: 0, salt: 0, alcohol: 0, pac: 0, pod: 0,
  lactoseWaterRatio: 0, milkFlavour: 0, milkProtein: 0, milkProteinOverSolids: 0,
  totalProtein: 0, totalProteinOverSolids: 0, sugarsOverSolids: 0, stabilizerGPerKg: 0,
  stabilizerDoseType: "none", stabilizerDosePct: 0, stabilizerDoseGrams: 0, fatMsnfBalance: 0,
  freezingPoint: 0, afpFactor: 2.4, afpReason: "", afpChoices: [], afpBorderline: false,
  servingTemp: 0, frozenAtServing: 0, frozenAtMinus12: 0, frozenAtMinus18: 0, hardnessIndex: 0,
  costPerKgHundredths: 0, costBatchHundredths: 0,
};

// ---- AFP Factor (αυτόματος, από τα χαρακτηριστικά της συνταγής) ----

export interface AfpFactorInput {
  /** % της συνολικής μάζας από είδη πολύ υψηλής οξύτητας */
  veryHighAcidPct: number;
  /** % της συνολικής μάζας από είδη υψηλής οξύτητας */
  highAcidPct: number;
  hasCocoa: boolean;
  hasAlcohol: boolean;
  hasStarch: boolean;
  noDairy: boolean;
  isSorbet?: boolean;
  totalSolids: number;
  fat: number;
}

/** Ελάχιστο ποσοστό όξινου είδους για να μετρήσει η οξύτητα */
export const ACIDITY_MIN_PCT = 7;

export interface AfpRule {
  factor: number;
  reason: string;
  /** Εφαρμόζεται άμεσα στη συνταγή */
  active: boolean;
  /** Βρίσκεται εντός περιθωρίου από το όριο του κανόνα */
  borderline: boolean;
}

/** Περιθώριο (±%) για να θεωρηθεί μια συνταγή «οριακή» στον AFP */
export const AFP_MARGIN = 1;

/** Όλοι οι κανόνες AFP με κατάσταση ενεργός/οριακός */
export function afpFactorRules(i: AfpFactorInput, margin: number = AFP_MARGIN): AfpRule[] {
  const rules: AfpRule[] = [];
  // Κανόνας με απόλυτη προτεραιότητα: σοκολάτα / κακάο → πάντα 2,3
  rules.push({ factor: 2.3, reason: "Σοκολάτα / κακάο", active: i.hasCocoa, borderline: false });
  // Πολύ όξινα φρούτα (≥7% του μίγματος) → 2,1
  rules.push({ factor: 2.1, reason: "Πολύ όξινα φρούτα", active: i.veryHighAcidPct >= ACIDITY_MIN_PCT, borderline: false });
  // Sorbet: χωρίς γαλακτοκομικά και ουσιαστικά χωρίς λίπος
  rules.push({ factor: 2.5, reason: "Sorbet", active: i.isSorbet ?? (i.noDairy && i.fat < 1), borderline: false });
  rules.push({ factor: 2.6, reason: i.hasAlcohol ? "Αλκοολούχο προϊόν" : "Αμυλούχο προϊόν", active: i.hasAlcohol || i.hasStarch, borderline: false });
  rules.push({ factor: 2.5, reason: "Vegan / χωρίς γαλακτοκομικά", active: i.noDairy, borderline: false });

  const solidsHighActive = i.totalSolids > 43 || i.fat > 12;
  rules.push({ factor: 2.5, reason: "Στ. στερεά >43% / Λίπος >12%", active: solidsHighActive, borderline: !solidsHighActive && (i.totalSolids > 43 - margin || i.fat > 12 - margin) });

  const solidsMidActive = i.totalSolids >= 40 && i.totalSolids <= 43;
  rules.push({ factor: 2.4, reason: "Στ. στερεά 40–43%", active: solidsMidActive, borderline: !solidsMidActive && i.totalSolids >= 40 - margin && i.totalSolids <= 43 + margin });

  const fatHighActive = i.fat > 10;
  rules.push({ factor: 2.4, reason: "Λίπος >10%", active: fatHighActive, borderline: !fatHighActive && i.fat > 10 - margin });

  const lowSolidsFatActive = i.totalSolids < 40 && i.fat < 10;
  rules.push({ factor: 2.3, reason: "Στ. στερεά <40%, Λίπος <10%", active: lowSolidsFatActive, borderline: !lowSolidsFatActive && (i.totalSolids < 40 + margin && i.fat < 10 + margin) });

  rules.push({ factor: 2.4, reason: "Προεπιλογή", active: true, borderline: false });
  return rules;
}

/** Αυτόματος AFP Factor με βάση τα χαρακτηριστικά της συνταγής */
export function afpFactorInfo(i: AfpFactorInput): { factor: number; reason: string } {
  const active = afpFactorRules(i).find((r) => r.active);
  return active ? { factor: active.factor, reason: active.reason } : { factor: 2.4, reason: "Προεπιλογή" };
}

/** Επιλογές AFP που είναι ενεργές ή οριακές για τη συνταγή */
export const afpFactorChoices = (i: AfpFactorInput): AfpRule[] => afpFactorRules(i).filter((r) => r.active || r.borderline);

/** Είναι η συνταγή οριακή για τον AFP; */
export const isAfpBorderline = (i: AfpFactorInput): boolean => afpFactorRules(i).some((r) => r.borderline);

// ---- Η ανάλυση ----

export function analyzeRecipe(lines: RecipeLine[], recipeType?: string | null): RecipeAnalysis {
  const totalWeight = lines.reduce((s, l) => s + num(l.grams), 0);
  if (totalWeight <= 0) return { ...EMPTY };

  let fat = 0, msnf = 0, sugars = 0, lactose = 0, stabilizer = 0, emulsifier = 0,
    cocoaNonfat = 0, salt = 0, alcohol = 0, otherSolidsRaw = 0,
    proteinAvailable = 0, otherProtein = 0, pacTotal = 0, podTotal = 0, veryHighAcidG = 0, costHundredths = 0;
  let hasCocoa = false;
  let hasStarch = false;

  for (const line of lines) {
    const g = num(line.grams);
    if (g <= 0) continue;
    const m = line.material;
    const f = g / 100;
    fat += num(m.fatPct) * f;
    msnf += num(m.msnfPct) * f;
    sugars += materialSugars(m) * f;
    lactose += materialLactose(m) * f;
    stabilizer += num(m.stabilizerPct) * f;
    emulsifier += num(m.emulsifierPct) * f;
    cocoaNonfat += num(m.cocoaNonfatPct) * f;
    salt += num(m.saltPct) * f;
    alcohol += alcoholByWeight(num(m.alcoholPct)) * f;
    otherSolidsRaw += (num(m.otherSolidsPct) + num(m.fiberPct) + num(m.otherProteinPct)) * f;
    proteinAvailable += num(m.proteinAvailablePct) * f;
    otherProtein += num(m.otherProteinPct) * f;
    pacTotal += materialPac(m) * f;
    podTotal += materialPod(m) * f;
    costHundredths += g * num(m.costHundredthsPerGram);
    if (m.acidityLevel === "very_high") veryHighAcidG += g;
    if (m.containsCocoa || num(m.cocoaNonfatPct) > 0) hasCocoa = true;
    if (m.containsStarch) hasStarch = true;
  }

  // Η αιθανόλη δεν είναι στερεό: μένει εκτός ολικών στερεών (επηρεάζει μόνο το PAC)
  const otherSolids = otherSolidsRaw + cocoaNonfat + stabilizer + emulsifier + salt;
  const totalSolidsG = fat + msnf + sugars + otherSolids;
  const waterG = totalWeight - totalSolidsG;
  const pct = (g: number) => (g / totalWeight) * 100;

  const water = pct(waterG);
  const pac = pct(pacTotal);
  const pod = pct(podTotal);
  const goffInput = { water, msnf: pct(msnf), se: pac };
  const freezingPoint = water > 0 ? tempAtFrozenFraction(goffInput, 0) : 0;
  const frozenAt = (t: number) => frozenPctAt(goffInput, t).pct;
  const totalSolidsPct = pct(totalSolidsG);
  const fatPct = pct(fat);
  const afpInput: AfpFactorInput = {
    veryHighAcidPct: pct(veryHighAcidG),
    highAcidPct: 0,
    hasCocoa,
    hasAlcohol: alcohol > 0,
    hasStarch,
    noDairy: msnf <= 0 || recipeType === "nonDairy",
    totalSolids: totalSolidsPct,
    fat: fatPct,
    ...(recipeType ? { isSorbet: recipeType === "sorbet" } : {}),
  };
  const afpInfo = afpFactorInfo(afpInput);
  const factor = afpInfo.factor;
  // Θερμοκρασία σερβιρίσματος = − (Συνολικό PAC / AFP Factor)
  const servingTemp = pac > 0 ? -(pac / factor) : 0;

  // Δόση σταθεροποιητή/βάσης: μετράμε το βάρος του ίδιου του είδους
  let neutroG = 0;
  let baseG = 0;
  for (const line of lines) {
    const g = num(line.grams);
    if (g <= 0) continue;
    const s = num(line.material.stabilizerPct) + num(line.material.emulsifierPct);
    if (s <= 0) continue;
    if (s >= STABILIZER_PURE_THRESHOLD) neutroG += g;
    else baseG += g;
  }
  const doseType: StabilizerDoseType = neutroG > 0 && baseG > 0 ? "mixed" : neutroG > 0 ? "neutro5" : baseG > 0 ? "base50" : "none";
  const doseG = doseType === "neutro5" ? neutroG : doseType === "base50" ? baseG : neutroG + baseG;

  return {
    totalWeight,
    totalSolids: totalSolidsPct,
    fat: fatPct,
    msnf: pct(msnf),
    sugars: pct(sugars),
    otherSolids: pct(otherSolids),
    water,
    lactose: pct(lactose),
    stabilizer: pct(stabilizer),
    emulsifier: pct(emulsifier),
    cocoaNonfat: pct(cocoaNonfat),
    salt: pct(salt),
    alcohol: pct(alcohol),
    pac,
    pod,
    lactoseWaterRatio: lactose > 0 && waterG > 0 ? (lactose / waterG) * 100 : 0,
    milkFlavour: pct(proteinAvailable) * 0.8,
    milkProtein: pct(proteinAvailable),
    milkProteinOverSolids: totalSolidsG > 0 ? (proteinAvailable / totalSolidsG) * 100 : 0,
    totalProtein: pct(proteinAvailable + otherProtein),
    totalProteinOverSolids: totalSolidsG > 0 ? ((proteinAvailable + otherProtein) / totalSolidsG) * 100 : 0,
    sugarsOverSolids: totalSolidsG > 0 ? (sugars / totalSolidsG) * 100 : 0,
    stabilizerGPerKg: ((stabilizer + emulsifier) / totalWeight) * 1000,
    stabilizerDoseType: doseType,
    stabilizerDosePct: pct(doseG),
    stabilizerDoseGrams: doseG,
    fatMsnfBalance: msnf > 0 ? fat / msnf : 0,
    freezingPoint,
    afpFactor: factor,
    afpReason: afpInfo.reason,
    afpChoices: afpFactorChoices(afpInput),
    afpBorderline: isAfpBorderline(afpInput),
    servingTemp,
    frozenAtServing: servingTemp < 0 ? frozenAt(servingTemp) : 0,
    frozenAtMinus12: frozenAt(SERVING_TEMP_C),
    frozenAtMinus18: frozenAt(STORAGE_TEMP_C),
    hardnessIndex: frozenAt(SERVING_TEMP_C),
    costPerKgHundredths: Math.round((costHundredths / totalWeight) * 1000),
    costBatchHundredths: Math.round(costHundredths),
  };
}

// ---- Στόχοι ανά τύπο συνταγής ----

export interface Target {
  metric: string;
  min: number | null;
  max: number | null;
}

export type TargetStatus = "ok" | "low" | "high" | "none";

export function evaluateTarget(value: number, target?: Target): TargetStatus {
  if (!target) return "none";
  if (target.min != null && value < num(target.min)) return "low";
  if (target.max != null && value > num(target.max)) return "high";
  return "ok";
}

/** Οι τύποι συνταγής με ελληνική ετικέτα */
export const RECIPE_TYPES = [
  { value: "cream", label: "Κρέμας (λευκές βάσεις)" },
  { value: "chocolate", label: "Σοκολάτας" },
  { value: "sorbet", label: "Sorbet φρούτου" },
  { value: "nonDairy", label: "Χωρίς γαλακτοκομικά / vegan" },
  { value: "other", label: "Λοιπά" },
] as const;
export const RECIPE_TYPE_LABEL: Record<string, string> = Object.fromEntries(RECIPE_TYPES.map((t) => [t.value, t.label]));

/**
 * Εύρος-στόχος ανά τύπο συνταγής (τιμές από την επαγγελματική πρακτική του παλιού συστήματος).
 * Μετρικά: totalSolids, fat, msnf, sugars, pac, pod, lactoseWater, stabilizerGPerKg.
 */
export const RECIPE_TARGETS: Record<string, Record<string, [number | null, number | null]>> = {
  cream: { totalSolids: [34, 42], fat: [6, 12], msnf: [7, 11], sugars: [16, 22], pac: [22, 28], pod: [12, 18], lactoseWaterRatio: [0, 10.5], stabilizerGPerKg: [3, 6] },
  chocolate: { totalSolids: [36, 46], fat: [7, 14], msnf: [6, 10], sugars: [18, 26], pac: [22, 30], pod: [14, 20], lactoseWaterRatio: [0, 10.5], stabilizerGPerKg: [2, 5] },
  sorbet: { totalSolids: [28, 36], fat: [0, 2], msnf: [0, 2], sugars: [22, 32], pac: [26, 34], pod: [18, 26], lactoseWaterRatio: [0, 10.5], stabilizerGPerKg: [3, 7] },
  nonDairy: { totalSolids: [32, 42], fat: [4, 12], msnf: [0, 3], sugars: [16, 24], pac: [22, 30], pod: [12, 20], lactoseWaterRatio: [0, 10.5], stabilizerGPerKg: [3, 7] },
  other: { totalSolids: [30, 45], fat: [0, 15], msnf: [0, 12], sugars: [14, 32], pac: [20, 34], pod: [10, 26], lactoseWaterRatio: [0, 10.5], stabilizerGPerKg: [0, 8] },
};

/** Ο στόχος μιας μετρικής για τύπο συνταγής (άγνωστος τύπος → other) */
export function targetFor(recipeType: string | null | undefined, metric: keyof RecipeAnalysis | string): Target | undefined {
  const t = RECIPE_TARGETS[recipeType ?? "other"] ?? RECIPE_TARGETS.other!;
  const range = t[metric];
  return range ? { metric, min: range[0], max: range[1] } : undefined;
}

export const METRIC_LABEL: Record<string, string> = {
  totalSolids: "Ολικά στερεά",
  fat: "Λιπαρά",
  msnf: "MSNF",
  sugars: "Σάκχαρα",
  pac: "PAC (αντιψυκτική)",
  pod: "POD (γλυκύτητα)",
  lactoseWaterRatio: "Λακτόζη/νερό",
  stabilizerGPerKg: "Σταθεροποιητής g/kg",
};

// ---- Μπάρες ισορροπίας (θέση τιμής σε σχέση με το εύρος στόχου) ----

export interface BalanceBar {
  metric: string;
  value: number;
  status: TargetStatus;
  /** θέσεις σε % του πλάτους της μπάρας */
  rangeLeft: number | null;
  rangeWidth: number | null;
  marker: number;
  /** πόσο απέχει από το πλησιέστερο όριο (0 όταν είναι εντός) */
  gap: number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/**
 * Κλίμακα της μπάρας: το εύρος στόχου στο μέσο, με περιθώριο 60% του εύρους σε κάθε πλευρά
 * (ώστε μια τιμή λίγο εκτός να φαίνεται κοντά στο όριο). Αν η τιμή είναι πιο μακριά, η
 * κλίμακα μεγαλώνει ώστε ο δείκτης να μένει μέσα στη μπάρα. Χωρίς στόχο: κλίμακα από 0.
 */
export function balanceBar(metric: string, value: number, target?: Target): BalanceBar {
  const v = Number.isFinite(value) ? value : 0;
  const status = evaluateTarget(v, target);
  const min = target?.min ?? null;
  const max = target?.max ?? null;

  if (min == null && max == null) {
    const hi = Math.max(Math.abs(v) * 1.5, 1);
    return { metric, value: v, status, rangeLeft: null, rangeWidth: null, marker: clamp((v / hi) * 100), gap: 0 };
  }

  // Μονόπλευρος στόχος: εικονικό άλλο όριο για να σχεδιαστεί η κλίμακα
  const ref = Math.max(Math.abs(min ?? max ?? 0), Math.abs(v), 1);
  const lo = min ?? Math.min(0, v);
  const hi = max ?? Math.max(lo + ref * 0.5, v * 1.2);
  const width = Math.max(hi - lo, ref * 0.05);
  // κλίμακα: από το min − 60% του εύρους έως max + 60%, μεγαλώνει αν η τιμή ξεφεύγει
  const pad = width * 0.6;
  const scaleLo = Math.min(lo - pad, v);
  const scaleHi = Math.max(hi + pad, v);
  const span = scaleHi - scaleLo || 1;
  const marker = clamp(((v - scaleLo) / span) * 100);
  const rangeLeft = clamp(((lo - scaleLo) / span) * 100);
  const rangeWidth = clamp(((hi - lo) / span) * 100);
  const gap = v < lo ? lo - v : v > hi ? v - hi : 0;
  return { metric, value: v, status, rangeLeft, rangeWidth, marker, gap };
}

/** Στόχος πρωτεϊνών γάλακτος: 10% των ολικών στερεών (±0,5) */
export const MILK_PROTEIN_TARGET = { value: 10, tolerance: 0.5 } as const;

const SCALE_LABELS = { veryLow: "Πολύ χαμηλή", low: "Χαμηλή", medium: "Μεσαία", high: "Υψηλή", veryHigh: "Πολύ υψηλή", standard: "Στάνταρντ" } as const;

export function milkFlavourLabel(value: number): string {
  if (value < 1.8) return SCALE_LABELS.veryLow;
  if (value <= 2.1) return SCALE_LABELS.low;
  if (value <= 2.4) return SCALE_LABELS.medium;
  if (value <= 2.8) return SCALE_LABELS.high;
  return SCALE_LABELS.veryHigh;
}

export function milkProteinLabel(value: number): string {
  if (value <= 0) return "";
  if (value < MILK_PROTEIN_TARGET.value - MILK_PROTEIN_TARGET.tolerance) return "Χαμηλές";
  if (value > MILK_PROTEIN_TARGET.value + MILK_PROTEIN_TARGET.tolerance) return "Υψηλές";
  return "";
}

export function lactoseWaterLabel(value: number): string {
  if (value < 7) return SCALE_LABELS.veryLow;
  if (value <= 9) return SCALE_LABELS.standard;
  if (value <= 11) return SCALE_LABELS.high;
  return SCALE_LABELS.veryHigh;
}
