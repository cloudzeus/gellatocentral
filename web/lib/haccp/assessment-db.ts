// Πρόσβαση αξιολόγησης πάντα με tenant· τα scope IDs περιορίζουν επιπλέον συσκευές και καταχωρίσεις.
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { evaluateHaccp, type HaccpAssessment } from "./evaluator.ts";

export async function assessTenant(orgId: string, options: { storeIds?: string[]; persist?: boolean; now?: Date } = {}): Promise<HaccpAssessment> {
  const scoped = options.storeIds?.length ? { in: options.storeIds } : undefined;
  const [records, devices, postedPurchaseCount] = await Promise.all([
    db.haccpRecord.findMany({ where: { orgId, ...(scoped ? { OR: [{ storeId: scoped }, { storeId: null }] } : {}) }, select: { templateId: true, storeId: true, occurredAt: true, status: true, result: true, correctiveAction: true, notes: true } }),
    db.device.findMany({ where: { orgId, active: true, kind: { in: ["FRIDGE", "VENDING_MACHINE"] }, ...(scoped ? { storeId: scoped } : {}) }, select: { id: true, name: true, storeId: true, tempMin: true, tempMax: true, readings: { where: { kind: "TEMPERATURE" }, orderBy: { at: "desc" }, take: 1, select: { value: true, at: true } } } }),
    db.purchaseDoc.count({ where: { orgId, status: "POSTED" } }),
  ]);
  const result = evaluateHaccp({ now: options.now ?? new Date(), records, devices, postedPurchaseCount });
  if (options.persist) await db.haccpAssessment.create({ data: { orgId, score: result.score, critical: result.critical, warnings: result.warnings, findings: result.findings as unknown as Prisma.InputJsonValue, evaluatedAt: result.evaluatedAt } });
  return result;
}

export async function assessAllTenants(now = new Date()) {
  const orgs = await db.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const results = [];
  for (const org of orgs) {
    const result = await assessTenant(org.id, { persist: true, now });
    results.push({ orgId: org.id, name: org.name, score: result.score, critical: result.critical, warnings: result.warnings });
  }
  return results;
}
