"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStockContext } from "@/lib/stock-context";
import { createLeave, createScheduleLink, createShift, publishSchedule, saveDepartment, saveEmployee, saveEmployeePay } from "@/lib/staff-db";
import { workflowMessage } from "@/lib/workflow-db";
import { redirectUrl } from "@/lib/flash";
import { db } from "@/lib/db";
import { pinHash } from "@/lib/till-shift";

const cents = (value: FormDataEntryValue | null) => Math.round(Number(String(value ?? "0").replace(",", ".")) * 100);
const date = (value: FormDataEntryValue | null) => String(value ?? "") ? new Date(String(value)) : null;
const back = (query = ""): never => { revalidatePath("/staff"); redirect(redirectUrl(`/staff${query}`)); };
const fail = (error: unknown): never => back(`?error=${encodeURIComponent(workflowMessage(error))}`);

export async function newDepartment(form: FormData) {
  const ctx = await requireStockContext("staff.add");
  try { await saveDepartment(ctx, { name: String(form.get("name") ?? ""), kind: String(form.get("kind") ?? "other") }); back("?saved=Το τμήμα αποθηκεύτηκε"); } catch (error) { fail(error); }
}

export async function newEmployee(form: FormData) {
  const ctx = await requireStockContext("staff.add");
  try {
    await saveEmployee(ctx, {
      name: String(form.get("name") ?? ""), departmentId: String(form.get("departmentId") ?? "") || null,
      storeId: String(form.get("storeId") ?? "") || null, warehouseId: String(form.get("warehouseId") ?? "") || null,
      phone: String(form.get("phone") ?? ""), email: String(form.get("email") ?? ""),
      startDate: date(form.get("startDate")), endDate: date(form.get("endDate")),
    });
    back("?saved=Ο εργαζόμενος αποθηκεύτηκε");
  } catch (error) { fail(error); }
}

export async function employeePay(form: FormData) {
  const ctx = await requireStockContext("staff.pay");
  try {
    await saveEmployeePay(ctx, String(form.get("employeeId") ?? ""), {
      payType: String(form.get("payType") ?? "HOURLY"), hourlyRateCents: cents(form.get("hourlyRate")), monthlySalaryCents: cents(form.get("monthlySalary")),
      iban: String(form.get("iban") ?? ""), vatNumber: String(form.get("vatNumber") ?? ""), notes: String(form.get("notes") ?? ""),
    });
    back("?saved=Τα στοιχεία αμοιβής αποθηκεύτηκαν");
  } catch (error) { fail(error); }
}

export async function newShift(form: FormData) {
  const ctx = await requireStockContext("staff.add");
  try {
    await createShift(ctx, {
      employeeId: String(form.get("employeeId") ?? ""), departmentId: String(form.get("departmentId") ?? "") || null,
      storeId: String(form.get("storeId") ?? "") || null, startsAt: date(form.get("startsAt")) ?? new Date(NaN), endsAt: date(form.get("endsAt")) ?? new Date(NaN),
      breakMinutes: Number(form.get("breakMinutes") ?? 0), hourlyRateCents: ctx.can("staff.pay") && String(form.get("hourlyRate") ?? "") ? cents(form.get("hourlyRate")) : null,
      note: String(form.get("note") ?? ""),
    });
    back("?saved=Η βάρδια αποθηκεύτηκε");
  } catch (error) { fail(error); }
}

export async function newLeave(form: FormData) {
  const ctx = await requireStockContext("staff.add");
  try {
    await createLeave(ctx, { employeeId: String(form.get("employeeId") ?? ""), kind: String(form.get("kind") ?? ""), fromAt: date(form.get("fromAt")) ?? new Date(NaN), toAt: date(form.get("toAt")) ?? new Date(NaN), note: String(form.get("note") ?? "") });
    back("?saved=Η άδεια καταχωρήθηκε");
  } catch (error) { fail(error); }
}

export async function publishStaffSchedule(form: FormData) {
  const ctx = await requireStockContext("staff.edit");
  try {
    const publication = await publishSchedule(ctx, { storeId: String(form.get("storeId") ?? "") || null, groupKind: String(form.get("groupKind") ?? "store"), fromAt: date(form.get("fromAt")) ?? new Date(NaN), toAt: date(form.get("toAt")) ?? new Date(NaN) });
    back(`?saved=${encodeURIComponent(`Δημοσιεύθηκε η έκδοση ${publication.version}`)}`);
  } catch (error) { fail(error); }
}

export async function issueScheduleLink(employeeId: string) {
  const ctx = await requireStockContext("staff.edit");
  try { const result = await createScheduleLink(ctx, employeeId); revalidatePath("/staff"); return { token: result.token as string, error: null as string | null }; }
  catch (error) { return { token: null as string | null, error: workflowMessage(error) }; }
}

/** PIN ταμείου (4 ψηφία) για να ανοίγει ο υπάλληλος βάρδια στο ταμείο Android του καταστήματός του. Κενό = αφαίρεση. */
export async function setTillPin(employeeId: string, form: FormData) {
  const ctx = await requireStockContext("staff.edit");
  const pin = String(form.get("pin") ?? "").trim();
  if (pin && !/^\d{4}$/.test(pin)) back(`?error=${encodeURIComponent("Το PIN είναι 4 ψηφία")}`);
  const employee = await db.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId, ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}) }, select: { id: true, name: true, storeId: true } });
  if (!employee) back(`?error=${encodeURIComponent("Ο εργαζόμενος δεν βρέθηκε")}`);
  if (pin && !employee!.storeId) back(`?error=${encodeURIComponent("Διάλεξε πρώτα κατάστημα για τον εργαζόμενο: μπαίνει στα ταμεία του καταστήματός του")}`);
  await db.employee.update({ where: { id: employee!.id }, data: { tillPinHash: pin ? pinHash(employee!.id, pin) : null } });
  back(`?saved=${encodeURIComponent(pin ? `Ο/η ${employee!.name} μπαίνει πλέον στο ταμείο με το PIN του` : `Αφαιρέθηκε το PIN ταμείου του/της ${employee!.name}`)}`);
}
