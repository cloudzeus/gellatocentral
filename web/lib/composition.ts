// Τεχνική σύσταση είδους (% ανά 100 g): μετατροπές φόρμας ↔ βάση και ανάγνωση για τον αναλυτή
// συνταγών. Στη βάση (Composition) τα ποσοστά κρατιούνται σε χιλιοστά της εκατοστιαίας μονάδας
// (3,5% → 3500, Int) — η φόρμα δείχνει κανονικά ποσοστά με κόμμα. Καθαρές συναρτήσεις — node --test.
import type { MaterialComposition } from "./recipe-analysis.ts";

// Τα 14 αλλεργιογόνα του Καν. (ΕΕ) 1169/2011, Παράρτημα II — κλειδί και ελληνική ετικέτα
export const ALLERGENS: [key: string, label: string][] = [
  ["gluten", "Δημητριακά με γλουτένη"],
  ["crustaceans", "Καρακινοειδή"],
  ["eggs", "Αυγά"],
  ["fish", "Ψάρια"],
  ["peanuts", "Αράπικα φιστίκια"],
  ["soy", "Σόγια"],
  ["milk", "Γάλα (λακτόζη)"],
  ["nuts", "Ξηροί καρποί με κέλυφος"],
  ["celery", "Σέλινο"],
  ["mustard", "Μουστάρδα"],
  ["sesame", "Σουσάμι"],
  ["sulphites", "Θειώδη (SO₂ > 10 mg/kg)"],
  ["lupin", "Λούπινο"],
  ["molluscs", "Μαλάκια"],
];
export const ALLERGEN_LABEL: Record<string, string> = Object.fromEntries(ALLERGENS);

export const ACIDITY_OPTIONS: [value: string, label: string][] = [
  ["none", "Καμία"],
  ["high", "Υψηλή (εσπεριδοειδή)"],
  ["very_high", "Πολύ υψηλή (λεμόνι, γιαούρτι)"],
];

/** Ποσοστιαία πεδία της σύστασης: κλειδί φόρμας/ανάλυσης → στήλη βάσης (σε ‰ του %) */
export const PCT_FIELDS = {
  fatPct: "fatPm",
  msnfPct: "msnfPm",
  sucrosePct: "sucrosePm",
  dextrosePct: "dextrosePm",
  glucoseSyrupPct: "glucoseSyrupPm",
  invertSugarPct: "invertSugarPm",
  fructosePct: "fructosePm",
  lactosePct: "lactosePm",
  cocoaNonfatPct: "cocoaNonfatPm",
  stabilizerPct: "stabilizerPm",
  emulsifierPct: "emulsifierPm",
  saltPct: "saltPm",
  alcoholPct: "alcoholPm",
  otherSolidsPct: "otherSolidsPm",
  proteinAvailablePct: "proteinAvailablePm",
  otherProteinPct: "otherProteinPm",
  fiberPct: "fiberPm",
  pacOverride: "pacOverridePm",
  podOverride: "podOverridePm",
  totalSolidsOverride: "totalSolidsOverridePm",
} as const;
export type PctKey = keyof typeof PCT_FIELDS;

// Πεδία που δεν είναι ποσοστό 0–100: οι υπερκαλύψεις PAC/POD μπορεί να ξεπερνούν το 100
// (καθαρή δεξτρόζη 190, αλάτι 585) — όριο 1000. Τα υπόλοιπα είναι πραγματικά ποσοστά.
const OVERRIDE_KEYS: ReadonlySet<string> = new Set(["pacOverride", "podOverride", "totalSolidsOverride"]);

/** Ποσοστό φόρμας → χιλιοστά για τη βάση. Κενό → null· άκυρο ή εκτός ορίου → σφάλμα. */
export const pctToPm = (raw: string, override = false): number | null => {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0 || v > (override ? 1000 : 100)) throw new Error("invalid");
  return Math.round(v * 1000);
};

/** Χιλιοστά της βάσης → κείμενο εισαγωγής με κόμμα (3,5). null → "" */
export const pmToInput = (pm: number | null | undefined): string => (pm == null ? "" : String(pm / 1000).replace(".", ","));

/** Γραμμή Composition της βάσης → MaterialComposition για τον αναλυτή (ποσοστά 0–100) */
export function compositionFromRow(row: Record<string, unknown>): MaterialComposition {
  const m: Record<string, unknown> = {
    glucoseDe: row.glucoseDe ?? null,
    acidityLevel: row.acidityLevel ?? null,
    containsStarch: !!row.containsStarch,
    containsCocoa: !!row.containsCocoa,
  };
  for (const [key, col] of Object.entries(PCT_FIELDS)) m[key] = row[col] == null ? null : Number(row[col]) / 1000;
  return m as unknown as MaterialComposition;
}

