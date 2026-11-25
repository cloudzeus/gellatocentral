"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createB2bOrder } from "@/lib/wholesale-db";
import { workflowMessage } from "@/lib/workflow-db";

export async function submitB2bOrder(form: FormData) {
  const token = String(form.get("token") ?? "");
  const path = `/b2b/${encodeURIComponent(token)}`;
  try {
    const lines = form.getAll("genericItemId").map(String).flatMap((genericItemId) => {
      const quantity = Number(String(form.get(`quantity:${genericItemId}`) ?? "0").replace(",", "."));
      return Number.isFinite(quantity) && quantity > 0 ? [{ genericItemId, quantityBase: Math.round(quantity * Number(form.get(`scale:${genericItemId}`))) }] : [];
    });
    const order = await createB2bOrder(token, {
      storeId: String(form.get("storeId") ?? ""), warehouseId: String(form.get("warehouseId") ?? ""),
      neededAt: String(form.get("neededAt") ?? "") ? new Date(String(form.get("neededAt"))) : null,
      note: String(form.get("note") ?? ""), externalKey: String(form.get("externalKey") ?? randomUUID()), lines,
    });
    revalidatePath(path);
    redirect(`${path}?saved=${encodeURIComponent(`Η παραγγελία ${order.number} καταχωρήθηκε`)}`);
  } catch (error) { redirect(`${path}?error=${encodeURIComponent(workflowMessage(error))}`); }
}
