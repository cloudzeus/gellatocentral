"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveAllocationRule, saveCostCenter, setCostCenterActive } from "@/lib/cost-centers-db";
import type { Basis } from "@/lib/cost-centers-rules";
import { redirectUrl } from "@/lib/flash";
import { requireStockContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";

const PATH = "/finance/cost-centers";
const back = (query: Record<string, string>): never => { revalidatePath(PATH); redirect(redirectUrl(`${PATH}?${new URLSearchParams(query)}`)); };
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const day = (value: string) => (value ? new Date(`${value}T00:00:00Z`) : null);

export async function saveCenterAction(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  const id = text(form, "id") || undefined;
  try {
    const saved = await saveCostCenter(ctx, { id, code: text(form, "code"), name: text(form, "name"), kind: text(form, "kind"), parentId: text(form, "parentId") || null, accountCode: text(form, "accountCode") || null });
    if (id) await setCostCenterActive(ctx, id, form.get("active") === "true");
    back({ c: saved.id, saved: id ? "Το κέντρο ενημερώθηκε" : "Το κέντρο προστέθηκε" });
  } catch (error) {
    back({ ...(id ? { edit: id, c: id } : { new: "1" }), error: workflowMessage(error) });
  }
}

export async function saveRuleAction(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  const sourceId = text(form, "sourceId");
  const basis = text(form, "basis") as Basis;
  try {
    const validFrom = day(text(form, "validFrom"));
    if (!validFrom) throw new Error("Διάλεξε από πότε ισχύει ο κανόνας");
    // μερίδια μόνο για ποσοστά και τ.μ.· κενό ή 0 = το κατάστημα δεν παίρνει τίποτα. Σε εκατοστά: 50% → 5000, 85 τ.μ. → 8500
    const shares = basis === "FIXED" || basis === "AREA"
      ? form.getAll(`${basis}Id`).map((id, i) => ({ costCenterId: String(id), weight: Math.round(Number(String(form.getAll(`${basis}Value`)[i] ?? "").replace(",", ".")) * 100) })).filter((s) => s.weight > 0)
      : [];
    await saveAllocationRule(ctx, { sourceId, basis, validFrom, validTo: day(text(form, "validTo")), shares, closeOpen: true });
    back({ c: sourceId, saved: "Ο κανόνας αποθηκεύτηκε. Ο προηγούμενος έκλεισε την προηγούμενη μέρα" });
  } catch (error) {
    back({ c: sourceId, basis, error: workflowMessage(error) });
  }
}
