// Μετατροπές μονάδων μέτρησης (docs/analysis/PROCUREMENT-DESIGN.md §4).
// Όλες οι ποσότητες αποθηκεύονται ως ακέραιοι στη βασική μονάδα της διάστασης (mg / ml / τεμάχιο),
// όπως τα χρήματα σε λεπτά. Η μετατροπή επιτρέπεται ΜΟΝΟ μέσα στην ίδια διάσταση·
// g → ml χρειάζεται πυκνότητα και δεν είναι δουλειά αυτού του module.

/** Το ελάχιστο που χρειάζεται από το μοντέλο Unit της βάσης (ή από seed/fixture). */
export type UnitLike = {
  code: string; // "kg", "g", "ml"…
  dimension: string; // mass | volume | count
  toBase: number; // πόσες βασικές μονάδες είναι η μία (g: 1000, kg: 1_000_000, pcs: 1)
};

/** Κλίμακα ακέραιου κόστους: μάζα ανά kg, όγκος ανά l, τεμάχια ανά 1.000 (σε εκατοστά λεπτού). */
export const stockCostScale = (dimension: string): number => dimension === "mass" ? 1_000_000 : 1_000;

/** Ποσότητα σε μονάδα → ακέραιες βασικές μονάδες. Ο πολλαπλασιασμός είναι πάντα ακέραιος. */
export function toBaseUnits(qty: number, unit: UnitLike): number {
  if (!Number.isInteger(qty)) throw new Error(`η ποσότητα σε ${unit.code} πρέπει να είναι ακέραια (δόθηκε ${qty})`);
  return qty * unit.toBase;
}

/** Βασικές μονάδες → ποσότητα σε μονάδα εμφάνισης. Μπορεί να βγει κλασματική (1500 mg → 1,5 g). */
export function fromBaseUnits(baseQty: number, unit: UnitLike): number {
  if (!Number.isInteger(baseQty)) throw new Error(`η ποσότητα βάσης πρέπει να είναι ακέραια (δόθηκε ${baseQty})`);
  return baseQty / unit.toBase;
}

/** Μετατροπή ανάμεσα σε δύο μονάδες της ίδιας διάστασης (μέσω της βασικής). */
export function convertUnits(qty: number, from: UnitLike, to: UnitLike): number {
  if (from.dimension !== to.dimension) {
    throw new Error(`δεν μετατρέπεται ${from.code} (${from.dimension}) σε ${to.code} (${to.dimension})`);
  }
  return (qty * from.toBase) / to.toBase;
}

/** Περιεχόμενο συσκευασίας σε βασικές μονάδες: πόσα «σπάει» ένα TradeItem (contentQty είναι ήδη βασικές). */
export function packToBase(packQty: number, contentQty: number): number {
  if (!Number.isInteger(packQty) || packQty < 1) throw new Error(`η πολλαπλότητα συσκευασίας πρέπει να είναι θετικός ακέραιος (δόθηκε ${packQty})`);
  if (!Number.isInteger(contentQty) || contentQty < 1) throw new Error(`το περιεχόμενο πρέπει να είναι θετικός ακέραιος (δόθηκε ${contentQty})`);
  return packQty * contentQty;
}

/**
 * Γραμμάρια συνταγής → βασικές μονάδες αποθέματος (η παραγωγή τραβάει από το απόθεμα).
 * Μάζα: ×1000 (mg). Όγκος: 1 g ≈ 1 ml (πυκνότητα 1 — ρευστά της κουζίνας). Τεμάχια: μέσω
 * του βάρους τεμαχίου — χωρίς αυτό δεν μετατρέπεται.
 */
export function gramsToBaseQty(grams: number, baseUnit: UnitLike, gramsPerPiece?: number | null): number {
  if (!Number.isInteger(grams) || grams < 1) throw new Error(`τα γραμμάρια συνταγής πρέπει να είναι θετικός ακέραιος (δόθηκε ${grams})`);
  if (baseUnit.dimension === "count") {
    if (!gramsPerPiece || gramsPerPiece < 1) throw new Error("είδος σε τεμάχια χωρίς βάρος τεμαχίου — συμπλήρωσέ το στην καρτέλα του είδους");
    const pcs = Math.round(grams / gramsPerPiece);
    if (pcs < 1) throw new Error(`τα ${grams} g δεν φτάνουν ούτε για ένα τεμάχιο (${gramsPerPiece} g)`);
    return pcs;
  }
  if (baseUnit.dimension === "mass") return grams * 1_000;
  return grams; // volume
}

/** Μορφοποίηση ποσότητας βάσης για εμφάνιση: διαλέγει τη μεγαλύτερη μονάδα της διάστασης
 *  που δίνει τιμή ≥ 1, π.χ. 1_500_000 mg → «1,5 kg». Περνάμε τις μονάδες της διάστασης. */
export function formatBaseQty(baseQty: number, dimensionUnits: readonly UnitLike[], locale = "el-GR"): string {
  const sorted = [...dimensionUnits].sort((a, b) => b.toBase - a.toBase); // μεγαλύτερη πρώτη
  // Math.abs: και οι αρνητικές διαφορές (απογραφή) σε kg, όχι σε mg
  const unit = sorted.find((u) => Math.abs(baseQty) >= u.toBase) ?? sorted[sorted.length - 1];
  if (!unit) return String(baseQty);
  const qty = baseQty / unit.toBase;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(qty)} ${unit.code}`;
}
