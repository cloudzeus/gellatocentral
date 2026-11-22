// Αποθήκες: ανεξάρτητη οντότητα της επιχείρησης. Το απόθεμα ανήκει στην αποθήκη, ΟΧΙ στο κατάστημα·
// το κατάστημα αποφασίζει ποιες αποθήκες επιτρέπονται και ποια είναι η προεπιλογή του (StoreWarehouse).
// Έτσι καλύπτονται και οι δύο περιπτώσεις: αποθήκη ανά κατάστημα και μία κεντρική για πολλά καταστήματα.
//
// Επίλυση αποθήκης σε πώληση/παραστατικό (resolveWarehouseId), με σειρά προτεραιότητας:
//   1. ρητό warehouseId από τον χρήστη/API (ελέγχεται ότι επιτρέπεται στο κατάστημα),
//   2. η προεπιλεγμένη αποθήκη του ταμείου (Device.defaultWarehouseId — η «σειρά παραστατικών» της εφαρμογής),
//   3. η προεπιλογή του καταστήματος (StoreWarehouse.isDefault),
//   4. η σύνδεση με το μικρότερο priority,
//   5. αλλιώς DEFAULT_WAREHOUSE_REQUIRED.
// Κάθε εγγραφή που αλλάζει απόθεμα κρατά το ΤΕΛΙΚΟ warehouseId· δεν συμπεραίνεται ποτέ μόνο από το κατάστημα.

import type { Prisma } from "./generated/prisma/client";

// Δέχεται και τον κανονικό client και συναλλαγή (tx) — τα tests δίνουν δικό τους υποκατάστατο.
export type WarehouseDb = Pick<Prisma.TransactionClient, "store" | "warehouse" | "storeWarehouse" | "device" | "stockMovement">;

export const WAREHOUSE_ERROR = [
  "STORE_NOT_FOUND",
  "WAREHOUSE_NOT_FOUND",
  "STORE_INACTIVE",
  "WAREHOUSE_INACTIVE",
  "WAREHOUSE_NOT_ALLOWED_FOR_STORE",
  "DEVICE_NOT_FOUND",
  "DEVICE_STORE_MISMATCH",
  "DEFAULT_WAREHOUSE_REQUIRED",
  "DUPLICATE_DEFAULT_WAREHOUSE",
  "NEGATIVE_STOCK_NOT_ALLOWED",
] as const;
export type WarehouseErrorCode = (typeof WAREHOUSE_ERROR)[number];

/** Τι δείχνει η οθόνη στον χρήστη για κάθε κωδικό. */
export const WAREHOUSE_ERROR_MESSAGE: Record<WarehouseErrorCode, string> = {
  STORE_NOT_FOUND: "Το κατάστημα δεν βρέθηκε",
  WAREHOUSE_NOT_FOUND: "Η αποθήκη δεν βρέθηκε",
  STORE_INACTIVE: "Το κατάστημα είναι ανενεργό",
  WAREHOUSE_INACTIVE: "Η αποθήκη είναι ανενεργή",
  WAREHOUSE_NOT_ALLOWED_FOR_STORE: "Η αποθήκη δεν εξυπηρετεί αυτό το κατάστημα",
  DEVICE_NOT_FOUND: "Η συσκευή δεν βρέθηκε",
  DEVICE_STORE_MISMATCH: "Η συσκευή ανήκει σε άλλο κατάστημα",
  DEFAULT_WAREHOUSE_REQUIRED: "Δεν έχει οριστεί αποθήκη για το κατάστημα. Σύνδεσε μία και όρισε προεπιλογή.",
  DUPLICATE_DEFAULT_WAREHOUSE: "Υπάρχει ήδη προεπιλεγμένη αποθήκη στο κατάστημα",
  NEGATIVE_STOCK_NOT_ALLOWED: "Η κίνηση θα έκανε το απόθεμα αρνητικό",
};

export class WarehouseError extends Error {
  readonly code: WarehouseErrorCode;
  constructor(code: WarehouseErrorCode) {
    super(code);
    this.name = "WarehouseError";
    this.code = code;
  }
}

/** Το κατάστημα πρέπει να υπάρχει στην επιχείρηση και να είναι ενεργό. */
async function activeStore(tx: WarehouseDb, orgId: string, storeId: string) {
  const store = await tx.store.findFirst({ where: { id: storeId, orgId }, select: { id: true, active: true } });
  if (!store) throw new WarehouseError("STORE_NOT_FOUND");
  if (!store.active) throw new WarehouseError("STORE_INACTIVE");
  return store;
}

/** Η αποθήκη πρέπει να υπάρχει στην επιχείρηση, να είναι ενεργή και να εξυπηρετεί το κατάστημα. */
export async function assertWarehouseAllowedForStore(tx: WarehouseDb, input: { orgId: string; storeId: string; warehouseId: string }) {
  await activeStore(tx, input.orgId, input.storeId);
  const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, orgId: input.orgId }, select: { id: true, active: true } });
  if (!warehouse) throw new WarehouseError("WAREHOUSE_NOT_FOUND");
  if (!warehouse.active) throw new WarehouseError("WAREHOUSE_INACTIVE");
  const link = await tx.storeWarehouse.findUnique({ where: { storeId_warehouseId: { storeId: input.storeId, warehouseId: input.warehouseId } }, select: { storeId: true } });
  if (!link) throw new WarehouseError("WAREHOUSE_NOT_ALLOWED_FOR_STORE");
}

