// Προσωπικό: tenant/store scope, ασφαλή public tokens και αμοιβές μόνο με ρητό staff.pay.
import { randomBytes } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { db } from "./db";
import { assertGlobalStockScope, assertStockScope, type StockContext } from "./stock-scope";
import { stockTransaction } from "./stock-transaction";
import { hashAccessToken } from "./wholesale";
import { auditWorkflow, assertNonNegativeInt, cleanText, WorkflowError } from "./workflow-db";
import { affectedScheduleEmployeeIds, hourlyCostCents, intervalsOverlap, shiftsForEmployee, workedMinutes } from "./staff";

type Tx = Prisma.TransactionClient;
const actor = (ctx: StockContext) => ({ id: ctx.userId, name: ctx.userName });
function requirePermission(ctx: StockContext, permission: "staff.pay") {
  if (!ctx.can(permission)) throw new WorkflowError("Δεν έχεις δικαίωμα προβολής ή επεξεργασίας αμοιβών");
}
function validRange(fromAt: Date, toAt: Date, maxDays = 62) {
  if (Number.isNaN(fromAt.getTime()) || Number.isNaN(toAt.getTime()) || fromAt >= toAt || toAt.getTime() - fromAt.getTime() > maxDays * 86_400_000) throw new WorkflowError(`Άκυρο χρονικό διάστημα (έως ${maxDays} ημέρες)`);
}
async function ownedDepartment(tx: Tx, orgId: string, departmentId?: string | null) {
  if (!departmentId) return null;
  const department = await tx.department.findFirst({ where: { id: departmentId, orgId, active: true } });
  if (!department) throw new WorkflowError("Το τμήμα δεν βρέθηκε");
  return department;
}
async function ownedEmployee(tx: Tx, orgId: string, employeeId: string) {
  const employee = await tx.employee.findFirst({ where: { id: employeeId, orgId, active: true } });
  if (!employee) throw new WorkflowError("Ο εργαζόμενος δεν βρέθηκε ή είναι ανενεργός");
  return employee;
}

export async function saveDepartment(ctx: StockContext, input: { name: string; kind?: string }) {
  const name = cleanText(input.name, "Όνομα τμήματος", 100, true)!;
  const kind = cleanText(input.kind, "Είδος", 40) ?? "other";
  return stockTransaction(async (tx) => {
    const department = await tx.department.create({ data: { orgId: ctx.orgId, name, kind } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "staff.department", entityType: "department", entityId: department.id, metadata: { kind } });
    return department;
  });
}

export async function saveEmployee(ctx: StockContext, input: { name: string; departmentId?: string | null; storeId?: string | null; warehouseId?: string | null; userId?: string | null; phone?: string | null; email?: string | null; startDate?: Date | null; endDate?: Date | null }) {
  const name = cleanText(input.name, "Ονοματεπώνυμο", 150, true)!;
  if (input.startDate && input.endDate && input.startDate > input.endDate) throw new WorkflowError("Η λήξη απασχόλησης προηγείται της έναρξης");
  return stockTransaction(async (tx) => {
    await ownedDepartment(tx, ctx.orgId, input.departmentId);
    await assertStockScope(tx, ctx, { storeId: input.storeId ?? undefined, warehouseId: input.warehouseId ?? undefined, forWrite: true });
    if (!input.storeId && !input.warehouseId) assertGlobalStockScope(ctx);
    if (input.userId && !await tx.membership.findFirst({ where: { orgId: ctx.orgId, userId: input.userId } })) throw new WorkflowError("Ο συνδεδεμένος χρήστης δεν ανήκει στην επιχείρηση");
    const employee = await tx.employee.create({ data: {
      orgId: ctx.orgId, name, departmentId: input.departmentId ?? null, storeId: input.storeId ?? null, warehouseId: input.warehouseId ?? null,
      userId: input.userId ?? null, phone: cleanText(input.phone, "Τηλέφωνο", 40), email: cleanText(input.email, "Email", 160),
      startDate: input.startDate ?? null, endDate: input.endDate ?? null,
    } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "staff.employee", entityType: "employee", entityId: employee.id, storeId: employee.storeId, warehouseId: employee.warehouseId });
    return employee;
  });
}

