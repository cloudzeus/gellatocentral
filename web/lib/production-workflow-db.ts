// Προγραμματισμός, μηχανήματα και ποιοτικά holds πάνω στον κοινό tenant/warehouse writer.
import { stockTransaction } from "./stock-transaction";
import { assertGlobalStockScope, assertStockScope, type StockContext } from "./stock-scope";
import { assertNonNegativeInt, assertPositiveInt, auditWorkflow, cleanText, WorkflowError } from "./workflow-db";
import { closeProductionBatch, type CloseProductionInput } from "./production-db";

export async function saveMachine(ctx: StockContext, input: { id?: string; warehouseId?: string | null; name: string; code?: string | null; capacityGrams?: number | null; active?: boolean }) {
  const name = cleanText(input.name, "Όνομα μηχανήματος", 120, true)!;
  const code = cleanText(input.code, "Κωδικός", 60);
  if (input.capacityGrams != null) assertPositiveInt(input.capacityGrams, "Δυναμικότητα");
  return stockTransaction(async (tx) => {
    if (!input.warehouseId) assertGlobalStockScope(ctx);
    await assertStockScope(tx, ctx, { warehouseId: input.warehouseId ?? undefined, forWrite: true });
    const data = { warehouseId: input.warehouseId ?? null, name, code, capacityGrams: input.capacityGrams ?? null, active: input.active ?? true };
    if (input.id) {
      const existing = await tx.machine.findFirst({ where: { id: input.id, orgId: ctx.orgId } });
      if (!existing) throw new WorkflowError("Το μηχάνημα δεν βρέθηκε");
      if (!existing.warehouseId) assertGlobalStockScope(ctx);
      await assertStockScope(tx, ctx, { warehouseId: existing.warehouseId ?? undefined, forWrite: true });
    }
    const machine = input.id
      ? await tx.machine.update({ where: { id: input.id }, data })
      : await tx.machine.create({ data: { ...data, orgId: ctx.orgId } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: input.id ? "machine.edit" : "machine.create", entityType: "machine", entityId: machine.id, warehouseId: machine.warehouseId });
    return machine;
  });
}

export async function addMachineMaintenance(ctx: StockContext, input: { machineId: string; kind: string; performedAt: Date; nextDueAt?: Date | null; costCents: number; notes?: string | null }) {
  const kind = cleanText(input.kind, "Είδος συντήρησης", 100, true)!;
  assertNonNegativeInt(input.costCents, "Κόστος συντήρησης");
  if (Number.isNaN(input.performedAt.getTime()) || (input.nextDueAt && input.nextDueAt < input.performedAt)) throw new WorkflowError("Άκυρες ημερομηνίες συντήρησης");
  return stockTransaction(async (tx) => {
    const machine = await tx.machine.findFirst({ where: { id: input.machineId, orgId: ctx.orgId } });
    if (!machine) throw new WorkflowError("Το μηχάνημα δεν βρέθηκε");
    if (!machine.warehouseId) assertGlobalStockScope(ctx);
    await assertStockScope(tx, ctx, { warehouseId: machine.warehouseId ?? undefined, forWrite: true });
    const maintenance = await tx.machineMaintenance.create({ data: { orgId: ctx.orgId, machineId: machine.id, kind, performedAt: input.performedAt, nextDueAt: input.nextDueAt ?? null, costCents: input.costCents, notes: cleanText(input.notes, "Σημειώσεις", 500), createdByName: ctx.userName } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "machine.maintenance", entityType: "machine", entityId: machine.id, warehouseId: machine.warehouseId, metadata: { maintenanceId: maintenance.id, costCents: input.costCents } });
    return maintenance;
  });
}

