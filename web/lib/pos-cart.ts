// Γραμμές που στέλνει μια συσκευή (προϊόν, ποσότητα, ids επιλογών, σημείωση) → γραμμές με τιμή και ΦΠΑ από τον κατάλογο.
// Κοινό για την άμεση πώληση και για τις αποστολές ανοιχτού λογαριασμού: η συσκευή δεν ορίζει ποτέ τιμές.
import { z } from "zod";
import { db } from "./db";
import { resolveLine } from "./pos-modifiers";

export const cartLines = z.array(z.object({
  productId: z.string().cuid(), quantity: z.number().int().min(1).max(999),
  options: z.array(z.string().cuid()).max(20).default([]), // ids επιλογών· η ίδια γεύση μπορεί να επαναλαμβάνεται
  note: z.string().trim().max(80).optional(),
})).min(1).max(100);

export type PricedLine = { productId: string; name: string; quantity: number; unitPriceCents: number; vatRate: number; options?: { name: string; priceCents: number }[]; note?: string };

/** null = κάποιο προϊόν δεν υπάρχει ή είναι ανενεργό. ModifierError όταν οι επιλογές δεν ταιριάζουν στον κατάλογο. */
export async function priceCart(orgId: string, lines: z.infer<typeof cartLines>): Promise<PricedLine[] | null> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const products = await db.product.findMany({
    where: { id: { in: ids }, orgId, active: true },
    include: { vatRate: true, modifierGroups: { orderBy: { position: "asc" }, include: { group: { include: { options: { where: { active: true }, orderBy: { position: "asc" } } } } } } },
  });
  if (products.length !== ids.length) return null;

  // Ίδιο προϊόν με ίδιες επιλογές και σημείωση = μία γραμμή.
  const merged = new Map<string, PricedLine>();
  for (const l of lines) {
    const p = products.find((x) => x.id === l.productId)!;
    const groups = p.modifierGroups.map((m) => ({ id: m.group.id, name: m.group.name, kind: m.group.kind, pick: m.pick, options: m.group.options }));
    const r = resolveLine(p.priceCents, groups, l.options);
    const note = l.note || undefined;
    const key = JSON.stringify([p.id, r.options, note]);
    const prev = merged.get(key);
    if (prev) prev.quantity += l.quantity;
    else merged.set(key, { productId: p.id, name: p.name, quantity: l.quantity, unitPriceCents: r.unitPriceCents, vatRate: p.vatRate.rate, options: r.options.length ? r.options : undefined, note });
  }
  return [...merged.values()];
}
