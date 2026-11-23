import type { TradeCategoryRecord } from "@/lib/trade-category-tree";
import { CategoryTree } from "./category-tree";

export type CatalogCategory = TradeCategoryRecord;

/** Server boundary: τα επίπεδα δεδομένων μένουν στη βάση· το interactive δέντρο φορτώνει μόνο στο tab κατηγοριών. */
export function CategoriesTable({ categories }: { categories: CatalogCategory[] }) {
  return <CategoryTree categories={categories} />;
}
