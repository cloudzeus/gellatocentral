"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStockContext } from "@/lib/stock-context";
import { addMachineMaintenance, completeProductionSchedule, createProductionSchedule, recordHaccpLotCheck, saveMachine, setLotHold, setProductionScheduleStatus } from "@/lib/production-workflow-db";
import { workflowMessage } from "@/lib/workflow-db";

const back = (path: string, key: "saved" | "error", value: string): never => {
  revalidatePath("/production");
  revalidatePath(path);
  redirect(`${path}?${key}=${encodeURIComponent(value)}`);
};
const run = async (path: string, operation: () => Promise<unknown>, success: string) => {
  try { await operation(); back(path, "saved", success); }
  catch (error) { back(path, "error", workflowMessage(error)); }
};
const date = (value: FormDataEntryValue | null) => new Date(String(value ?? ""));
const optionalDate = (value: FormDataEntryValue | null) => String(value ?? "") ? date(value) : null;

export async function createPlan(form: FormData) {
  const ctx = await requireStockContext("production.add");
  await run("/production/plans", () => createProductionSchedule(ctx, {
    storeId: String(form.get("storeId") ?? "") || null,
    recipeId: String(form.get("recipeId") ?? ""),
    sourceWarehouseId: String(form.get("sourceWarehouseId") ?? ""),
    destinationWarehouseId: String(form.get("destinationWarehouseId") ?? ""),
    machineId: String(form.get("machineId") ?? "") || null,
    operatorEmployeeId: String(form.get("operatorEmployeeId") ?? "") || null,
    plannedFor: date(form.get("plannedFor")), quantityGrams: Number(form.get("quantityGrams")), note: String(form.get("note") ?? ""),
  }), "Ο προγραμματισμός δημιουργήθηκε");
}

export async function changePlanStatus(form: FormData) {
  const ctx = await requireStockContext("production.add");
  const status = String(form.get("status")) === "CANCELLED" ? "CANCELLED" : "IN_PROGRESS";
  await run("/production/plans", () => setProductionScheduleStatus(ctx, String(form.get("planId") ?? ""), status), "Η κατάσταση άλλαξε");
}

export async function completePlan(form: FormData) {
  const ctx = await requireStockContext("production.add");
  await run("/production/plans", () => completeProductionSchedule(ctx, String(form.get("planId") ?? ""), {
    quantityGrams: Number(form.get("quantityGrams")), scrapReason: String(form.get("scrapReason") ?? ""),
    labourMinutes: Number(form.get("labourMinutes") ?? 0), labourCostCents: Math.round(Number(String(form.get("labourCost") ?? "0").replace(",", ".")) * 100),
    batchNumber: String(form.get("batchNumber") ?? "") || null, note: String(form.get("note") ?? ""),
  }), "Η παραγωγή ολοκληρώθηκε με FEFO και output lot");
}

export async function createMachine(form: FormData) {
  const ctx = await requireStockContext("production.add");
  await run("/production/machines", () => saveMachine(ctx, {
    warehouseId: String(form.get("warehouseId") ?? "") || null, name: String(form.get("name") ?? ""), code: String(form.get("code") ?? ""),
    capacityGrams: String(form.get("capacityGrams") ?? "") ? Number(form.get("capacityGrams")) : null,
  }), "Το μηχάνημα αποθηκεύτηκε");
}

export async function addMaintenance(form: FormData) {
  const ctx = await requireStockContext("production.add");
  await run("/production/machines", () => addMachineMaintenance(ctx, {
    machineId: String(form.get("machineId") ?? ""), kind: String(form.get("kind") ?? ""), performedAt: date(form.get("performedAt")), nextDueAt: optionalDate(form.get("nextDueAt")),
    costCents: Math.round(Number(String(form.get("cost") ?? "0").replace(",", ".")) * 100), notes: String(form.get("notes") ?? ""),
  }), "Η συντήρηση καταγράφηκε");
}

export async function checkOutputLot(form: FormData) {
  const batchId = String(form.get("batchId") ?? "");
  const ctx = await requireStockContext("haccp.add");
  await run(`/production/${batchId}`, () => recordHaccpLotCheck(ctx, {
    lotId: String(form.get("lotId") ?? ""), batchId, kind: String(form.get("kind") ?? ""),
    measuredValue: String(form.get("measuredValue") ?? "") ? Number(String(form.get("measuredValue")).replace(",", ".")) : null,
    unit: String(form.get("unit") ?? ""), minimum: String(form.get("minimum") ?? "") ? Number(String(form.get("minimum")).replace(",", ".")) : null,
    maximum: String(form.get("maximum") ?? "") ? Number(String(form.get("maximum")).replace(",", ".")) : null,
    notes: String(form.get("notes") ?? ""), correctiveAction: String(form.get("correctiveAction") ?? ""),
  }), "Ο έλεγχος HACCP καταγράφηκε");
}

export async function changeLotHold(form: FormData) {
  const batchId = String(form.get("batchId") ?? "");
  const ctx = await requireStockContext("haccp.edit");
  const raw = String(form.get("status") ?? "");
  const status = raw === "RELEASED" || raw === "REJECTED" ? raw : "HELD";
  await run(`/production/${batchId}`, () => setLotHold(ctx, { lotId: String(form.get("lotId") ?? ""), status, reason: String(form.get("reason") ?? "") }), "Η κατάσταση παρτίδας άλλαξε");
}

export async function closeDay(form: FormData) {
  const businessDate = String(form.get("businessDate") ?? "");
  const sourceWarehouseId = String(form.get("sourceWarehouseId") ?? "");
  const destinationWarehouseId = String(form.get("destinationWarehouseId") ?? "");
  const query = new URLSearchParams({ date: businessDate, source: sourceWarehouseId, destination: destinationWarehouseId });
  try {
    const ctx = await requireStockContext("production.add", { warehouseIds: [sourceWarehouseId, destinationWarehouseId], forWrite: true });
    const { closeProductionDay } = await import("@/lib/production-day-close-db");
    const close = await closeProductionDay(ctx, {
      businessDate, sourceWarehouseId, destinationWarehouseId, clientKey: String(form.get("clientKey") ?? ""),
      actuals: form.getAll("planId").map((value) => {
        const planId = String(value);
        return {
          planId, quantityGrams: Number(form.get(`actual:${planId}`)), scrapReason: String(form.get(`scrap:${planId}`) ?? ""),
          labourMinutes: Number(form.get(`minutes:${planId}`) ?? 0),
          labourCostCents: Math.round(Number(String(form.get(`labour:${planId}`) ?? "0").replace(",", ".")) * 100),
        };
      }),
    });
    const snapshot = close.snapshot as { results?: unknown[] };
    query.set("saved", `Το κλείσιμο ολοκληρώθηκε με ${snapshot.results?.length ?? 0} παρτίδες`);
  } catch (error) {
    query.set("error", workflowMessage(error));
  }
  revalidatePath("/production");
  revalidatePath("/production/close");
  redirect(`/production/close?${query}`);
}
