"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { workflowMessage } from "@/lib/workflow-db";
import {
  acceptWholesaleQuote, convertWholesaleQuote, createWholesaleQuote, expireWholesaleQuote,
  rejectWholesaleQuote, sendWholesaleQuote, updateWholesaleQuote,
} from "@/lib/wholesale-db";

const decimal = (value: FormDataEntryValue | null) => Number(String(value ?? "").trim().replace(",", "."));
const cents = (value: FormDataEntryValue | null) => Math.round(decimal(value) * 100);
const date = (value: FormDataEntryValue | null) => { const text = String(value ?? ""); return text ? new Date(text) : null; };

function refresh() {
  revalidatePath("/wholesale-orders");
  revalidatePath("/wholesale-orders/quotes");
}
const back = (path: string, query = ""): never => { refresh(); revalidatePath(path); redirect(`${path}${query}`); };
const fail = (path: string, error: unknown): never => back(path, `?error=${encodeURIComponent(workflowMessage(error))}`);

async function quoteInput(form: FormData, orgId: string) {
  const ids = form.getAll("genericItemId").map(String);
  const quantities = form.getAll("quantity").map(decimal);
  const prices = form.getAll("unitPrice").map(cents);
  const vats = form.getAll("vatRate").map(Number);
  const generics = await db.genericItem.findMany({ where: { orgId, id: { in: ids } }, include: { baseUnit: true } });
  const scales = new Map(generics.map((generic) => [generic.id, stockCostScale(generic.baseUnit.dimension)]));
  const lines = ids.map((genericItemId, index) => {
    const scale = scales.get(genericItemId);
    if (!scale || !Number.isFinite(quantities[index]) || quantities[index] <= 0) throw new Error("Έλεγξε είδη και ποσότητες");
    return { genericItemId, quantityBase: Math.round(quantities[index] * scale), unitPriceCents: prices[index], vatRate: vats[index] };
  });
  return {
    customerId: String(form.get("customerId") ?? ""), storeId: String(form.get("storeId") ?? ""),
    warehouseId: String(form.get("warehouseId") ?? ""), validUntil: date(form.get("validUntil")) ?? new Date(NaN),
    neededAt: date(form.get("neededAt")), note: String(form.get("note") ?? ""), lines,
  };
}

export async function createQuote(form: FormData) {
  const ctx = await requireStockContext("wholesale.add");
  let quoteId = "";
  try { quoteId = (await createWholesaleQuote(ctx, await quoteInput(form, ctx.orgId))).id; }
  catch (error) { fail("/wholesale-orders/quotes", error); }
  back(`/wholesale-orders/quotes/${quoteId}`, "?saved=Η προσφορά δημιουργήθηκε ως πρόχειρη");
}

export async function updateQuote(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("quoteId") ?? "");
  try { await updateWholesaleQuote(ctx, id, await quoteInput(form, ctx.orgId)); }
  catch (error) { fail(`/wholesale-orders/quotes/${id}`, error); }
  back(`/wholesale-orders/quotes/${id}`, "?saved=Η πρόχειρη προσφορά ενημερώθηκε");
}

export async function sendQuote(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("quoteId") ?? "");
  try { await sendWholesaleQuote(ctx, id); }
  catch (error) { fail(`/wholesale-orders/quotes/${id}`, error); }
  back(`/wholesale-orders/quotes/${id}`, "?saved=Η προσφορά σημειώθηκε ως απεσταλμένη· δεν έγινε εξωτερική αποστολή");
}

export async function acceptQuote(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("quoteId") ?? "");
  try { await acceptWholesaleQuote(ctx, id); }
  catch (error) { fail(`/wholesale-orders/quotes/${id}`, error); }
  back(`/wholesale-orders/quotes/${id}`, "?saved=Η προσφορά έγινε αποδεκτή");
}

export async function rejectQuote(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("quoteId") ?? "");
  try { await rejectWholesaleQuote(ctx, id, String(form.get("reason") ?? "")); }
  catch (error) { fail(`/wholesale-orders/quotes/${id}`, error); }
  back(`/wholesale-orders/quotes/${id}`, "?saved=Η προσφορά απορρίφθηκε");
}

export async function expireQuote(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("quoteId") ?? "");
  try { await expireWholesaleQuote(ctx, id); }
  catch (error) { fail(`/wholesale-orders/quotes/${id}`, error); }
  back(`/wholesale-orders/quotes/${id}`, "?saved=Η προσφορά καταχωρήθηκε ως ληγμένη");
}

export async function convertQuote(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("quoteId") ?? "");
  let orderId = "";
  try { orderId = (await convertWholesaleQuote(ctx, id)).id; }
  catch (error) { fail(`/wholesale-orders/quotes/${id}`, error); }
  back(`/wholesale-orders/${orderId}`, "?saved=Η προσφορά μετατράπηκε σε πρόχειρη παραγγελία με τα παγωμένα ποσά");
}
