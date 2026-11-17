type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/**
 * Αναζήτηση, σελίδα, ταξινόμηση και φίλτρα από το URL (?q=…&page=…&sort=…&dir=…&<φίλτρο>=…).
 * Η σελίδα δεν ξεπερνά ποτέ τα όρια. `sort` επιστρέφεται μόνο αν είναι στις επιτρεπόμενες στήλες (ό,τι άλλο γράψει κάποιος στο URL αγνοείται).
 */
export function listParams<S extends string = never>(sp: Params, pageSize = 25, sortable: readonly S[] = []) {
  const q = one(sp.q).trim().slice(0, 80);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const sort = sortable.find((s) => s === one(sp.sort));
  const dir: "asc" | "desc" = one(sp.dir) === "asc" ? "asc" : "desc";
  return { q, page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sort, dir };
}

/** Τιμή φίλτρου από το URL, μόνο αν είναι στις επιτρεπόμενες. */
export const filterParam = <T extends string>(sp: Params, key: string, allowed: readonly T[]) => allowed.find((a) => a === one(sp[key]));