/** Η ομάδα πεδίων της φόρμας σύστασης (τίτλος, πεδία με ετικέτα και βοήθεια) — οδηγεί και τις δύο οθόνες */
export const COMPOSITION_GROUPS: { title: string; fields: { key: PctKey | "glucoseDe"; label: string; hint?: string }[] }[] = [
  {
    title: "Γάλακτος & πρωτεΐνες",
    fields: [
      { key: "fatPct", label: "Λιπαρά %" },
      { key: "msnfPct", label: "MSNF %", hint: "Στερεά γάλακτος άνευ λίπους" },
      { key: "proteinAvailablePct", label: "Πρωτεΐνες γάλακτος %", hint: "Οδηγούν την εκτίμηση λακτόζης" },
      { key: "otherProteinPct", label: "Άλλες πρωτεΐνες %", hint: "Αυγό, ξηροί καρποί, φυτικές" },
    ],
  },
  {
    title: "Σάκχαρα",
    fields: [
      { key: "sucrosePct", label: "Ζάχαρη %" },
      { key: "dextrosePct", label: "Δεξτρόζη %" },
      { key: "glucoseSyrupPct", label: "Σιρόπι γλυκόζης %" },
      { key: "glucoseDe", label: "DE σιροπιού", hint: "π.χ. 38 — μόνο αν υπάρχει σιρόπι" },
      { key: "invertSugarPct", label: "Ιμβερτοσάκχαρο %" },
      { key: "fructosePct", label: "Φρουκτόζη %" },
      { key: "lactosePct", label: "Λακτόζη %", hint: "Κενό = εκτίμηση από τα MSNF" },
    ],
  },
  {
    title: "Λοιπά στερεά",
    fields: [
      { key: "cocoaNonfatPct", label: "Απολιπασμένο κακάο %" },
      { key: "stabilizerPct", label: "Σταθεροποιητής %" },
      { key: "emulsifierPct", label: "Γαλακτωματοποιητής %" },
      { key: "saltPct", label: "Αλάτι %" },
      { key: "alcoholPct", label: "Αλκοόλ % vol", hint: "Ο τίτλος της ετικέτας" },
      { key: "fiberPct", label: "Φυτικές ίνες %" },
      { key: "otherSolidsPct", label: "Λοιπά στερεά %" },
    ],
  },
  {
    title: "Υπερκαλύψεις (σπάνια)",
    fields: [
      { key: "totalSolidsOverride", label: "Ολικά στερεά %", hint: "Κενό = αυτόματος υπολογισμός" },
      { key: "pacOverride", label: "PAC ανά 100 g", hint: "Κενό = υπολογισμός από τα σάκχαρα" },
      { key: "podOverride", label: "POD ανά 100 g", hint: "Κενό = υπολογισμός" },
    ],
  },
];

/** Αντιγραφή σύστασης (π.χ. από τον κεντρικό κατάλογο στο γενικό είδος) — χωρίς τα πεδία ταυτότητας */
export function compositionCopyData(row: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const col of Object.values(PCT_FIELDS)) data[col] = row[col] ?? null;
  for (const k of ["glucoseDe", "acidityLevel", "containsStarch", "containsCocoa", "allergensContains", "allergensTraces", "isVegan", "isVegetarian", "isSugarFree", "isGlutenFree", "isLactoseFree", "containsAlcohol"])
    data[k] = row[k];
  return data;
}

/**
 * Δεδομένα φόρμας σύστασης → στήλες βάσης. Επιστρέφει { data } ή { error }.
 * Τα checkboxes έρχονται ως "on"· τα αλλεργιογόνα ως επαναλαμβανόμενα πεδία.
 */
export function compositionFromForm(form: FormData): { data: Record<string, unknown> } | { error: string } {
  const data: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(PCT_FIELDS)) {
    let pm: number | null;
    try {
      pm = pctToPm(String(form.get(key) ?? ""), OVERRIDE_KEYS.has(key));
    } catch {
      const field = COMPOSITION_GROUPS.flatMap((g) => g.fields).find((f) => f.key === key);
      return { error: `«${field?.label ?? key}»: ποσοστό 0–${OVERRIDE_KEYS.has(key) ? "1000" : "100"}, π.χ. 3,5` };
    }
    data[col] = pm;
  }
  const deRaw = String(form.get("glucoseDe") ?? "").trim().replace(",", ".");
  let de: number | null = null;
  if (deRaw !== "") {
    de = Number(deRaw);
    if (!Number.isInteger(de) || de < 1 || de > 100) return { error: "Το DE του σιροπιού είναι ακέραιος 1–100, π.χ. 38" };
  }
  data.glucoseDe = de;
  const acidity = String(form.get("acidityLevel") ?? "none");
  if (!ACIDITY_OPTIONS.some(([v]) => v === acidity)) return { error: "Άγνωστο επίπεδο οξύτητας" };
  data.acidityLevel = acidity;
  for (const flag of ["containsStarch", "containsCocoa", "isVegan", "isVegetarian", "isSugarFree", "isGlutenFree", "isLactoseFree", "containsAlcohol"] as const)
    data[flag] = form.get(flag) === "on";
  const pick = (name: string) => form.getAll(name).map(String).filter((a) => ALLERGEN_LABEL[a]);
  data.allergensContains = pick("allergensContains");
  data.allergensTraces = pick("allergensTraces");
  return { data };
}
