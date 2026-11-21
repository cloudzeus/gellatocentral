// Καμπύλη ψύξης (freezing curve) μίγματος παγωτού — μέθοδος Goff & Hartel
// (Ice Cream, 7th ed., κεφ. «Freezing point depression and the freezing curve»).
// Μεταφορά από τον αποδεδειγμένο κώδικα του παλιού Gelato System (ίδιοι αριθμοί σε κάθε οθόνη/PDF).
//
// Όλα τα μεγέθη εισόδου είναι g ανά 100 g μίγματος.
//
//   W   = νερό (g/100 g μίγματος)
//   SE  = ισοδύναμα σακχαρόζης (g/100 g μίγματος) = PAC/100 κάθε υλικού (ζάχαρη = 1).
//         Περιλαμβάνει λακτόζη, δεξτρόζη/φρουκτόζη/ιμβερτοσάκχαρο, σιρόπι γλυκόζης, αλάτι
//         και αιθανόλη — δηλαδή ακριβώς το PAC της τεχνικής ανάλυσης (recipe-analysis.ts).
//   MSNF = στερεά γάλακτος άνευ λίπους — τα άλατα γάλακτος μετρούν χωριστά:
//
//   FPD_SE(c)  = πίνακας σημείου πήξης διαλυμάτων σακχαρόζης (Leighton 1927), c = SE × 100 / W.
//   FPD_SA     = 2,37 × MSNF / W  (°C) — άλατα γάλακτος.
//   Σημείο πήξης = −(FPD_SE + FPD_SA).
//
// Πέρα από τα 180 g/100 g νερού (τέλος του πίνακα) η τιμή προεκτείνεται γραμμικά και μόνο έως
// MAX_SUCROSE_PER_100G_WATER· πιο πέρα η καμπύλη σταματά (περιοχή υαλώδους μετάπτωσης).
// Είναι υπολογισμός, όχι μέτρηση.

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Θερμοκρασία βιτρίνας */
export const SERVING_TEMP_C = -12;
/** Θερμοκρασία κατάψυξης/αποθήκευσης */
export const STORAGE_TEMP_C = -18;

/** Συντελεστής κρυοσκοπικής ταπείνωσης αλάτων γάλακτος (°C) — Goff & Hartel */
export const MILK_SALTS_FACTOR = 2.37;

/** Μέγιστο ποσοστό παγωμένου νερού που υπολογίζεται */
export const MAX_FROZEN_FRACTION = 0.95;

/**
 * Όριο προέκτασης του πίνακα (g σακχαρόζης / 100 g νερού) ≈ 80% στερεά στη μη παγωμένη φάση
 * (μέγιστη κρυοσυμπυκνωμένη φάση Cg′, περιοχή Tg′ ≈ −32 °C). Πιο πέρα δεν σχηματίζεται πάγος.
 */
export const MAX_SUCROSE_PER_100G_WATER = 400;

/**
 * Ταπείνωση σημείου πήξης διαλυμάτων σακχαρόζης: [g σακχαρόζης / 100 g νερού, FPD °C].
 * Πίνακας Goff & Hartel (από Leighton 1927), βήμα 3 g.
 */
export const SUCROSE_FPD_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [3, 0.18], [6, 0.35], [9, 0.53], [12, 0.72], [15, 0.9], [18, 1.1], [21, 1.29], [24, 1.47],
  [27, 1.67], [30, 1.86], [33, 2.03], [36, 2.21], [39, 2.4], [42, 2.6], [45, 2.78], [48, 2.99],
  [51, 3.2], [54, 3.42], [57, 3.63], [60, 3.85], [63, 4.1], [66, 4.33], [69, 4.54], [72, 4.77],
  [75, 5.0], [78, 5.26], [81, 5.53], [84, 5.77], [87, 5.99], [90, 6.23], [93, 6.5], [96, 6.8],
  [99, 7.04], [102, 7.32], [105, 7.56], [108, 7.8], [111, 8.04], [114, 8.33], [117, 8.62],
  [120, 8.92], [123, 9.19], [126, 9.45], [129, 9.71], [132, 9.96], [135, 10.22], [138, 10.47],
  [141, 10.72], [144, 10.97], [147, 11.19], [150, 11.41], [153, 11.63], [156, 11.88], [159, 12.14],
  [162, 12.4], [165, 12.67], [168, 12.88], [171, 13.08], [174, 13.28], [177, 13.48], [180, 13.68],
];

