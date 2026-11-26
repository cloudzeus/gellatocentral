import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";

export const productsTag = (orgId: string) => `products:${orgId}`;
export const VAT_RATES_TAG = "vat-rates";

export const MODIFIER_KIND_LABEL = { REQUIRED: "Υποχρεωτική επιλογή", EXTRA: "Έξτρα με χρέωση", REMOVE: "Χωρίς (αφαίρεση)" } as const;
// Σειρά ίδια με τη σταθερή παλέτα του ταμείου (mobile/theme.ts): θέση 1 = «Ουδέτερο».
export const TILL_COLORS = ["Ουδέτερο", "Λεβάντα", "Μέντα", "Ροδακινί", "Γαλάζιο", "Άμμος", "Λάιμ", "Ροζ"] as const;

type ProductPageQuery = {
  orgId: string;
  q: string;
  categoryParam: string;
  status: "active" | "hidden";
  sort?: "name" | "category" | "price" | "vat" | "status";
  direction: "asc" | "desc";
  skip: number;
  take: number;
};

/**
 * Ο κατάλογος αλλάζει μόνο μέσω actions, οπότε κρατιέται σε cache ανά tenant και παραμέτρους λίστας.
 * Η αυθεντικοποίηση μένει εκτός cache· το orgId μπαίνει και στο κλειδί και στο tag ακύρωσης.
 */
export async function getProductPageData({ orgId, q, categoryParam, status, sort, direction, skip, take }: ProductPageQuery) {
  "use cache";
  cacheLife("max");
  cacheTag(productsTag(orgId), VAT_RATES_TAG);

  const [categories, vatRates, modifierGroups] = await Promise.all([
    db.category.findMany({ where: { orgId }, orderBy: [{ position: "asc" }, { name: "asc" }] }),
    db.vatRate.findMany({ where: { active: true }, orderBy: { rate: "desc" } }),
    db.modifierGroup.findMany({ where: { orgId }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true } }),
  ]);
  const category = categories.some((c) => c.id === categoryParam) ? categoryParam : undefined;
  const where = {
    orgId,
    ...(category ? { categoryId: category } : {}),
    active: status === "active",
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { category: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const orderBy = sort === "category" ? [{ category: { position: direction } }, { category: { name: direction } }]
    : sort === "price" ? { priceCents: direction }
      : sort === "vat" ? { vatRate: { rate: direction } }
        : sort === "status" ? { active: direction }
          : { name: direction };
  const [products, total] = await Promise.all([
    db.product.findMany({ where, orderBy, skip, take, include: { category: true, vatRate: true, modifierGroups: { select: { groupId: true, pick: true } } } }),
    db.product.count({ where }),
  ]);

  return { categories, vatRates, modifierGroups, category, products, total };
}
