"use server";

import { db } from "@/lib/db";
import { requireStockContext } from "@/lib/stock-context";

// Καταγράφεται το αίτημα, όχι ψευδής επιτυχία εκτύπωσης ή δημιουργία PDF.
export async function recordBrowserPrint(entityType: "production_batch" | "recipe", entityId: string) {
  if (!["production_batch", "recipe"].includes(entityType) || !entityId) throw new Error("Άκυρο έντυπο");
  const ctx = await requireStockContext(entityType === "recipe" ? "recipes.read" : "production.read");
  if (entityType === "recipe") {
    const recipe = await db.recipe.findFirst({ where: { id: entityId, orgId: ctx.orgId }, select: { id: true } });
    if (!recipe) throw new Error("Το τεχνικό δελτίο δεν βρέθηκε");
  } else {
    const batch = await db.productionBatch.findFirst({ where: { id: entityId, orgId: ctx.orgId }, select: { id: true, warehouseId: true, destinationWarehouseId: true } });
    if (!batch) throw new Error("Η ετικέτα παρτίδας δεν βρέθηκε");
    await requireStockContext("production.read", { warehouseIds: [batch.warehouseId, batch.destinationWarehouseId ?? batch.warehouseId] });
  }
  await db.documentDelivery.upsert({
    where: { orgId_entityType_entityId_channel_recipient: { orgId: ctx.orgId, entityType, entityId, channel: "browser_print", recipient: "" } },
    update: { status: "REQUESTED", detail: "Αίτημα εκτύπωσης browser· δεν δημιουργήθηκε αρχείο PDF", createdByName: ctx.userName, createdAt: new Date() },
    create: { orgId: ctx.orgId, entityType, entityId, channel: "browser_print", recipient: "", status: "REQUESTED", detail: "Αίτημα εκτύπωσης browser· δεν δημιουργήθηκε αρχείο PDF", createdByName: ctx.userName },
  });
  return { ok: true };
}
