"use server";

import { flashOk } from "@/lib/flash-server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createInvoiceFromReceipt, createOrderInvoice, createPurchaseOrder, resolveShortfall, type ShortfallDecision, cancelPurchaseOrder, markPurchaseOrderSent, receivePurchaseOrder, reversePurchaseReceipt, reviewPurchaseReceipt, reviewReceiptInvoice, saveMrpSetting } from "@/lib/procurement-db";
import { awardRfq, createRfq, regenerateRfqInvitation } from "@/lib/rfq-db";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { workflowMessage } from "@/lib/workflow-db";
import { redirectUrl } from "@/lib/flash";

const back = (path: string, query = ""): never => { revalidatePath("/orders"); revalidatePath(path); redirect(redirectUrl(`${path}${query}`)); };
const fail = (path: string, error: unknown): never => back(path, `?error=${encodeURIComponent(workflowMessage(error))}`);
const decimal = (value: FormDataEntryValue | null) => Number(String(value ?? "").trim().replace(",", "."));
const cents = (value: FormDataEntryValue | null) => Math.round(decimal(value) * 100);

export async function createOrder(form: FormData) {
  const ctx = await requireStockContext("orders.add");
  const ids = form.getAll("genericItemId").map(String);
  const quantities = form.getAll("quantity").map(decimal);
  const prices = form.getAll("unitPrice").map(cents);
  const vats = form.getAll("vatRate").map(Number);
  try {
    const generics = await db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: ids } }, include: { baseUnit: true } });
    const scales = new Map(generics.map((g) => [g.id, stockCostScale(g.baseUnit.dimension)]));
    const lines = ids.map((genericItemId, index) => {
      const scale = scales.get(genericItemId);
      if (!scale || !Number.isFinite(quantities[index]) || quantities[index] <= 0) throw new Error("Έλεγξε είδη και ποσότητες");
      return { genericItemId, quantityBase: Math.round(quantities[index] * scale), unitPriceCents: prices[index], vatRate: vats[index] };
    });
    const date = String(form.get("expectedAt") ?? "");
    const order = await createPurchaseOrder(ctx, { supplierId: String(form.get("supplierId") ?? ""), warehouseId: String(form.get("warehouseId") ?? ""), expectedAt: date ? new Date(`${date}T12:00:00Z`) : null, note: String(form.get("note") ?? ""), lines });
    await flashOk("Η παραγγελία αγοράς δημιουργήθηκε");
    back(`/orders/${order.id}`);
  } catch (error) { fail("/orders", error); }
}

export async function sendOrder(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("orderId") ?? "");
  try { await markPurchaseOrderSent(ctx, id); back(`/orders/${id}`, "?saved=Η αποστολή καταγράφηκε"); } catch (error) { fail(`/orders/${id}`, error); }
}

export async function cancelOrder(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("orderId") ?? "");
  try { await cancelPurchaseOrder(ctx, id, String(form.get("reason") ?? "")); back(`/orders/${id}`, "?saved=Η παραγγελία ακυρώθηκε"); } catch (error) { fail(`/orders/${id}`, error); }
}

export async function receiveOrder(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("orderId") ?? "");
  try {
    const lines = [...form.keys()].filter((key) => key.startsWith("receipt:")).flatMap((key) => {
      const orderLineId = key.slice(8);
      const quantityBase = Number(form.get(key));
      if (!quantityBase) return [];
      const expiry = String(form.get(`expiry:${orderLineId}`) ?? "");
      return [{ orderLineId, quantityBase, batchNumber: String(form.get(`batch:${orderLineId}`) ?? ""), expiresAt: expiry ? new Date(`${expiry}T00:00:00Z`) : null }];
    });
    const noteDate = String(form.get("deliveryNoteDate") ?? "");
    const deliveryNote = { number: String(form.get("deliveryNoteNumber") ?? ""), date: noteDate ? new Date(`${noteDate}T00:00:00Z`) : null, mark: String(form.get("deliveryNoteMark") ?? "") };
    const receipt = await receivePurchaseOrder(ctx, { orderId: id, clientKey: String(form.get("clientKey") ?? randomUUID()), lines, deliveryNote, shortfall: shortfallDecisions(form) });
    back(`/orders/${id}`, `?saved=${encodeURIComponent(`Η παραλαβή ${receipt.id.slice(-8)} καταχωρήθηκε`)}`);
  } catch (error) { fail(`/orders/${id}`, error); }
}

export async function reviewReceipt(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("orderId") ?? "");
  try {
    await reviewPurchaseReceipt(ctx, { receiptId: String(form.get("receiptId") ?? ""), note: String(form.get("note") ?? "") });
    revalidatePath("/purchases");
    back(`/orders/${id}`, "?saved=Ο τιμολογιακός έλεγχος της παραλαβής ολοκληρώθηκε");
  } catch (error) { fail(`/orders/${id}`, error); }
}

export async function invoiceReceipt(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("orderId") ?? "");
  try {
    const date = String(form.get("issuedAt") ?? "");
    const lines = [...form.keys()].filter((key) => key.startsWith("invoiceQty:")).map((key) => {
      const receiptLineId = key.slice(11);
      return {
        receiptLineId,
        quantityBase: Number(form.get(key)),
        unitPriceCents: cents(form.get(`invoicePrice:${receiptLineId}`)),
        discountBps: Math.round(decimal(form.get(`invoiceDiscount:${receiptLineId}`)) * 100),
        vatRate: Number(form.get(`invoiceVat:${receiptLineId}`)),
      };
    });
    const invoice = await createInvoiceFromReceipt(ctx, {
      receiptId: String(form.get("receiptId") ?? ""), number: String(form.get("number") ?? ""), issuedAt: new Date(`${date}T00:00:00Z`), lines,
    });
    revalidatePath("/purchases");
    const message = invoice.status === "DRAFT"
      ? `Το τιμολόγιο ${invoice.number ?? invoice.id.slice(-8)} καταγράφηκε με αποκλίσεις και απαιτεί αιτιολογημένη αποδοχή`
      : `Το τιμολόγιο ${invoice.number ?? invoice.id.slice(-8)} ταυτοποιήθηκε και συνδέθηκε με την παραλαβή`;
    back(`/orders/${id}`, `?saved=${encodeURIComponent(message)}`);
  } catch (error) { fail(`/orders/${id}`, error); }
}

