// Αντιστοίχιση γραμμής του Open Food Facts (TSV export) στον κεντρικό κατάλογο ειδών.
// Pure — το κατέβασμα/ροή/γράψιμο γίνεται στο scripts/import-off.ts.
// Πηγή: https://gr.openfoodfacts.org/data (ODbL — απαιτείται απόδοση στο UI).

export type OffRow = Record<string, string>;

/** Προϊόν που πωλείται στην Ελλάδα (countries_tags: «en:greece»). */
export function isGreece(row: OffRow): boolean {
  return (row.countries_tags ?? "").split(",").some((c) => c.trim() === "en:greece");
}

/** EAN/GTIN: μόνο ψηφία, μήκος 8/12/13/14 — αλλιώς δεν είναι αξιόπιστος κωδικός. */
export function cleanEan(code: string | undefined): string | null {
  const digits = (code ?? "").replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : null;
}

/** Όνομα: product_name, αλλιώς generic_name· κόψιμο κενών, 2–160 χαρακτήρες. */
export function cleanName(row: OffRow): string | null {
  const name = (row.product_name || row.generic_name || "").replace(/\s+/g, " ").trim();
  return name.length >= 2 && name.length <= 160 ? name : null;
}

/** Πρώτο brand της λίστας («ΔΕΛΤΑ, ΤΩΝ 150» → «ΔΕΛΤΑ»). */
export function pickBrand(brands: string | undefined): string | null {
  const first = (brands ?? "").split(",")[0]?.replace(/\s+/g, " ").trim() ?? "";
  return first.length >= 2 && first.length <= 60 ? first : null;
}

/** Πρώτη συσκευασία της λίστας, όπως γράφτηκε («plastic bottle»…). */
export function pickPackaging(packaging: string | undefined): string | null {
  const first = (packaging ?? "").split(",")[0]?.trim() ?? "";
  return first.length >= 2 && first.length <= 60 ? first : null;
}

const UNIT_FACTOR = { kg: 1_000_000, g: 1_000, mg: 1, l: 1_000, lt: 1_000, cl: 10, ml: 1 } as const;
const MASS = new Set(["kg", "g", "mg"]);

/**
 * «1 l», «500 g», «6 x 330 ml» → περιεχόμενο σε βασική μονάδα (mg/ml) με τον κωδικό μονάδας
 * που δείχνει τη διάσταση (g για μάζα, ml για όγκο — το Unit του καταλόγου). Άγνωστο → null.
 */
export function parseQuantity(quantity: string | undefined): { qty: number; unitCode: "g" | "ml" } | null {
  const q = (quantity ?? "").toLowerCase().replace(",", ".").trim();
  const m = /^(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|mg|lt|l|cl|ml)\b/.exec(q);
  if (!m) return null;
  const total = (m[1] ? Number(m[1]) : 1) * Number(m[2]);
  const factor = UNIT_FACTOR[m[3] as keyof typeof UNIT_FACTOR];
  const base = Math.round(total * factor);
  if (!Number.isInteger(base) || base <= 0) return null;
  return { qty: base, unitCode: MASS.has(m[3]) ? "g" : "ml" };
}

// Ετικέτες αλλεργιογόνων του OFF → τα 14 κλειδιά του Καν. (ΕΕ) 1169/2011 (lib/composition.ts)
const ALLERGEN_TAG_MAP: Record<string, string> = {
  gluten: "gluten",
  crustaceans: "crustaceans",
  eggs: "eggs",
  fish: "fish",
  peanuts: "peanuts",
  soybeans: "soy",
  soy: "soy",
  milk: "milk",
  nuts: "nuts",
  celery: "celery",
  mustard: "mustard",
  "sesame-seeds": "sesame",
  sesame: "sesame",
  "sulphur-dioxide-and-sulphites": "sulphites",
  sulphites: "sulphites",
  lupin: "lupin",
  molluscs: "molluscs",
};

/** Λίστα ετικετών OFF («en:milk,en:sesame-seeds») → δικά μας κλειδιά, χωρίς διπλότυπα/άγνωστα. */
export function mapAllergenTags(tags: string | undefined): string[] {
  const out = new Set<string>();
  for (const t of (tags ?? "").split(",")) {
    const key = ALLERGEN_TAG_MAP[t.trim().replace(/^[a-z]{2}:/, "")];
    if (key) out.add(key);
  }
  return [...out];
}

/** Θρεπτικό του OFF (g ανά 100 g, «3.5») → χιλιοστά της μονάδας για τη βάση· κενό/άκυρο → null. */
export function nutrimentToPm(value: string | undefined): number | null {
  const s = (value ?? "").trim().replace(",", ".");
  if (!s) return null;
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0 || v > 100) return null;
  return Math.round(v * 1000);
}

/** Κείμενο συστατικών: προτιμάται η ελληνική έκδοση· κόψιμο κενών, έως 4000 χαρακτήρες. */
export function cleanIngredients(row: OffRow): string | null {
  const text = (row.ingredients_text_el || row.ingredients_text || "").replace(/\s+/g, " ").trim();
  return text.length >= 3 ? text.slice(0, 4000) : null;
}

export type OffMapped = {
  ean: string;
  name: string;
  brand: string | null;
  packaging: string | null;
  contentQty: number;
  unitCode: "g" | "ml" | "pcs";
  imageUrl: string | null;
  ingredientsText: string | null;
  allergensContains: string[];
  allergensTraces: string[];
  fatPm: number | null;
  sucrosePm: number | null; // τα «σάκχαρα» της ετικέτας καταχωρούνται ως ζάχαρη (προσέγγιση)
  otherProteinPm: number | null; // οι πρωτεΐνες δεν διακρίνονται σε γάλακτος/λοιπές
  saltPm: number | null;
  fiberPm: number | null;
  alcoholPm: number | null;
};

/** Γραμμή TSV → δεδομένα TradeItem, ή null αν δεν πληροί τα ελάχιστα (Ελλάδα, EAN, όνομα).
 *  Χωρίς αναγνώσιμη ποσότητα καταχωρείται ως «1 τεμάχιο» — το barcode/το όνομα έχουν αξία στη σάρωση. */
export function mapOffRow(row: OffRow): OffMapped | null {
  if (!isGreece(row)) return null;
  const ean = cleanEan(row.code);
  const name = cleanName(row);
  if (!ean || !name) return null;
  const qty = parseQuantity(row.quantity) ?? { qty: 1, unitCode: "pcs" as const };
  return {
    ean,
    name,
    brand: pickBrand(row.brands),
    packaging: pickPackaging(row.packaging),
    contentQty: qty.qty,
    unitCode: qty.unitCode,
    imageUrl: row.image_front_url || row.image_url || null,
    ingredientsText: cleanIngredients(row),
    // στο ημερήσιο export η στήλη λέγεται «allergens» (tags με πρόθεμα γλώσσας)· δέχομαι και το παλιό όνομα
    allergensContains: mapAllergenTags(row.allergens_tags || row.allergens),
    allergensTraces: mapAllergenTags(row.traces_tags || row.traces),
    fatPm: nutrimentToPm(row.fat_100g),
    sucrosePm: nutrimentToPm(row.sugars_100g),
    otherProteinPm: nutrimentToPm(row.proteins_100g),
    saltPm: nutrimentToPm(row.salt_100g),
    fiberPm: nutrimentToPm(row.fiber_100g),
    alcoholPm: nutrimentToPm(row.alcohol_100g),
  };
}
