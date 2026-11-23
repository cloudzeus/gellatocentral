// Καθαρή λογική του δέντρου κατηγοριών: κοινή στο client, στις server actions και στα tests.
export type TradeCategoryRecord = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  active: boolean;
};

export type TradeCategoryLayout = Pick<TradeCategoryRecord, "id" | "parentId" | "position">;
export type FlatTradeCategory = { category: TradeCategoryRecord; depth: number };

const byOrder = <T extends Pick<TradeCategoryRecord, "position" | "name">>(a: T, b: T) => a.position - b.position || a.name.localeCompare(b.name, "el");

export function categoryChildren<T extends Pick<TradeCategoryRecord, "id" | "name" | "parentId" | "position">>(categories: T[], parentId: string | null) {
  return categories.filter((c) => c.parentId === parentId).sort(byOrder);
}

/** Προτεραιότητα γονέα-παιδιού, με ασφαλή έξοδο ακόμη και αν παλιά δεδομένα έχουν ορφανά ή κύκλο. */
export function flattenTradeCategories(categories: TradeCategoryRecord[]): FlatTradeCategory[] {
  const out: FlatTradeCategory[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const category of categoryChildren(categories, parentId)) {
      if (visited.has(category.id)) continue;
      visited.add(category.id);
      out.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const category of [...categories].sort(byOrder)) {
    if (visited.has(category.id)) continue;
    visited.add(category.id);
    out.push({ category, depth: 0 });
  }
  return out;
}

/** Τα ids ολόκληρου του υποδέντρου, χρήσιμα για απαγόρευση κύκλου και για επιλογές γονέα. */
export function descendantCategoryIds(categories: Pick<TradeCategoryRecord, "id" | "parentId">[], id: string) {
  const descendants = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const parents = new Set(frontier);
    frontier = categories.filter((c) => c.parentId && parents.has(c.parentId) && !descendants.has(c.id)).map((c) => c.id);
    for (const child of frontier) descendants.add(child);
  }
  return descendants;
}

/**
 * Μετακινεί μία κατηγορία δίπλα σε άλλη ή τελευταία μέσα σε νέο γονέα.
 * Τα παιδιά της ακολουθούν αυτόματα επειδή κρατούν το ίδιο parentId.
 */
export function moveTradeCategory(
  categories: TradeCategoryRecord[],
  activeId: string,
  target: { parentId: string | null; beforeId?: string; afterId?: string },
): TradeCategoryRecord[] {
  const active = categories.find((c) => c.id === activeId);
  if (!active) throw new Error("Άγνωστη κατηγορία");
  if (target.parentId && !categories.some((c) => c.id === target.parentId)) throw new Error("Άγνωστος γονέας");
  if (target.parentId === activeId || (target.parentId && descendantCategoryIds(categories, activeId).has(target.parentId)))
    throw new Error("Η κατηγορία δεν μπορεί να μετακινηθεί μέσα στον εαυτό της ή σε απόγονό της");

  const oldParentId = active.parentId;
  const moved = { ...active, parentId: target.parentId };
  const siblings = categoryChildren(categories.filter((c) => c.id !== activeId), target.parentId);
  let index = siblings.length;
  if (target.beforeId) {
    index = siblings.findIndex((c) => c.id === target.beforeId);
    if (index < 0) throw new Error("Ο προορισμός δεν βρέθηκε στο ίδιο επίπεδο");
  } else if (target.afterId) {
    index = siblings.findIndex((c) => c.id === target.afterId);
    if (index < 0) throw new Error("Ο προορισμός δεν βρέθηκε στο ίδιο επίπεδο");
    index += 1;
  }
  siblings.splice(index, 0, moved);

  const nextPositions = new Map(siblings.map((c, i): [string, number] => [c.id, i]));
  // Κλείνουμε και τα κενά του παλιού επιπέδου, ώστε η σειρά να μένει σταθερή μετά από επεξεργασίες/διαγραφές.
  if (oldParentId !== target.parentId) {
    for (const [i, c] of categoryChildren(categories.filter((x) => x.id !== activeId), oldParentId).entries()) nextPositions.set(c.id, i);
  }
  return categories.map((c) => c.id === activeId
    ? { ...moved, position: nextPositions.get(activeId) ?? 0 }
    : nextPositions.has(c.id) ? { ...c, position: nextPositions.get(c.id)! } : c);
}

/** Έλεγχος ολόκληρου του υποβληθέντος layout πριν από οποιαδήποτε εγγραφή στη βάση. */
export function tradeCategoryLayoutError(layout: TradeCategoryLayout[], existing: TradeCategoryRecord[]): string | null {
  if (layout.length !== existing.length) return "Ο κατάλογος άλλαξε από άλλη ενέργεια· ανανέωσε τη σελίδα και ξαναδοκίμασε";
  const currentIds = new Set(existing.map((c) => c.id));
  const submittedIds = new Set(layout.map((c) => c.id));
  if (submittedIds.size !== layout.length || [...submittedIds].some((id) => !currentIds.has(id)))
    return "Η δομή περιέχει άγνωστες ή διπλές κατηγορίες· ανανέωσε τη σελίδα";
  const byId = new Map(existing.map((c) => [c.id, c]));
  const layoutById = new Map(layout.map((c) => [c.id, c]));
  const siblingNames = new Set<string>();
  for (const row of layout) {
    if (!Number.isInteger(row.position) || row.position < 0) return "Η σειρά των κατηγοριών δεν είναι έγκυρη";
    if (row.parentId && !submittedIds.has(row.parentId)) return "Η δομή περιέχει γονέα που δεν υπάρχει";
    if (row.parentId === row.id) return "Η κατηγορία δεν μπορεί να είναι γονιός του εαυτού της";
    const key = `${row.parentId ?? ""}\u0000${byId.get(row.id)!.name}`;
    if (siblingNames.has(key)) return `Υπάρχουν δύο κατηγορίες «${byId.get(row.id)!.name}» στο ίδιο επίπεδο`;
    siblingNames.add(key);
    const visited = new Set<string>();
    let cursor: string | null = row.id;
    while (cursor) {
      if (visited.has(cursor)) return "Η μετακίνηση δημιουργεί κύκλο στη δομή· διάλεξε άλλο γονέα";
      visited.add(cursor);
      cursor = layoutById.get(cursor)?.parentId ?? null;
    }
  }
  return null;
}
