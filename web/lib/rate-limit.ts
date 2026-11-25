// Όριο ρυθμού ανά κλειδί (π.χ. «login:<ip>»), σταθερό παράθυρο.
// shortcut: στη μνήμη της διεργασίας, άρα ισχύει ανά κόμβο και μηδενίζεται σε επανεκκίνηση· με δεύτερο κόμβο πάει στη βάση.
const hits = new Map<string, { count: number; resetAt: number }>();

/** true = το κλειδί ξεπέρασε το όριο μέσα στο παράθυρο· η κλήση μετράει ως προσπάθεια. */
export function rateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  // για να μη μεγαλώνει χωρίς όριο: τα ληγμένα φεύγουν όταν μαζευτούν πολλά
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  const hit = hits.get(key);
  if (!hit || hit.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  hit.count += 1;
  return hit.count > limit;
}
