// Org-scoped write gate· το row lock και ο έλεγχος γίνονται στην ίδια Serializable transaction.
import type { Prisma } from "./generated/prisma/client";
import type { MigrationCutoverStatus } from "./generated/prisma/enums";
import { stockTransaction } from "./stock-transaction.ts";
import { WorkflowError } from "./workflow-db.ts";

export type TenantWritePurpose = "BUSINESS" | "MIGRATION" | "SETTLEMENT";
export type TenantGateDb = Pick<Prisma.TransactionClient, "$queryRaw" | "migrationCutover">;

export class TenantWriteBlockedError extends WorkflowError {
  readonly code = "MIGRATION_CUTOVER_FROZEN";
  constructor() {
    super("Η επιχείρηση είναι παγωμένη για μεταφορά δεδομένων· επιτρέπονται μόνο ανάγνωση και ολοκλήρωση εκκρεμών πληρωμών");
    this.name = "TenantWriteBlockedError";
  }
}

/** Μόνο εσωτερικά migration/settlement flows αλλάζουν σκοπό· ποτέ τιμή από client request. */
export function tenantWriteBlocked(status: MigrationCutoverStatus | null, purpose: TenantWritePurpose = "BUSINESS") {
  return purpose === "BUSINESS" && status !== null && ["FROZEN", "DELTA_IMPORTED", "READY", "ROLLED_BACK"].includes(status);
}

export function expectedActivationConfirmation(id: string) {
  return `ΕΝΕΡΓΟΠΟΙΗΣΗ ${id}`;
}

export async function lockMigrationTenant(tx: Pick<Prisma.TransactionClient, "$queryRaw">, orgId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Organization" WHERE "id" = ${orgId} FOR UPDATE`;
  if (!rows[0]) throw new WorkflowError("Η επιχείρηση δεν βρέθηκε");
}

export async function assertTenantWriteAllowed(tx: TenantGateDb, orgId: string, purpose: TenantWritePurpose = "BUSINESS") {
  await lockMigrationTenant(tx, orgId);
  const cutover = await tx.migrationCutover.findUnique({ where: { orgId }, select: { status: true } });
  if (tenantWriteBlocked(cutover?.status ?? null, purpose)) throw new TenantWriteBlockedError();
  return cutover;
}

/** Κοινό boundary για writes που δεν περνούν από stock scope. */
export async function tenantWriteTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeout?: number; maxWait?: number; purpose?: TenantWritePurpose } = {},
): Promise<T> {
  return stockTransaction(async (tx) => {
    await assertTenantWriteAllowed(tx, orgId, options.purpose ?? "BUSINESS");
    return work(tx);
  }, { timeout: options.timeout, maxWait: options.maxWait });
}
