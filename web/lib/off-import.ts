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

export type OffMapped = {
  ean: string;
  name: string;
  brand: string | null;
  packaging: string | null;
  contentQty: number;
  unitCode: "g" | "ml" | "pcs";
  imageUrl: string | null;
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
  };
}