export async function createProductionSchedule(ctx: StockContext, input: { storeId?: string | null; recipeId: string; sourceWarehouseId: string; destinationWarehouseId: string; machineId?: string | null; operatorEmployeeId?: string | null; plannedFor: Date; quantityGrams: number; note?: string | null }) {
  assertPositiveInt(input.quantityGrams, "Ποσότητα προγραμματισμού");
  if (Number.isNaN(input.plannedFor.getTime())) throw new WorkflowError("Άκυρη ημερομηνία προγραμματισμού");
  return stockTransaction(async (tx) => {
    await assertStockScope(tx, ctx, { storeId: input.storeId ?? undefined, warehouseIds: [input.sourceWarehouseId, input.destinationWarehouseId], forWrite: true });
    const recipe = await tx.recipe.findFirst({ where: { id: input.recipeId, orgId: ctx.orgId, active: true }, select: { id: true } });
    if (!recipe) throw new WorkflowError("Η συνταγή δεν βρέθηκε");
    if (input.machineId) {
      const machine = await tx.machine.findFirst({ where: { id: input.machineId, orgId: ctx.orgId, active: true } });
      if (!machine || (machine.warehouseId && ![input.sourceWarehouseId, input.destinationWarehouseId].includes(machine.warehouseId))) throw new WorkflowError("Το μηχάνημα δεν είναι διαθέσιμο στις επιλεγμένες αποθήκες");
      if (machine.capacityGrams && input.quantityGrams > machine.capacityGrams) throw new WorkflowError("Η ποσότητα υπερβαίνει τη δυναμικότητα του μηχανήματος");
    }
    if (input.operatorEmployeeId) {
      const employee = await tx.employee.findFirst({ where: { id: input.operatorEmployeeId, orgId: ctx.orgId, active: true } });
      if (!employee) throw new WorkflowError("Ο χειριστής δεν βρέθηκε");
      await assertStockScope(tx, ctx, { storeId: employee.storeId ?? undefined, warehouseId: employee.warehouseId ?? undefined });
    }
    const plan = await tx.productionPlan.create({ data: { orgId: ctx.orgId, storeId: input.storeId ?? null, recipeId: recipe.id, sourceWarehouseId: input.sourceWarehouseId, destinationWarehouseId: input.destinationWarehouseId, machineId: input.machineId ?? null, operatorEmployeeId: input.operatorEmployeeId ?? null, plannedFor: input.plannedFor, quantityGrams: input.quantityGrams, note: cleanText(input.note, "Σημείωση", 500), createdByName: ctx.userName } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "production.plan", entityType: "production_plan", entityId: plan.id, warehouseId: plan.sourceWarehouseId, storeId: plan.storeId, metadata: { quantityGrams: plan.quantityGrams, plannedFor: plan.plannedFor.toISOString() } });
    return plan;
  });
}

export async function setProductionScheduleStatus(ctx: StockContext, planId: string, status: "IN_PROGRESS" | "CANCELLED") {
  return stockTransaction(async (tx) => {
    const plan = await tx.productionPlan.findFirst({ where: { id: planId, orgId: ctx.orgId } });
    if (!plan) throw new WorkflowError("Ο προγραμματισμός δεν βρέθηκε");
    await assertStockScope(tx, ctx, { storeId: plan.storeId ?? undefined, warehouseId: plan.sourceWarehouseId, forWrite: true });
    if (plan.batchId || !["PLANNED", "IN_PROGRESS"].includes(plan.status) || (status === "IN_PROGRESS" && plan.status !== "PLANNED")) throw new WorkflowError("Η αλλαγή κατάστασης δεν επιτρέπεται");
    const updated = await tx.productionPlan.update({ where: { id: plan.id }, data: { status } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: `production.${status === "CANCELLED" ? "cancel" : "start"}`, entityType: "production_plan", entityId: plan.id, warehouseId: plan.sourceWarehouseId, storeId: plan.storeId });
    return updated;
  });
}

