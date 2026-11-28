// Κατάλογος του ταμείου: κοινός για την εφαρμογή Android (/api/pos/catalog) και το ταμείο του browser (/pos).
import { db } from "./db";

const FREQUENT_DAYS = 30;
const FREQUENT_MAX = 12;

export type TillProduct = { id: string; name: string; code: string | null; priceCents: number; vatRate: number; groups: { id: string; name: string; kind: "REQUIRED" | "EXTRA" | "REMOVE"; pick: number; options: { id: string; name: string; priceCents: number }[] }[] };
export type TillCategory = { id: string; name: string; color: number | null; products: TillProduct[] };

/** Κατηγορίες με προϊόντα και επίπεδες ομάδες επιλογών, και τα «Συχνά» του καταστήματος (τα πιο πουλημένα του μήνα). */
export async function tillCatalog(orgId: string, storeId: string): Promise<{ categories: TillCategory[]; frequent: string[] }> {
  const categories = await db.category.findMany({
    where: { orgId },
    orderBy: { position: "asc" },
    select: {
      id: true, name: true, color: true,
      products: {
        where: { active: true }, orderBy: { name: "asc" },
        select: {
          id: true, name: true, code: true, priceCents: true, vatRate: { select: { rate: true } },
          modifierGroups: {
            orderBy: { position: "asc" },
            select: { pick: true, group: { select: { id: true, name: true, kind: true, options: { where: { active: true }, orderBy: { position: "asc" }, select: { id: true, name: true, priceCents: true } } } } },
          },
        },
      },
    },
  });
  // Η εφαρμογή ταμείου περιμένει το ποσοστό ΦΠΑ ως αριθμό και τις ομάδες επιλογών επίπεδες, με το «πόσες» της σύνδεσης.
  const flat = categories.map((c) => ({
    ...c,
    products: c.products.map((p) => ({
      id: p.id, name: p.name, code: p.code, priceCents: p.priceCents, vatRate: p.vatRate.rate,
      groups: p.modifierGroups.filter((m) => m.group.options.length).map((m) => ({ ...m.group, pick: m.group.kind === "REQUIRED" ? m.pick : 0 })),
    })),
  }));
  const top = await db.saleLine.groupBy({
    by: ["productId"],
    where: { sale: { orgId, storeId, status: "COMPLETED", issuedAt: { gte: new Date(Date.now() - FREQUENT_DAYS * 86_400_000) } } },
    _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: FREQUENT_MAX,
  });
  const frequent = top.map((t) => t.productId).filter((id): id is string => !!id && flat.some((c) => c.products.some((p) => p.id === id)));
  return { categories: flat, frequent };
}