/**
 * Ποια αποθήκη χρεώνει/πιστώνει μια κίνηση. Το αποτέλεσμα γράφεται στην εγγραφή·
 * αν δεν βρεθεί τίποτα, η κίνηση ΔΕΝ γίνεται (DEFAULT_WAREHOUSE_REQUIRED).
 */
export async function resolveWarehouseId(
  tx: WarehouseDb,
  input: { orgId: string; storeId: string; deviceId?: string | null; requestedWarehouseId?: string | null },
): Promise<string> {
  if (input.requestedWarehouseId) {
    await assertWarehouseAllowedForStore(tx, { ...input, warehouseId: input.requestedWarehouseId });
    return input.requestedWarehouseId;
  }

  if (input.deviceId) {
    const device = await tx.device.findFirst({ where: { id: input.deviceId, orgId: input.orgId }, select: { storeId: true, defaultWarehouseId: true } });
    if (!device) throw new WarehouseError("DEVICE_NOT_FOUND");
    if (device.storeId !== input.storeId) throw new WarehouseError("DEVICE_STORE_MISMATCH");
    if (device.defaultWarehouseId) {
      await assertWarehouseAllowedForStore(tx, { ...input, warehouseId: device.defaultWarehouseId });
      return device.defaultWarehouseId;
    }
  }

  // προεπιλογή πρώτα· αν δεν υπάρχει, η σύνδεση με το μικρότερο priority
  const link = await tx.storeWarehouse.findFirst({
    where: { storeId: input.storeId, warehouse: { orgId: input.orgId, active: true }, store: { active: true } },
    orderBy: [{ isDefault: "desc" }, { priority: "asc" }],
    select: { warehouseId: true },
  });
  if (!link) throw new WarehouseError("DEFAULT_WAREHOUSE_REQUIRED");
  return link.warehouseId;
}

/**
 * Σύνδεση αποθήκης με κατάστημα. Η πρώτη σύνδεση ενός καταστήματος γίνεται αυτόματα προεπιλογή·
 * αν ζητηθεί isDefault, αλλάζει η προεπιλογή του καταστήματος (μία μόνο, πάντα).
 */
export async function attachWarehouse(
  tx: WarehouseDb,
  input: { orgId: string; storeId: string; warehouseId: string; isDefault?: boolean; priority?: number },
) {
  await activeStore(tx, input.orgId, input.storeId);
  const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, orgId: input.orgId }, select: { id: true, active: true } });
  if (!warehouse) throw new WarehouseError("WAREHOUSE_NOT_FOUND");
  if (!warehouse.active) throw new WarehouseError("WAREHOUSE_INACTIVE");
  const existing = await tx.storeWarehouse.findUnique({ where: { storeId_warehouseId: { storeId: input.storeId, warehouseId: input.warehouseId } } });
  if (existing) return existing; // ήδη δεμένη: τίποτα δεν αλλάζει
  const hasDefault = !!(await tx.storeWarehouse.findFirst({ where: { storeId: input.storeId, isDefault: true }, select: { storeId: true } }));
  const isDefault = input.isDefault ?? !hasDefault;
  if (isDefault) await tx.storeWarehouse.updateMany({ where: { storeId: input.storeId }, data: { isDefault: false } });
  return tx.storeWarehouse.create({
    data: { storeId: input.storeId, warehouseId: input.warehouseId, isDefault, priority: input.priority ?? 100 },
  });
}

/** Αλλαγή προεπιλογής καταστήματος: η νέα πρέπει να είναι ήδη δεμένη· η παλιά ξεσηκώνεται στην ίδια συναλλαγή. */
export async function setDefaultWarehouse(tx: WarehouseDb, input: { orgId: string; storeId: string; warehouseId: string }) {
  await assertWarehouseAllowedForStore(tx, input);
  await tx.storeWarehouse.updateMany({ where: { storeId: input.storeId }, data: { isDefault: false } });
  await tx.storeWarehouse.update({ where: { storeId_warehouseId: { storeId: input.storeId, warehouseId: input.warehouseId } }, data: { isDefault: true } });
}

/**
 * Αποσύνδεση. Αν έφευγε η προεπιλογή, προάγεται η επόμενη (μικρότερο priority)· ταμεία του καταστήματος
 * που την είχαν δική τους προεπιλογή μένουν χωρίς (θα πέσουν στην προεπιλογή του καταστήματος).
 */
export async function detachWarehouse(tx: WarehouseDb, input: { orgId: string; storeId: string; warehouseId: string }) {
  await activeStore(tx, input.orgId, input.storeId);
  const link = await tx.storeWarehouse.findUnique({ where: { storeId_warehouseId: { storeId: input.storeId, warehouseId: input.warehouseId } } });
  if (!link) return;
  await tx.storeWarehouse.delete({ where: { storeId_warehouseId: { storeId: input.storeId, warehouseId: input.warehouseId } } });
  await tx.device.updateMany({ where: { orgId: input.orgId, storeId: input.storeId, defaultWarehouseId: input.warehouseId }, data: { defaultWarehouseId: null } });
  if (link.isDefault) {
    const next = await tx.storeWarehouse.findFirst({ where: { storeId: input.storeId }, orderBy: { priority: "asc" }, select: { warehouseId: true } });
    if (next) await tx.storeWarehouse.update({ where: { storeId_warehouseId: { storeId: input.storeId, warehouseId: next.warehouseId } }, data: { isDefault: true } });
  }
}

// Οι εγγραφές αποθέματος γίνονται μόνο από lib/stock-db.ts (κοινό lock/balance contract).