export async function saveEmployeePay(ctx: StockContext, employeeId: string, input: { payType: string; hourlyRateCents: number; monthlySalaryCents: number; iban?: string | null; vatNumber?: string | null; notes?: string | null }) {
  requirePermission(ctx, "staff.pay");
  if (!["HOURLY", "MONTHLY"].includes(input.payType)) throw new WorkflowError("Άκυρος τύπος αμοιβής");
  assertNonNegativeInt(input.hourlyRateCents, "Ωρομίσθιο");
  assertNonNegativeInt(input.monthlySalaryCents, "Μηνιαίος μισθός");
  const iban = cleanText(input.iban?.replace(/\s/g, "").toUpperCase(), "IBAN", 34);
  if (iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) throw new WorkflowError("Άκυρη μορφή IBAN");
  return stockTransaction(async (tx) => {
    const employee = await ownedEmployee(tx, ctx.orgId, employeeId);
    await assertStockScope(tx, ctx, { storeId: employee.storeId ?? undefined, warehouseId: employee.warehouseId ?? undefined, forWrite: true });
    const pay = await tx.employeePay.upsert({
      where: { employeeId }, update: { payType: input.payType, hourlyRateCents: input.hourlyRateCents, monthlySalaryCents: input.monthlySalaryCents, iban, vatNumber: cleanText(input.vatNumber, "ΑΦΜ", 20), notes: cleanText(input.notes, "Σημειώσεις", 500) },
      create: { orgId: ctx.orgId, employeeId, payType: input.payType, hourlyRateCents: input.hourlyRateCents, monthlySalaryCents: input.monthlySalaryCents, iban, vatNumber: cleanText(input.vatNumber, "ΑΦΜ", 20), notes: cleanText(input.notes, "Σημειώσεις", 500) },
    });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "staff.pay", entityType: "employee", entityId: employeeId, storeId: employee.storeId, warehouseId: employee.warehouseId, metadata: { payType: input.payType } });
    return pay;
  });
}

export async function createShift(ctx: StockContext, input: { employeeId: string; departmentId?: string | null; storeId?: string | null; productionPlanId?: string | null; startsAt: Date; endsAt: Date; breakMinutes?: number; hourlyRateCents?: number | null; note?: string | null }) {
  const minutes = workedMinutes(input.startsAt, input.endsAt, input.breakMinutes ?? 0);
  if (input.hourlyRateCents != null) { requirePermission(ctx, "staff.pay"); assertNonNegativeInt(input.hourlyRateCents, "Ωρομίσθιο"); }
  return stockTransaction(async (tx) => {
    const employee = await ownedEmployee(tx, ctx.orgId, input.employeeId);
    await ownedDepartment(tx, ctx.orgId, input.departmentId);
    if (input.departmentId && employee.departmentId && employee.departmentId !== input.departmentId) throw new WorkflowError("Η βάρδια ανήκει σε διαφορετικό τμήμα από τον εργαζόμενο");
    await assertStockScope(tx, ctx, { storeId: input.storeId ?? employee.storeId ?? undefined, warehouseId: employee.warehouseId ?? undefined, forWrite: true });
    if (input.productionPlanId && !await tx.productionPlan.findFirst({ where: { id: input.productionPlanId, orgId: ctx.orgId } })) throw new WorkflowError("Το πρόγραμμα παραγωγής δεν βρέθηκε");
    if (await tx.shift.findFirst({ where: { orgId: ctx.orgId, employeeId: employee.id, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } }, select: { id: true } })) throw new WorkflowError("Υπάρχει επικαλυπτόμενη βάρδια");
    if (await tx.employeeLeave.findFirst({ where: { orgId: ctx.orgId, employeeId: employee.id, fromAt: { lt: input.endsAt }, toAt: { gt: input.startsAt } }, select: { id: true } })) throw new WorkflowError("Υπάρχει άδεια στο διάστημα της βάρδιας");
    const shift = await tx.shift.create({ data: { orgId: ctx.orgId, employeeId: employee.id, departmentId: input.departmentId ?? employee.departmentId, storeId: input.storeId ?? employee.storeId, productionPlanId: input.productionPlanId ?? null, startsAt: input.startsAt, endsAt: input.endsAt, breakMinutes: input.breakMinutes ?? 0, hourlyRateCents: input.hourlyRateCents ?? null, note: cleanText(input.note, "Σημείωση", 500) } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "staff.shift", entityType: "shift", entityId: shift.id, storeId: shift.storeId, metadata: { minutes, employeeId: employee.id } });
    return shift;
  });
}

