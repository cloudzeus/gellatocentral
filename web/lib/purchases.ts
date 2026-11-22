// Λογική τιμολογίων αγοράς (docs/analysis/PROCUREMENT-DESIGN.md §9, §10):
// αντιστοίχιση γραμμών (κωδικός → EAN → fuzzy περιγραφή). Καθαρές συναρτήσεις χωρίς βάση —
// η αποδοχή παραλαβής (παρτίδα + κίνηση + τιμή σε συναλλαγή) είναι στο lib/purchases-db.ts.

import { parseGs1 } from "./gs1.ts"; // με επέκταση: το module φορτώνεται και από node --test

// ---- Καθαρά: αντιστοίχιση γραμμής ------------------------------------------

export type LineInput = { supplierCode?: string | null; ean?: string | null; description: string };
export type SupplierItemLite = { id: string; supplierId: string; tradeItemId: string; supplierCode: string | null; barcode: string | null; packQty: number };
export type TradeItemLite = { id: string; ean: string | null; name: string };
export type MappingLite = { tradeItemId: string; genericItemId: string };

export type LineMatch = {
  supplierItemId?: string;
  tradeItemId?: string;
  genericItemId?: string;
  matchNote?: "code" | "ean";
  suggestion?: { tradeItemId: string; score: number }; // fuzzy περιγραφή: πρόταση, ποτέ αυτόματη εφαρμογή
};

/** Κανονικοποίηση ελληνικού κειμένου για ομοιότητα: πεζά, άτονα, μόνο αλφαριθμητικά. */
export const normText = (s: string): string[] =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-zα-ω0-9]+/i).filter((t) => t.length > 1);

/** Ομοιότητα περιγραφής: λέξεις του ονόματος που βρίσκονται στην περιγραφή (0–1). */
export const textScore = (description: string, name: string): number => {
  const doc = new Set(normText(description));
  const nameTokens = normText(name);
  if (!doc.size || !nameTokens.length) return 0;
  const hits = nameTokens.filter((t) => doc.has(t)).length;
  return hits / nameTokens.length;
};

/**
 * Αντιστοίχιση γραμμής τιμολογίου με σειρά προτεραιότητας:
 * α. κωδικός προμηθευτή → SupplierItem, β. EAN/GS1 → TradeItem (και SupplierItem αν υπάρχει),
 * γ. fuzzy περιγραφή → μόνο πρόταση, δ. τίποτα.
 */
export function matchLine(
  line: LineInput,
  ctx: { supplierId: string; supplierItems: readonly SupplierItemLite[]; tradeItems: readonly TradeItemLite[]; mappings: readonly MappingLite[] },
): LineMatch {
  const ofSupplier = ctx.supplierItems.filter((s) => s.supplierId === ctx.supplierId);
  const genericOf = (tradeItemId: string) => ctx.mappings.find((m) => m.tradeItemId === tradeItemId)?.genericItemId;

  // α. κωδικός προμηθευτή
  const code = line.supplierCode?.trim();
  if (code) {
    const si = ofSupplier.find((s) => s.supplierCode === code);
    if (si) return { supplierItemId: si.id, tradeItemId: si.tradeItemId, genericItemId: genericOf(si.tradeItemId), matchNote: "code" };
  }

  // β. EAN / GS1 σάρωση (δοκιμάζουμε όλες τις μορφές: απλό EAN, GTIN-14, AI(01))
  const rawCode = line.ean?.trim();
  if (rawCode) {
    const scan = parseGs1(rawCode);
    const candidates = new Set([scan?.ean, scan?.gtin, rawCode].filter((x): x is string => !!x));
    const item = ctx.tradeItems.find((t) => t.ean && candidates.has(t.ean));
    if (item) {
      const si = ofSupplier.find((s) => s.tradeItemId === item.id);
      return { supplierItemId: si?.id, tradeItemId: item.id, genericItemId: genericOf(item.id), matchNote: "ean" };
    }
    // barcode που έδωσε ο προμηθευτής στο SupplierItem (π.χ. κιβώτιο)
    const si = ofSupplier.find((s) => s.barcode && candidates.has(s.barcode));
    if (si) return { supplierItemId: si.id, tradeItemId: si.tradeItemId, genericItemId: genericOf(si.tradeItemId), matchNote: "ean" };
  }

  // γ. fuzzy περιγραφή — πρόταση μόνο αν είναι καθαρή (και μοναδική κορυφαία)
  const scored = ctx.tradeItems.map((t) => ({ tradeItemId: t.id, score: textScore(line.description, t.name) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.score >= 0.5 && scored[1]?.score !== best.score) return { suggestion: best };
  return {};
}

/** Η ποσότητα της γραμμής σε βασικές μονάδες: τεμάχια παραστατικού × packQty × contentQty. */
export function lineBaseQty(quantity: number, packQty: number, contentQty: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`άκυρη ποσότητα γραμμής: ${quantity}`);
  return quantity * packQty * contentQty;
}

/** Τιμή ανά συσκευασία TradeItem από τη τιμή μονάδας παραστατικού (στρογγυλοποίηση στο λεπτό). */
export const perPackCents = (unitPriceCents: number, packQty: number): number => Math.round(unitPriceCents / packQty);

/** Ακέραια αποθήκευση κόστους σε εκατοστά λεπτού ανά 1.000 βασικές μονάδες. */
export const purchaseUnitCostHundredths = (packPriceCents: number, contentQty: number): number =>
  (packPriceCents * 100 * 1000) / contentQty;

export class PurchaseError extends Error {}