export async function reviewInvoiceReceipt(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("orderId") ?? "");
  try {
    const invoice = await reviewReceiptInvoice(ctx, { receiptId: String(form.get("receiptId") ?? ""), note: String(form.get("note") ?? "") });
    revalidatePath("/purchases");
    revalidatePath(`/purchases/${invoice.id}`);
    back(`/orders/${id}`, "?saved=Το τιμολόγιο με αποκλίσεις εγκρίθηκε και καταχωρήθηκε οικονομικά");
  } catch (error) { fail(`/orders/${id}`, error); }
}

export async function reverseReceipt(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("orderId") ?? "");
  try {
    await reversePurchaseReceipt(ctx, String(form.get("receiptId") ?? ""), String(form.get("reason") ?? ""));
    back(`/orders/${id}`, "?saved=Η παραλαβή αναιρέθηκε με αντίθετες κινήσεις");
  } catch (error) { fail(`/orders/${id}`, error); }
}

export async function saveMrp(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  try {
    await saveMrpSetting(ctx, { genericItemId: String(form.get("genericItemId") ?? ""), warehouseId: String(form.get("warehouseId") ?? "") || null, supplierId: String(form.get("supplierId") ?? "") || null, leadDays: Number(form.get("leadDays")), coverDays: Number(form.get("coverDays")), minimumBaseQty: Number(form.get("minimumBaseQty")), orderMultipleBase: Number(form.get("orderMultipleBase")) });
    back("/orders/mrp", "?saved=1");
  } catch (error) { fail("/orders/mrp", error); }
}

export async function newRfq(form: FormData) {
  const ctx = await requireStockContext("orders.add");
  try {
    const ids = form.getAll("genericItemId").map(String);
    const quantities = form.getAll("quantity").map(decimal);
    const generics = await db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: ids } }, include: { baseUnit: true } });
    const scales = new Map(generics.map((g) => [g.id, stockCostScale(g.baseUnit.dimension)]));
    const lines = ids.flatMap((genericItemId, i) => Number.isFinite(quantities[i]) && quantities[i] > 0 ? [{ genericItemId, quantityBase: Math.round(quantities[i] * (scales.get(genericItemId) ?? 0)) }] : []);
    const result = await createRfq(ctx, { replyBy: new Date(`${String(form.get("replyBy"))}T12:00:00Z`), note: String(form.get("note") ?? ""), supplierIds: form.getAll("supplierIds").map(String), lines });
    const first = result.invitations[0];
    back(`/orders/rfqs/${result.rfq.id}`, `?invitation=${encodeURIComponent(first?.token ?? "")}`);
  } catch (error) { fail("/orders/rfqs", error); }
}

export async function reinviteRfq(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("rfqId") ?? "");
  try { const token = await regenerateRfqInvitation(ctx, String(form.get("rfqSupplierId") ?? "")); back(`/orders/rfqs/${id}`, `?invitation=${encodeURIComponent(token)}`); } catch (error) { fail(`/orders/rfqs/${id}`, error); }
}

export async function awardRfqLine(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("rfqId") ?? "");
  try { await awardRfq(ctx, String(form.get("rfqLineId") ?? ""), String(form.get("supplierId") ?? "")); back(`/orders/rfqs/${id}`, "?saved=1"); } catch (error) { fail(`/orders/rfqs/${id}`, error); }
}

/** short:<γραμμή> = wait | close, expectedAt = κοινή ημερομηνία για όσα αναμένονται. */
function shortfallDecisions(form: FormData): ShortfallDecision[] {
  const date = String(form.get("expectedAt") ?? "");
  const expectedAt = date ? new Date(`${date}T00:00:00Z`) : null;
  return [...form.keys()].filter((key) => key.startsWith("short:")).flatMap((key) => {
    const action = String(form.get(key));
    return action === "wait" || action === "close" ? [{ orderLineId: key.slice(6), action, expectedAt }] : [];
  });
}

export async function shortfallOrder(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("orderId") ?? "");
  try {
    await resolveShortfall(ctx, id, shortfallDecisions(form));
    back(`/orders/${id}`, "?saved=Ενημερώθηκε τι γίνεται με όσα λείπουν");
  } catch (error) { fail(`/orders/${id}`, error); }
}

export async function orderInvoice(form: FormData) {
  const ctx = await requireStockContext("orders.edit");
  const id = String(form.get("orderId") ?? "");
  try {
    const date = String(form.get("issuedAt") ?? "");
    const invoice = await createOrderInvoice(ctx, { orderId: id, number: String(form.get("number") ?? ""), issuedAt: new Date(`${date}T00:00:00Z`), mark: String(form.get("mark") ?? "") });
    revalidatePath("/purchases");
    back(`/orders/${id}`, `?saved=${encodeURIComponent(`Το τιμολόγιο ${invoice.number} συνδέθηκε με την παραγγελία`)}`);
  } catch (error) { fail(`/orders/${id}`, error); }
}
