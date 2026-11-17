// Διάταξη καρτών ανά περιοχή (βλ. components/widget-board.tsx).
export type Layout = Record<string, string[]>; // περιοχή → κάρτες με τη σειρά· το κλειδί "hidden" κρατά όσες έκρυψε ο χρήστης
export const HIDDEN = "hidden";

/** Η αποθηκευμένη διάταξη πάνω στις κάρτες που υπάρχουν τώρα: ό,τι λείπει μπαίνει στην προεπιλεγμένη του θέση, ό,τι δεν υπάρχει πια φεύγει. */
export function reconcile(saved: Layout | null, initial: Layout, ids: string[]): Layout {
  const areas = [...Object.keys(initial), HIDDEN];
  const out: Layout = Object.fromEntries(areas.map((a) => [a, [] as string[]]));
  const placed = new Set<string>();
  for (const a of areas) for (const id of saved?.[a] ?? []) if (ids.includes(id) && !placed.has(id)) { out[a].push(id); placed.add(id); }
  for (const a of Object.keys(initial)) for (const id of initial[a]) if (ids.includes(id) && !placed.has(id)) { out[a].push(id); placed.add(id); }
  return out;
}
