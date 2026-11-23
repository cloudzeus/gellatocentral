// Μη καταστροφικό seed: συμπληρώνει μόνο κατηγορίες που λείπουν και δεν αλλάζει δομή/σειρά που έχει διαμορφώσει ο χρήστης.
import type { PrismaClient } from "../lib/generated/prisma/client";
import { PASTRY_CATEGORY_TREE, type PastryCategorySeed } from "../lib/pastry-categories";

export async function seedPastryCategories(db: PrismaClient) {
  const existing = await db.tradeCategory.findMany({ select: { id: true, parentId: true, name: true, position: true } });
  const byParentAndName = new Map(existing.map((c) => [`${c.parentId ?? ""}\u0000${c.name}`, c.id]));
  const nextPosition = new Map<string, number>();
  for (const c of existing) {
    const parent = c.parentId ?? "";
    nextPosition.set(parent, Math.max(nextPosition.get(parent) ?? 0, c.position + 1));
  }
  let added = 0;

  const walk = async (nodes: PastryCategorySeed[], parentId: string | null) => {
    for (const node of nodes) {
      const parent = parentId ?? "";
      const key = `${parent}\u0000${node.name}`;
      let id = byParentAndName.get(key);
      if (!id) {
        const position = nextPosition.get(parent) ?? 0;
        const created = await db.tradeCategory.create({ data: { name: node.name, parentId, position }, select: { id: true } });
        id = created.id;
        byParentAndName.set(key, id);
        nextPosition.set(parent, position + 1);
        added += 1;
      }
      if (node.children) await walk(node.children, id);
    }
  };

  await walk(PASTRY_CATEGORY_TREE, null);
  return { added, total: existing.length + added };
}
