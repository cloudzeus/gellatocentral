// Θέσεις μέσα στην αποθήκη («Ψυγείο 1 · Ράφι 2»): πού μπαίνει κάθε υλικό, για παραλαβή και απόθεμα.
import { db } from "./db";
import { WorkflowError } from "./workflow-db";

export type Spot = { id: string; name: string };
export const spotKey = (genericItemId: string, warehouseId: string) => `${genericItemId}:${warehouseId}`;

/** Οι θέσεις κάθε αποθήκης και πού είναι ορισμένο κάθε υλικό. */
export async function spotsFor(orgId: string, warehouseIds: readonly string[], genericItemIds?: readonly string[]) {
  const [spots, items] = await Promise.all([
    db.storageSpot.findMany({ where: { orgId, warehouseId: { in: [...warehouseIds] }, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, warehouseId: true } }),
    db.itemSpot.findMany({ where: { orgId, warehouseId: { in: [...warehouseIds] }, ...(genericItemIds ? { genericItemId: { in: [...genericItemIds] } } : {}) }, select: { genericItemId: true, warehouseId: true, spot: { select: { id: true, name: true } } } }),
  ]);
  const byWarehouse = new Map<string, Spot[]>();
  for (const s of spots) byWarehouse.set(s.warehouseId, [...(byWarehouse.get(s.warehouseId) ?? []), { id: s.id, name: s.name }]);
  return { byWarehouse, of: new Map(items.map((i) => [spotKey(i.genericItemId, i.warehouseId), i.spot as Spot])) };
}

/** Ορίζει (ή αλλάζει) τη θέση ενός υλικού σε αποθήκη· με νέο όνομα φτιάχνει και τη θέση. */
export async function setItemSpot(orgId: string, allowedWarehouseIds: readonly string[], input: { genericItemId: string; warehouseId: string; spotId?: string | null; name?: string | null }, byName: string) {
  if (!allowedWarehouseIds.includes(input.warehouseId)) throw new WorkflowError("Η αποθήκη δεν ανήκει σε αυτό το κατάστημα");
  if (!(await db.genericItem.findFirst({ where: { id: input.genericItemId, orgId }, select: { id: true } }))) throw new WorkflowError("Το υλικό δεν βρέθηκε");
  const name = input.name?.trim().replace(/\s+/g, " ").slice(0, 60);
  const spot = input.spotId
    ? await db.storageSpot.findFirst({ where: { id: input.spotId, orgId, warehouseId: input.warehouseId, active: true }, select: { id: true, name: true } })
    : name ? await db.storageSpot.upsert({ where: { warehouseId_name: { warehouseId: input.warehouseId, name } }, update: { active: true }, create: { orgId, warehouseId: input.warehouseId, name }, select: { id: true, name: true } }) : null;
  if (!spot) throw new WorkflowError("Διάλεξε ή γράψε θέση");
  await db.itemSpot.upsert({
    where: { genericItemId_warehouseId: { genericItemId: input.genericItemId, warehouseId: input.warehouseId } },
    update: { spotId: spot.id, updatedByName: byName }, create: { orgId, genericItemId: input.genericItemId, warehouseId: input.warehouseId, spotId: spot.id, updatedByName: byName },
  });
  return spot;
}
