"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveSeries } from "@/lib/documents/settings-db";
import { redirectUrl } from "@/lib/flash";
import { requireStockContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";

const back = (query: string): never => { revalidatePath("/company/series"); redirect(redirectUrl(`/company/series${query}`)); };
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function saveSeriesAction(form: FormData) {
  const ctx = await requireStockContext("users.edit");
  const id = text(form, "id") || undefined;
  try {
    await saveSeries(ctx, {
      id, docType: text(form, "docType"), code: text(form, "code"), name: text(form, "name"), storeId: text(form, "storeId"),
      nextAa: Number(text(form, "nextAa") || "1"), isDefault: form.get("isDefault") === "true", active: id ? form.get("active") === "true" : true,
    });
    back(`?saved=${encodeURIComponent(id ? "Η σειρά ενημερώθηκε" : "Η σειρά προστέθηκε και εμφανίζεται στην έκδοση")}`);
  } catch (error) {
    // η φόρμα ξανανοίγει με όσα έγραψε ο χρήστης, για να μη τα ξαναγράψει
    const keep = new URLSearchParams({ ...(id ? { edit: id } : { new: "1" }), type: text(form, "docType"), store: text(form, "storeId"), code: text(form, "code"), name: text(form, "name"), error: workflowMessage(error) });
    back(`?${keep}`);
  }
}