const TABLE_MAX = SUCROSE_FPD_TABLE[SUCROSE_FPD_TABLE.length - 1]![0];

/**
 * FPD (°C, θετικός αριθμός) διαλύματος σακχαρόζης c g / 100 g νερού.
 * Γραμμική παρεμβολή· πέρα από τον πίνακα γραμμική προέκταση με την τελευταία κλίση,
 * έως MAX_SUCROSE_PER_100G_WATER (πιο πέρα επιστρέφει την τιμή του ορίου).
 */
export function sucroseFpd(c: number): number {
  const x = Math.max(0, num(c));
  const t = SUCROSE_FPD_TABLE;
  if (x <= TABLE_MAX) {
    for (let i = 1; i < t.length; i++) {
      const [c1, d1] = t[i]!;
      if (x <= c1) {
        const [c0, d0] = t[i - 1]!;
        return d0 + ((d1 - d0) * (x - c0)) / (c1 - c0);
      }
    }
  }
  const [cA, dA] = t[t.length - 2]!;
  const [cB, dB] = t[t.length - 1]!;
  const slope = (dB - dA) / (cB - cA);
  return dB + slope * (Math.min(x, MAX_SUCROSE_PER_100G_WATER) - cB);
}

export interface FreezingCurveInput {
  /** νερό, g / 100 g μίγματος */
  water: number;
  /** στερεά γάλακτος άνευ λίπους, g / 100 g μίγματος */
  msnf: number;
  /** ισοδύναμα σακχαρόζης (= PAC), g / 100 g μίγματος */
  se: number;
}

export interface FreezingCurvePoint {
  /** % του νερού που έχει παγώσει (0–95) */
  frozenPct: number;
  /** θερμοκρασία ισορροπίας, °C */
  temp: number;
  /** η συγκέντρωση είναι πέρα από τον πίνακα (προέκταση) */
  extrapolated: boolean;
}

export interface FreezingCurve {
  /** αρχικό σημείο πήξης, °C */
  initialFreezingPoint: number;
  points: FreezingCurvePoint[];
  /** % παγωμένου νερού στη βιτρίνα (−12 °C) */
  frozenAtServing: number;
  /** % παγωμένου νερού στην κατάψυξη (−18 °C) */
  frozenAtStorage: number;
  /** πάγος ως % της μάζας του μίγματος, στη βιτρίνα */
  iceOfMixAtServing: number;
  /** πάγος ως % της μάζας του μίγματος, στην κατάψυξη */
  iceOfMixAtStorage: number;
  /** η καμπύλη δεν φτάνει τη θερμοκρασία (τιμή = όριο υπολογισμού) */
  servingBeyondCurve: boolean;
  storageBeyondCurve: boolean;
  /** κάποιο σημείο της καμπύλης προέκυψε από προέκταση του πίνακα */
  extrapolated: boolean;
  /** οι τιμές βιτρίνας / κατάψυξης βασίζονται σε προέκταση του πίνακα (> 180 g / 100 g νερού) */
  servingExtrapolated: boolean;
  storageExtrapolated: boolean;
  water: number;
  msnf: number;
  se: number;
}

