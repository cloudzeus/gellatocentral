"use server";

import { flashFail } from "@/lib/flash-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentOrg } from "@/lib/auth";
import { attachWarehouse, detachWarehouse, setDefaultWarehouse, WAREHOUSE_ERROR_MESSAGE, WarehouseError } from "@/lib/warehouses";

const id = z.string().cuid();
const name = z.string().trim().min(2).max(60);
const code = z.string().trim().toUpperCase().max(20).transform((v) => v || null).refine((v) => !v || /^[A-Z0-9-]{1,20}$/.test(v));

/** Οι κωδικοί του lib/warehouses γίνονται μήνυμα στη σελίδα. */
const back = (error?: unknown): never => {
  revalidatePath("/inventory");
  const message = error instanceof WarehouseError ? WAREHOUSE_ERROR_MESSAGE[error.code] : null;
  redirect(message ? `/inventory?error=${encodeURIComponent(message)}` : "/inventory?saved=1");
};
const saved = (): never => {
  revalidatePath("/inventory");
  redirect("/inventory?saved=1");
};

export async function addWarehouse(form: FormData) {
  const { org } = await currentOrg("warehouses.add");
  const d = z.object({ name, code }).safeParse(Object.fromEntries(form));
  if (!d.success) redirect("/inventory?error=" + encodeURIComponent("Έλεγξε το όνομα και τον κωδικό της αποθήκης"));
  if (d.data.code && (await db.warehouse.findFirst({ where: { orgId: org.id, code: d.data.code } })))
    redirect("/inventory?error=" + encodeURIComponent(`Ο κωδικός ${d.data.code} χρησιμοποιείται ήδη`));
  await db.warehouse.create({ data: { orgId: org.id, ...d.data } });
  saved();
}

export async function toggleWarehouse(warehouseId: string) {
  const { org } = await currentOrg("warehouses.edit");
  const w = await db.warehouse.findFirst({ where: { id: warehouseId, orgId: org.id }, select: { id: true, active: true } });
  if (w) await db.warehouse.update({ where: { id: w.id }, data: { active: !w.active } });
  saved();
}

/** Σύνδεση αποθήκης με κατάστημα· με «προεπιλογή» αλλάζει και η προεπιλογή του καταστήματος. */
export async function attachStore(form: FormData) {
  const { org } = await currentOrg("warehouses.edit");
  const d = z
    .object({ warehouseId: id, storeId: id, priority: z.coerce.number().int().min(0).max(999).default(100), isDefault: z.literal("on").optional() })
    .safeParse(Object.fromEntries(form));
  if (!d.success) {
    await flashFail("Δεν έγινε: διάλεξε αποθήκη και κατάστημα");
    redirect("/inventory");
  }
  try {
    await db.$transaction((tx) => attachWarehouse(tx, { orgId: org.id, storeId: d.data.storeId, warehouseId: d.data.warehouseId, isDefault: d.data.isDefault === "on", priority: d.data.priority }));
  } catch (e) {
    back(e);
  }
  saved();
}

export async function detachStore(warehouseId: string, storeId: string) {
  const { org } = await currentOrg("warehouses.edit");
  try {
    await db.$transaction((tx) => detachWarehouse(tx, { orgId: org.id, storeId: id.parse(storeId), warehouseId: id.parse(warehouseId) }));
  } catch (e) {
    back(e);
  }
  saved();
}

export async function makeDefault(warehouseId: string, storeId: string) {
  const { org } = await currentOrg("warehouses.edit");
  try {
    await db.$transaction((tx) => setDefaultWarehouse(tx, { orgId: org.id, storeId: id.parse(storeId), warehouseId: id.parse(warehouseId) }));
  } catch (e) {
    back(e);
  }
  saved();
}
