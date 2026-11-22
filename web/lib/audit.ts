// Επιχειρησιακό audit: μόνο create, μέσα στο transaction της αλλαγής. Σε αποτυχία γίνεται rollback μαζί της.
import type { Prisma } from "./generated/prisma/client";

export type AuditDb = Pick<Prisma.TransactionClient, "auditEvent">;
export type AuditActor = { id: string; name: string };
export type AuditInput = {
  orgId: string;
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  storeId?: string | null;
  warehouseId?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
};

const text = (value: string, label: string, max: number) => {
  const clean = value.trim();
  if (!clean || clean.length > max) throw new Error(`Άκυρο ${label} audit`);
  return clean;
};
const actionKey = (value: string) => {
  const clean = text(value, "action", 80);
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(clean)) throw new Error("Άκυρο action audit");
  return clean;
};
const entityKey = (value: string) => {
  const clean = text(value, "entity", 80);
  if (!/^[a-z][a-z0-9_]*$/.test(clean)) throw new Error("Άκυρο entity audit");
  return clean;
};

/** Τα IDs/το org προέρχονται από trusted server context· η συνάρτηση δεν δέχεται FormData ή client actor. */
export async function writeAudit(tx: AuditDb, input: AuditInput) {
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 500) throw new Error("Άκυρη αιτιολογία audit");
  return tx.auditEvent.create({
    data: {
      orgId: text(input.orgId, "tenant", 80),
      actorId: text(input.actor.id, "actor", 80),
      actorName: text(input.actor.name, "όνομα actor", 120),
      action: actionKey(input.action),
      entityType: entityKey(input.entityType),
      entityId: text(input.entityId, "entity ID", 80),
      storeId: input.storeId || null,
      warehouseId: input.warehouseId || null,
      reason,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
}
