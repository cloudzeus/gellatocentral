// Κοινές server-only εγγραφές: tenant-scoped parties, αρίθμηση και ασφαλές μήνυμα σφάλματος.
import type { Prisma } from "./generated/prisma/client";
import { writeAudit, type AuditInput } from "./audit";

export class WorkflowError extends Error {}

export function assertPositiveInt(value: number, label: string, maximum = 2_000_000_000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new WorkflowError(`${label}: θετικός ακέραιος αριθμός`);
  return value;
}

export function assertNonNegativeInt(value: number, label: string, maximum = 2_000_000_000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new WorkflowError(`${label}: μη αρνητικός ακέραιος αριθμός`);
  return value;
}

export function cleanText(value: string | null | undefined, label: string, maximum = 300, required = false) {
  const text = value?.trim() ?? "";
  if ((required && !text) || text.length > maximum) throw new WorkflowError(`${label}: ${required ? "υποχρεωτικό, " : ""}έως ${maximum} χαρακτήρες`);
  return text || null;
}

export async function assertParty(tx: Pick<Prisma.TransactionClient, "party">, orgId: string, id: string, role: "supplier" | "customer") {
  const party = await tx.party.findFirst({ where: { id, orgId, active: true, roles: { has: role } } });
  if (!party) throw new WorkflowError(role === "supplier" ? "Ο προμηθευτής δεν βρέθηκε" : "Ο πελάτης δεν βρέθηκε");
  return party;
}

/** Η αρίθμηση γίνεται αφού κλειδώσει ο tenant/τύπος· δεν εμπιστεύεται ΑΑ από browser. */
export async function nextBusinessNumber(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  orgId: string,
  kind: string,
  prefix: string,
  count: () => Promise<number>,
) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["business-number", orgId, kind])}, 0))) AS lock`;
  const sequence = (await count()) + 1;
  return `${prefix}-${new Date().getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
}

export async function auditWorkflow(tx: Prisma.TransactionClient, input: AuditInput) {
  return writeAudit(tx, input);
}

export function workflowMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 400) : "Η ενέργεια απέτυχε";
}