export async function completeProductionSchedule(ctx: StockContext, planId: string, input: Omit<CloseProductionInput, "recipeId" | "warehouseId" | "destinationWarehouseId" | "expectedQuantityGrams" | "productionPlanId">) {
  const { db } = await import("./db");
  const plan = await db.productionPlan.findFirst({ where: { id: planId, orgId: ctx.orgId } });
  if (!plan) throw new WorkflowError("Ο προγραμματισμός δεν βρέθηκε");
  return closeProductionBatch(ctx, { ...input, recipeId: plan.recipeId, warehouseId: plan.sourceWarehouseId, destinationWarehouseId: plan.destinationWarehouseId, expectedQuantityGrams: plan.quantityGrams, productionPlanId: plan.id });
}

export async function recordHaccpLotCheck(ctx: StockContext, input: { lotId: string; batchId?: string | null; kind: string; measuredValue?: number | null; unit?: string | null; minimum?: number | null; maximum?: number | null; notes?: string | null; correctiveAction?: string | null }) {
  const kind = cleanText(input.kind, "Τύπος ελέγχου", 100, true)!;
  if (input.measuredValue != null && !Number.isFinite(input.measuredValue)) throw new WorkflowError("Άκυρη μέτρηση");
  const conforming = input.measuredValue == null ? false : (input.minimum == null || input.measuredValue >= input.minimum) && (input.maximum == null || input.measuredValue <= input.maximum);
  const correctiveAction = cleanText(input.correctiveAction, "Διορθωτική ενέργεια", 500);
  if (!conforming && !correctiveAction) throw new WorkflowError("Η απόκλιση χρειάζεται διορθωτική ενέργεια");
  return stockTransaction(async (tx) => {
    const lot = await tx.stockLot.findFirst({ where: { id: input.lotId, orgId: ctx.orgId } });
    if (!lot) throw new WorkflowError("Η παρτίδα δεν βρέθηκε");
    await assertStockScope(tx, ctx, { warehouseId: lot.warehouseId, forWrite: true });
    if (input.batchId) {
      const batch = await tx.productionBatch.findFirst({ where: { id: input.batchId, orgId: ctx.orgId } });
      if (!batch || batch.outputLotId !== lot.id) throw new WorkflowError("Η παρτίδα παραγωγής δεν συνδέεται με το output lot");
    }
    const check = await tx.haccpLotCheck.create({ data: { orgId: ctx.orgId, lotId: lot.id, batchId: input.batchId ?? lot.productionBatchId, kind, measuredValue: input.measuredValue ?? null, unit: cleanText(input.unit, "Μονάδα", 30), minimum: input.minimum ?? null, maximum: input.maximum ?? null, conforming, notes: cleanText(input.notes, "Σημειώσεις", 500), correctiveAction, checkedByName: ctx.userName } });
    if (!conforming) await tx.stockLot.update({ where: { id: lot.id }, data: { holdStatus: "HELD", holdReason: `${kind}: ${correctiveAction}` } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "haccp.lot.check", entityType: "stock_lot", entityId: lot.id, warehouseId: lot.warehouseId, metadata: { checkId: check.id, conforming, measuredValue: input.measuredValue } });
    return check;
  });
}

export async function setLotHold(ctx: StockContext, input: { lotId: string; status: "HELD" | "RELEASED" | "REJECTED"; reason: string }) {
  const reason = cleanText(input.reason, "Αιτιολογία", 300, true)!;
  return stockTransaction(async (tx) => {
    const lot = await tx.stockLot.findFirst({ where: { id: input.lotId, orgId: ctx.orgId } });
    if (!lot) throw new WorkflowError("Η παρτίδα δεν βρέθηκε");
    await assertStockScope(tx, ctx, { warehouseId: lot.warehouseId, forWrite: true });
    const updated = await tx.stockLot.update({ where: { id: lot.id }, data: { holdStatus: input.status, holdReason: reason } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "haccp.lot.hold", entityType: "stock_lot", entityId: lot.id, warehouseId: lot.warehouseId, reason, metadata: { status: input.status } });
    return updated;
  });
}