export async function createLeave(ctx: StockContext, input: { employeeId: string; kind: string; fromAt: Date; toAt: Date; note?: string | null }) {
  validRange(input.fromAt, input.toAt, 366);
  const kind = cleanText(input.kind, "Είδος άδειας", 50, true)!;
  return stockTransaction(async (tx) => {
    const employee = await ownedEmployee(tx, ctx.orgId, input.employeeId);
    await assertStockScope(tx, ctx, { storeId: employee.storeId ?? undefined, warehouseId: employee.warehouseId ?? undefined, forWrite: true });
    if (await tx.shift.findFirst({ where: { orgId: ctx.orgId, employeeId: employee.id, startsAt: { lt: input.toAt }, endsAt: { gt: input.fromAt } }, select: { id: true } })) throw new WorkflowError("Μετακίνησε πρώτα τις βάρδιες που επικαλύπτουν την άδεια");
    const leave = await tx.employeeLeave.create({ data: { orgId: ctx.orgId, employeeId: employee.id, kind, fromAt: input.fromAt, toAt: input.toAt, note: cleanText(input.note, "Σημείωση", 500) } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "staff.leave", entityType: "employee_leave", entityId: leave.id, storeId: employee.storeId, warehouseId: employee.warehouseId, metadata: { kind } });
    return leave;
  });
}

export async function publishSchedule(ctx: StockContext, input: { storeId?: string | null; groupKind?: string; fromAt: Date; toAt: Date }) {
  validRange(input.fromAt, input.toAt);
  const groupKind = cleanText(input.groupKind, "Ομάδα", 40) ?? "store";
  return stockTransaction(async (tx) => {
    if (!input.storeId) assertGlobalStockScope(ctx);
    await assertStockScope(tx, ctx, { storeId: input.storeId ?? undefined, forWrite: true });
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${ctx.orgId}:${input.storeId ?? "all"}:${groupKind}`}, 0))) AS lock`;
    const shifts = await tx.shift.findMany({ where: { orgId: ctx.orgId, ...(input.storeId ? { storeId: input.storeId } : {}), startsAt: { lt: input.toAt }, endsAt: { gt: input.fromAt } }, orderBy: { startsAt: "asc" } });
    if (!shifts.length) throw new WorkflowError("Δεν υπάρχουν βάρδιες στο διάστημα");
    const [employees, departments, stores] = await Promise.all([
      tx.employee.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set(shifts.map((shift) => shift.employeeId))] } }, select: { id: true, name: true } }),
      tx.department.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
      tx.store.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    ]);
    const employeeNames = new Map(employees.map((row) => [row.id, row.name]));
    const departmentNames = new Map(departments.map((row) => [row.id, row.name]));
    const storeNames = new Map(stores.map((row) => [row.id, row.name]));
    const snapshot = { shifts: shifts.map((shift) => ({ id: shift.id, employeeId: shift.employeeId, employeeName: employeeNames.get(shift.employeeId) ?? "Εργαζόμενος", startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt.toISOString(), breakMinutes: shift.breakMinutes, note: shift.note, departmentName: shift.departmentId ? departmentNames.get(shift.departmentId) ?? null : null, storeName: shift.storeId ? storeNames.get(shift.storeId) ?? null : null })) };
    const publicationWhere = { orgId: ctx.orgId, storeId: input.storeId ?? null, groupKind, fromAt: input.fromAt, toAt: input.toAt };
    const [previous, previousPublication] = await Promise.all([
      tx.schedulePublication.aggregate({ where: publicationWhere, _max: { version: true } }),
      tx.schedulePublication.findFirst({ where: publicationWhere, orderBy: { version: "desc" }, select: { snapshot: true } }),
    ]);
    const publication = await tx.schedulePublication.create({ data: { orgId: ctx.orgId, storeId: input.storeId ?? null, groupKind, fromAt: input.fromAt, toAt: input.toAt, version: (previous._max.version ?? 0) + 1, snapshot, publishedByName: ctx.userName } });
    await tx.documentDelivery.create({ data: { orgId: ctx.orgId, entityType: "schedule_publication", entityId: publication.id, channel: "internal", status: "RECORDED", detail: `Δημοσίευση ${shifts.length} βαρδιών· δεν στάλθηκε εξωτερικό μήνυμα`, createdByName: ctx.userName } });
    const affectedIds = affectedScheduleEmployeeIds(previousPublication?.snapshot ?? null, snapshot);
    const affected = affectedIds.length ? await tx.employee.findMany({ where: { orgId: ctx.orgId, id: { in: affectedIds } }, select: { id: true, name: true, email: true, phone: true } }) : [];
    for (const employee of affected) {
      // Προετοιμασία ανά επηρεαζόμενο employeeId· χωρίς provider δεν καταγράφεται ποτέ ως απεσταλμένο.
      await tx.documentDelivery.create({ data: { orgId: ctx.orgId, entityType: "schedule_publication", entityId: publication.id, channel: "notification_preparation", recipient: employee.id, status: "PREPARED", detail: `Προετοιμασία για ${employee.name}· ${employee.email ? "email" : employee.phone ? "τηλέφωνο" : "χωρίς στοιχείο επικοινωνίας"}· δεν πραγματοποιήθηκε αποστολή`, createdByName: ctx.userName } });
    }
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "staff.schedule.publish", entityType: "schedule_publication", entityId: publication.id, storeId: publication.storeId, metadata: { version: publication.version, shifts: shifts.length, affectedEmployees: affected.length } });
    return publication;
  });
}

