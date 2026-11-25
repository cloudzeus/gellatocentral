"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveLegalEntity, setStoreIssuer } from "@/lib/documents/settings-db";
import { redirectUrl } from "@/lib/flash";
import { requireStockContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";

const back = (query: string): never => { revalidatePath("/company/issuers"); redirect(redirectUrl(`/company/issuers${query}`)); };
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function saveIssuer(form: FormData) {
  const ctx = await requireStockContext("users.edit");
  const id = text(form, "id") || undefined;
  try {
    await saveLegalEntity(ctx, {
      id, name: text(form, "name"), vatNumber: text(form, "vatNumber"), taxOffice: text(form, "taxOffice"),
      address: text(form, "address"), city: text(form, "city"), postalCode: text(form, "postalCode"), phone: text(form, "phone"),
      active: id ? form.get("active") === "true" : true,
    });
    back(`?saved=${encodeURIComponent(id ? "Ο εκδότης ενημερώθηκε" : "Ο εκδότης προστέθηκε. Διάλεξε τώρα ποια καταστήματα εκδίδουν με αυτόν")}`);
  } catch (error) {
    back(`?${id ? `edit=${id}&` : "new=1&"}error=${encodeURIComponent(workflowMessage(error))}`);
  }
}

export async function changeStoreIssuer(form: FormData) {
  const ctx = await requireStockContext("users.edit");
  try {
    await setStoreIssuer(ctx, text(form, "storeId"), text(form, "legalEntityId") || null);
    back(`?saved=${encodeURIComponent("Το κατάστημα εκδίδει από τώρα με τον νέο εκδότη")}`);
  } catch (error) {
    back(`?error=${encodeURIComponent(workflowMessage(error))}`);
  }
}
