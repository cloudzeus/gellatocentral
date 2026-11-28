"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveApprovalLimit, saveExpenseCategory } from "@/lib/expense-categories-db";
import { redirectUrl } from "@/lib/flash";
import { requireStockContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";

const PATH = "/finance/expense-types";
const back = (query: Record<string, string>): never => { revalidatePath(PATH); redirect(redirectUrl(`${PATH}?${new URLSearchParams(query)}`)); };
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function saveTypeAction(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  const id = text(form, "id") || undefined;
  try {
    const saved = await saveExpenseCategory(ctx, {
      id, code: text(form, "code"), name: text(form, "name"), kind: text(form, "kind"),
      mydataCategory: text(form, "mydataCategory") || null, mydataType: text(form, "mydataType") || null, mydataVatType: text(form, "mydataVatType") || null,
      accountCode: text(form, "accountCode") || null, vatAccountCode: text(form, "vatAccountCode") || null, costCenterId: text(form, "costCenterId") || null,
      active: id ? form.get("active") === "true" : true, source: form.get("byAccountant") === "on" ? "ACCOUNTANT" : "USER",
    });
    back({ t: saved.id, saved: id ? "Ο τύπος ενημερώθηκε" : "Ο τύπος προστέθηκε" });
  } catch (error) {
    back({ ...(id ? { t: id, edit: "1" } : { new: "1" }), error: workflowMessage(error) });
  }
}

export async function saveLimitAction(form: FormData) {
  const ctx = await requireStockContext("finance.read");
  try {
    const raw = text(form, "limit").replace(",", ".");
    await saveApprovalLimit(ctx, raw ? Math.round(Number(raw) * 100) : null);
    back({ saved: raw ? "Το όριο έγκρισης αποθηκεύτηκε" : "Καμία δαπάνη δεν θα περιμένει έγκριση" });
  } catch (error) {
    back({ error: workflowMessage(error) });
  }
}