export async function createScheduleLink(ctx: StockContext, employeeId: string) {
  return stockTransaction(async (tx) => {
    const employee = await ownedEmployee(tx, ctx.orgId, employeeId);
    await assertStockScope(tx, ctx, { storeId: employee.storeId ?? undefined, warehouseId: employee.warehouseId ?? undefined, forWrite: true });
    const token = randomBytes(32).toString("base64url");
    const link = await tx.scheduleLink.upsert({ where: { employeeId }, update: { tokenHash: hashAccessToken(token), active: true, acknowledgedVersion: 0, acknowledgedAt: null }, create: { orgId: ctx.orgId, employeeId, tokenHash: hashAccessToken(token) } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "staff.schedule.link", entityType: "employee", entityId: employeeId, storeId: employee.storeId, warehouseId: employee.warehouseId });
    return { token, link };
  });
}

export async function publicSchedule(token: string) {
  const link = await db.scheduleLink.findFirst({ where: { tokenHash: hashAccessToken(token), active: true }, include: { employee: true, org: true } });
  if (!link || !link.employee.active || link.org.suspendedAt || link.org.closingAt) throw new WorkflowError("Ο σύνδεσμος προγράμματος δεν είναι ενεργός");
  const publications = await db.schedulePublication.findMany({ where: { orgId: link.orgId }, orderBy: { publishedAt: "desc" }, take: 50 });
  return {
    employee: { id: link.employee.id, name: link.employee.name }, orgName: link.org.name,
    acknowledgedVersion: link.acknowledgedVersion, acknowledgedAt: link.acknowledgedAt,
    publications: publications.map((publication) => ({ id: publication.id, version: publication.version, fromAt: publication.fromAt, toAt: publication.toAt, publishedAt: publication.publishedAt, shifts: shiftsForEmployee(publication.snapshot, link.employeeId) })).filter((publication) => publication.shifts.length > 0),
  };
}

export async function acknowledgeSchedule(token: string, version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new WorkflowError("Άκυρη έκδοση προγράμματος");
  const current = await publicSchedule(token);
  if (!current.publications.some((publication) => publication.version === version)) throw new WorkflowError("Η έκδοση δεν ανήκει στο πρόγραμμά σου");
  return db.scheduleLink.updateMany({ where: { tokenHash: hashAccessToken(token), active: true, acknowledgedVersion: { lt: version } }, data: { acknowledgedVersion: version, acknowledgedAt: new Date() } });
}

export async function staffPayrollSummary(ctx: StockContext, fromAt: Date, toAt: Date, storeId?: string | null) {
  requirePermission(ctx, "staff.pay");
  validRange(fromAt, toAt, 366);
  if (storeId) await assertStockScope(db, ctx, { storeId });
  const shifts = await db.shift.findMany({ where: { orgId: ctx.orgId, startsAt: { lt: toAt }, endsAt: { gt: fromAt }, ...(storeId ? { storeId } : ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : ctx.warehouseIds.length ? { storeId: { in: [] } } : {}) }, include: { employee: { include: { pay: true } } } });
  const byEmployee = new Map<string, { employeeId: string; name: string; minutes: number; costCents: number }>();
  for (const shift of shifts) {
    const minutes = workedMinutes(shift.startsAt, shift.endsAt, shift.breakMinutes);
    const rate = shift.hourlyRateCents ?? shift.employee.pay?.hourlyRateCents ?? 0;
    const row = byEmployee.get(shift.employeeId) ?? { employeeId: shift.employeeId, name: shift.employee.name, minutes: 0, costCents: 0 };
    row.minutes += minutes;
    row.costCents += hourlyCostCents(minutes, rate);
    byEmployee.set(shift.employeeId, row);
  }
  return [...byEmployee.values()];
}

export { intervalsOverlap };
