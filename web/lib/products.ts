export type ProductDeletionRow = { id: string; _count: { lines: number } };

/**
 * Χωρίζει την επιλογή σε οριστικά διαγράψιμα και προϊόντα με πωλήσεις.
 * Τα δεύτερα κρύβονται, ώστε οι ήδη εκδοθείσες αποδείξεις να κρατήσουν την αναφορά τους.
 */
export function planProductDeletion(ids: string[], products: ProductDeletionRow[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const deleteIds: string[] = [];
  const hideIds: string[] = [];
  const missingIds: string[] = [];
  for (const id of [...new Set(ids)]) {
    const product = byId.get(id);
    if (!product) missingIds.push(id);
    else if (product._count.lines > 0) hideIds.push(id);
    else deleteIds.push(id);
  }
  return { deleteIds, hideIds, missingIds };
}
