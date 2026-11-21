// Καθαρή λογική παραγωγής: FEFO κατανομή κατανάλωσης σε παρτίδες (First Expired, First Out —
// πρώτα λήγει, πρώτη καταναλώνεται· χωρίς λήξη στο τέλος, παλιότερη πρώτη). Κανένα I/O —
// η ατομική εκτέλεση σε βάση είναι στο lib/production-db.ts. Δοκιμάζεται με node --test.

export interface LotStock {
  id: string;
  /** null = χύμα παρτίδα χωρίς ημερομηνία — καταναλώνεται τελευταία */
  expiresAt: Date | null;
  /** διαθέσιμο υπόλοιπο σε βασικές μονάδες */
  available: number;
}

export interface FefoAllocation {
  lotId: string;
  qty: number;
}

/**
 * Κατανομή ποσότητας σε παρτίδες με FEFO. Επιστρέφει τις αναλώσεις ανά παρτίδα
 * (μόνο παρτίδες με θετικό υπόλοιπο) ή null αν το απόθεμα δεν φτάνει.
 */
export function allocateFefo(lots: readonly LotStock[], qty: number): FefoAllocation[] | null {
  if (!Number.isInteger(qty) || qty < 1) throw new Error(`η ποσότητα κατανάλωσης πρέπει να είναι θετικός ακέραιος (δόθηκε ${qty})`);
  const sorted = [...lots]
    .filter((l) => l.available > 0)
    .sort((a, b) => (a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY));
  let remaining = qty;
  const out: FefoAllocation[] = [];
  for (const lot of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(lot.available, remaining);
    out.push({ lotId: lot.id, qty: take });
    remaining -= take;
  }
  return remaining > 0 ? null : out;
}

/** Πόσα λείπουν για να καλυφθεί η ποσότητα (για το μήνυμα σφάλματος). */
export function fefoShortfall(lots: readonly LotStock[], qty: number): number {
  const total = lots.reduce((s, l) => s + Math.max(0, l.available), 0);
  return Math.max(0, qty - total);
}

/** Αριθμός παρτίδας παραγωγής: YYYYMMDD-N για τη μέρα παραγωγής (N = σειρά της ημέρας). */
export function nextBatchNumber(date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}-${seq}`;
}
