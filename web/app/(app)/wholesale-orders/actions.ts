"use server";

import { flashOk } from "@/lib/flash-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { transmitSalesDocument } from "@/lib/mydata-outgoing";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { workflowMessage } from "@/lib/workflow-db";
import { runTask } from "@/lib/tasks";
import { redirectUrl } from "@/lib/flash";
import {
  cancelDeliveryDocument, cancelWholesaleOrder, confirmWholesaleOrder, createB2bAccess,
  createDeliveryRoute, createWholesaleOrder, creditSalesDocument, deliverWholesaleOrder,
  invoiceWholesaleOrder, recordCustomerPayment, savePriceList,
} from "@/lib/wholesale-db";

const decimal = (value: FormDataEntryValue | null) => Number(String(value ?? "").trim().replace(",", "."));
const cents = (value: FormDataEntryValue | null) => Math.round(decimal(value) * 100);
const date = (value: FormDataEntryValue | null) => { const text = String(value ?? ""); return text ? new Date(text) : null; };
function refresh() {
  for (const path of ["/wholesale-orders", "/wholesale-orders/pricelists", "/wholesale-orders/routes", "/invoices"]) revalidatePath(path);
}
const back = (path: string, query = ""): never => { refresh(); revalidatePath(path); redirect(redirectUrl(`${path}${query}`)); };
const fail = (path: string, error: unknown): never => back(path, `?error=${encodeURIComponent(workflowMessage(error))}`);

export async function createWholesale(form: FormData) {
  const ctx = await requireStockContext("wholesale.add");
  try {
    const ids = form.getAll("genericItemId").map(String);
    const quantities = form.getAll("quantity").map(decimal);
    const prices = form.getAll("unitPrice").map(cents);
    const vats = form.getAll("vatRate").map(Number);
    const generics = await db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: ids } }, include: { baseUnit: true } });
    const scales = new Map(generics.map((generic) => [generic.id, stockCostScale(generic.baseUnit.dimension)]));
    const lines = ids.map((genericItemId, index) => {
      const scale = scales.get(genericItemId);
      if (!scale || !Number.isFinite(quantities[index]) || quantities[index] <= 0) throw new Error("Έλεγξε είδη και ποσότητες");
      return { genericItemId, quantityBase: Math.round(quantities[index] * scale), unitPriceCents: prices[index], vatRate: vats[index] };
    });
    const order = await createWholesaleOrder(ctx, {
      customerId: String(form.get("customerId") ?? ""), storeId: String(form.get("storeId") ?? ""),
      warehouseId: String(form.get("warehouseId") ?? ""), neededAt: date(form.get("neededAt")),
      note: String(form.get("note") ?? ""), lines,
    });
    await flashOk("Η παραγγελία χονδρικής δημιουργήθηκε");
    back(`/wholesale-orders/${order.id}`);
  } catch (error) { fail("/wholesale-orders", error); }
}

export async function confirmWholesale(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("orderId") ?? "");
  try { await confirmWholesaleOrder(ctx, id); back(`/wholesale-orders/${id}`, "?saved=Η παραγγελία επιβεβαιώθηκε"); } catch (error) { fail(`/wholesale-orders/${id}`, error); }
}

export async function cancelWholesale(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("orderId") ?? "");
  try { await cancelWholesaleOrder(ctx, id, String(form.get("reason") ?? "")); back(`/wholesale-orders/${id}`, "?saved=Η παραγγελία ακυρώθηκε"); } catch (error) { fail(`/wholesale-orders/${id}`, error); }
}

export async function deliverWholesale(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("orderId") ?? "");
  try {
    const document = await deliverWholesaleOrder(ctx, {
      orderId: id, series: String(form.get("series") ?? ""), deliveredAt: date(form.get("deliveredAt")) ?? undefined,
      stopId: String(form.get("stopId") ?? "") || null, recipientName: String(form.get("recipientName") ?? ""),
      proofNote: String(form.get("proofNote") ?? ""),
    });
    back(`/invoices/${document.id}`, "?saved=Η παράδοση ολοκληρώθηκε και καταχωρήθηκε FEFO έξοδος");
  } catch (error) { fail(`/wholesale-orders/${id}`, error); }
}

export async function reverseDelivery(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  const id = String(form.get("documentId") ?? "");
  try { await cancelDeliveryDocument(ctx, id, String(form.get("reason") ?? "")); back(`/invoices/${id}`, "?saved=Η παράδοση αναιρέθηκε με αντίθετες κινήσεις"); } catch (error) { fail(`/invoices/${id}`, error); }
}

