"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setExternalSendingEnabled } from "@/lib/document-delivery";
import { updateCompanyProfile } from "@/lib/finance-db";
import { requireStockContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";
import { redirectUrl } from "@/lib/flash";

const back = (query: string): never => { revalidatePath("/company"); redirect(redirectUrl(`/company${query}`)); };

export async function saveCompany(form: FormData) {
  const ctx = await requireStockContext("users.edit");
  try {
    await updateCompanyProfile(ctx, {
      name: String(form.get("name") ?? ""), legalName: String(form.get("legalName") ?? ""), vatNumber: String(form.get("vatNumber") ?? ""),
      taxOffice: String(form.get("taxOffice") ?? ""), address: String(form.get("address") ?? ""), city: String(form.get("city") ?? ""), postalCode: String(form.get("postalCode") ?? ""),
      phone: String(form.get("phone") ?? ""), contactEmail: String(form.get("contactEmail") ?? ""), emailFromName: String(form.get("emailFromName") ?? ""),
      logoUrl: String(form.get("logoUrl") ?? ""), labelExtraText: String(form.get("labelExtraText") ?? ""),
    });
    await setExternalSendingEnabled(ctx, form.get("externalSendingEnabled") === "true");
    back("?saved=Τα στοιχεία επιχείρησης αποθηκεύτηκαν");
  } catch (error) { back(`?error=${encodeURIComponent(workflowMessage(error))}`); }
}