/** Θερμοκρασία ισορροπίας όταν έχει παγώσει το ποσοστό f του νερού */
export function tempAtFrozenFraction(input: FreezingCurveInput, f: number): number {
  const w = num(input.water);
  if (w <= 0) return 0;
  const wl = w * (1 - Math.min(Math.max(f, 0), 0.999));
  const c = (Math.max(0, num(input.se)) * 100) / wl;
  const salts = (MILK_SALTS_FACTOR * Math.max(0, num(input.msnf))) / wl;
  return -(sucroseFpd(c) + salts);
}

/** Μέγιστο f για το οποίο η συγκέντρωση μένει μέσα στο όριο προέκτασης */
function maxFrozenFraction(input: FreezingCurveInput): number {
  const se = Math.max(0, num(input.se));
  const w = num(input.water);
  if (se <= 0 || w <= 0) return MAX_FROZEN_FRACTION;
  // c' = se·100 / (w(1−f)) ≤ MAX  →  f ≤ 1 − se·100 / (w·MAX)
  return Math.max(0, Math.min(MAX_FROZEN_FRACTION, 1 - (se * 100) / (w * MAX_SUCROSE_PER_100G_WATER)));
}

/**
 * % παγωμένου νερού (0–95) σε θερμοκρασία temp. Διχοτόμηση πάνω στη μονότονη T(f).
 * beyond = true όταν η θερμοκρασία είναι κάτω από το όριο υπολογισμού.
 */
export function frozenPctAt(
  input: FreezingCurveInput,
  temp: number,
): { pct: number; beyond: boolean } {
  if (num(input.water) <= 0) return { pct: 0, beyond: false };
  const fp = tempAtFrozenFraction(input, 0);
  if (temp >= fp) return { pct: 0, beyond: false };
  const fMax = maxFrozenFraction(input);
  if (tempAtFrozenFraction(input, fMax) > temp) return { pct: fMax * 100, beyond: true };
  let lo = 0;
  let hi = fMax;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tempAtFrozenFraction(input, mid) > temp) lo = mid;
    else hi = mid;
  }
  return { pct: ((lo + hi) / 2) * 100, beyond: false };
}

const beyondTable = (input: FreezingCurveInput, f: number) =>
  f > 0 && (input.se * 100) / (input.water * (1 - f)) > TABLE_MAX;

/** Πλήρης καμπύλη ψύξης. null όταν το μίγμα δεν έχει νερό. */
export function freezingCurve(
  input: FreezingCurveInput,
  temps: { serving?: number; storage?: number } = {},
): FreezingCurve | null {
  const water = num(input.water);
  if (!(water > 0)) return null;
  const clean: FreezingCurveInput = {
    water,
    msnf: Math.max(0, num(input.msnf)),
    se: Math.max(0, num(input.se)),
  };
  const fMax = maxFrozenFraction(clean);
  const points: FreezingCurvePoint[] = [];
  for (let i = 0; i <= Math.round(MAX_FROZEN_FRACTION * 100); i++) {
    const f = i / 100;
    if (f > fMax + 1e-9) break;
    const wl = water * (1 - f);
    points.push({
      frozenPct: i,
      temp: tempAtFrozenFraction(clean, f),
      extrapolated: (clean.se * 100) / wl > TABLE_MAX,
    });
  }
  const serving = frozenPctAt(clean, temps.serving ?? SERVING_TEMP_C);
  const storage = frozenPctAt(clean, temps.storage ?? STORAGE_TEMP_C);
  return {
    initialFreezingPoint: tempAtFrozenFraction(clean, 0),
    points,
    frozenAtServing: serving.pct,
    frozenAtStorage: storage.pct,
    iceOfMixAtServing: (serving.pct / 100) * water,
    iceOfMixAtStorage: (storage.pct / 100) * water,
    servingBeyondCurve: serving.beyond,
    storageBeyondCurve: storage.beyond,
    extrapolated: points.some((p) => p.extrapolated),
    servingExtrapolated: beyondTable(clean, serving.pct / 100),
    storageExtrapolated: beyondTable(clean, storage.pct / 100),
    water,
    msnf: clean.msnf,
    se: clean.se,
  };
}