export async function invoiceWholesale(form: FormData) {
  const ctx = await requireStockContext("invoices.add");
  const id = String(form.get("orderId") ?? "");
  try {
    const document = await invoiceWholesaleOrder(ctx, { orderId: id, series: String(form.get("series") ?? ""), issuedAt: date(form.get("issuedAt")) ?? undefined, dueAt: date(form.get("dueAt")) });
    back(`/invoices/${document.id}`, "?saved=Το τιμολόγιο εκδόθηκε χωρίς δεύτερη κίνηση αποθέματος");
  } catch (error) { fail(`/wholesale-orders/${id}`, error); }
}

export async function creditInvoice(form: FormData) {
  const ctx = await requireStockContext("invoices.cancel");
  const id = String(form.get("documentId") ?? "");
  try {
    const credit = await creditSalesDocument(ctx, { documentId: id, series: String(form.get("series") ?? ""), reason: String(form.get("reason") ?? "") });
    back(`/invoices/${credit.id}`, "?saved=Το πιστωτικό εκδόθηκε με επιστροφή στις αρχικές παρτίδες");
  } catch (error) { fail(`/invoices/${id}`, error); }
}

export async function transmitInvoice(form: FormData) {
  const ctx = await requireStockContext("invoices.edit");
  const id = String(form.get("documentId") ?? "");
  try {
    const document = await db.salesDocument.findFirst({ where: { id, orgId: ctx.orgId }, select: { series: true, aa: true } });
    const label = document ? `${document.series}-${document.aa}` : "Τιμολόγιο";
    // «Ξανά» επιτρέπεται (lib/task-kinds.ts): η transmitSalesDocument αποκλείει ήδη τη διπλή αποστολή
    // (SIGNED → επιστρέφει, conditional claim για ταυτόχρονες κλήσεις, idempotencyKey προς τον πάροχο).
    await runTask({ orgId: ctx.orgId, userId: ctx.userId, userName: ctx.userName }, { kind: "aade.invoice", title: `Αποστολή τιμολογίου ${label} στην ΑΑΔΕ`, permission: "invoices.read", total: 1 }, async (task) => {
      await task.step(label);
      try { await transmitSalesDocument(ctx, id); await task.ok(); task.result(`/invoices/${id}`); }
      catch (error) { await task.fail({ id, label, reason: workflowMessage(error) }); throw error; }
    });
    back(`/invoices/${id}`, "?saved=Η διαβίβαση ολοκληρώθηκε");
  } catch (error) { fail(`/invoices/${id}`, error); }
}

export async function customerPayment(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  const documentId = String(form.get("documentId") ?? "");
  try {
    await recordCustomerPayment(ctx, {
      clientKey: String(form.get("clientKey") ?? ""),
      customerId: String(form.get("customerId") ?? ""), accountId: String(form.get("accountId") ?? "") || null,
      amountCents: cents(form.get("amount")), paidAt: date(form.get("paidAt")) ?? new Date(),
      reference: String(form.get("reference") ?? ""), note: String(form.get("note") ?? ""),
      allocations: [{ documentId, amountCents: cents(form.get("allocatedAmount")) }],
    });
    back(`/invoices/${documentId}`, "?saved=Η είσπραξη και η αντιστοίχισή της καταχωρήθηκαν");
  } catch (error) { fail(`/invoices/${documentId}`, error); }
}

export async function newPriceList(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  try {
    await savePriceList(ctx, {
      name: String(form.get("name") ?? ""), validFrom: date(form.get("validFrom")) ?? new Date(NaN), validTo: date(form.get("validTo")),
      customerId: String(form.get("customerId") ?? "") || null,
      lines: form.getAll("genericItemId").map(String).map((genericItemId, index) => ({
        genericItemId, unitPriceCents: cents(form.getAll("unitPrice")[index] ?? null), vatRate: Number(form.getAll("vatRate")[index]),
      })),
    });
    back("/wholesale-orders/pricelists", "?saved=Ο τιμοκατάλογος αποθηκεύτηκε");
  } catch (error) { fail("/wholesale-orders/pricelists", error); }
}

export async function newDeliveryRoute(form: FormData) {
  const ctx = await requireStockContext("wholesale.edit");
  try {
    await createDeliveryRoute(ctx, {
      storeId: String(form.get("storeId") ?? "") || null, name: String(form.get("name") ?? ""),
      plannedFor: date(form.get("plannedFor")) ?? new Date(NaN), driverName: String(form.get("driverName") ?? ""),
      orderIds: form.getAll("orderIds").map(String),
    });
    back("/wholesale-orders/routes", "?saved=Το δρομολόγιο δημιουργήθηκε");
  } catch (error) { fail("/wholesale-orders/routes", error); }
}

export async function issueB2bAccess(customerId: string, expiresAt: string | null) {
  const ctx = await requireStockContext("wholesale.edit");
  try {
    const result = await createB2bAccess(ctx, customerId, expiresAt ? new Date(expiresAt) : null);
    refresh();
    return { token: result.token as string, error: null as string | null };
  } catch (error) { return { token: null as string | null, error: workflowMessage(error) }; }
}
