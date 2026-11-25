// Καρτέλα 360: πραγματικές εμπορικές κινήσεις με το ίδιο tenant/store/warehouse scope των αρχικών οθονών.
// Το module είναι μόνο read model· δεν αλλάζει παραγγελίες, παραστατικά ή οικονομικά.
import type { TimelineItem } from "./crm.ts";
import { db } from "./db.ts";
import { euro } from "./money.ts";
import type { Permission } from "./permissions.ts";
import { calculatePurchaseDocument, type PurchaseLineAmounts } from "./purchase-document.ts";
import type { StockContext } from "./stock-scope.ts";

export type Party360Context = Pick<StockContext, "orgId" | "storeIds" | "warehouseIds" | "permissions">;
export type Party360Access = Record<"purchaseOrders" | "purchaseDocs" | "wholesaleOrders" | "salesDocs" | "payments", boolean>;

export function party360Access(permissions: readonly Permission[]): Party360Access {
  const can = (permission: Permission) => permissions.includes(permission);
  return {
    purchaseOrders: can("orders.read"),
    purchaseDocs: can("purchases.read"),
    wholesaleOrders: can("wholesale.read"),
    salesDocs: can("invoices.read"),
    payments: can("finance.read"),
  };
}

/** Store-scoped δεδομένα κρύβονται από warehouse-only χρήστη· δεν συμπεραίνουμε κατάστημα από ξένο ID. */
export function party360StoreWhere(ctx: Pick<StockContext, "storeIds" | "warehouseIds">) {
  if (ctx.storeIds.length) return { storeId: { in: [...ctx.storeIds] } };
  if (ctx.warehouseIds.length) return { storeId: { in: [] as string[] } };
  return {};
}

/** Κοινό ερώτημα αγορών: tenant, συναλλασσόμενος και ρητά επιτρεπόμενες αποθήκες. */
export function party360PurchaseWhere(ctx: Pick<StockContext, "orgId">, supplierId: string, warehouseIds: readonly string[]) {
  return { orgId: ctx.orgId, supplierId, warehouseId: { in: [...warehouseIds] } };
}

type PurchaseOrderRow = { id: string; number: string; status: string; totalCents: number; createdAt: Date };
type WholesaleOrderRow = { id: string; number: string; status: string; totalCents: number; createdAt: Date };
type PurchaseDocRow = {
  id: string; number: string | null; status: string; issuedAt: Date | null; createdAt: Date;
  source: string; note: string | null; mydataMark: string | null;
  shippingCostCents: number; otherExpensesCents: number; expensesVatRate: number; lines: PurchaseLineAmounts[];
  warehouse: { name: string };
};
type SalesDocumentRow = { id: string; docType: string; series: string; aa: number; status: string; totalCents: number; issuedAt: Date };
export type Party360Payment = { id: string; paidAt: Date; reference: string | null; amountCents: number; visibleAmountCents: number };

export type Party360Data = {
  access: Party360Access;
  purchaseOrders: PurchaseOrderRow[];
  purchaseDocs: PurchaseDocRow[];
  purchaseReceipts: PurchaseDocRow[];
  wholesaleOrders: WholesaleOrderRow[];
  salesDocs: SalesDocumentRow[];
  supplierPayments: Party360Payment[];
  customerPayments: Party360Payment[];
};

export const emptyParty360 = (): Party360Data => ({
  access: { purchaseOrders: false, purchaseDocs: false, wholesaleOrders: false, salesDocs: false, payments: false },
  purchaseOrders: [], purchaseDocs: [], purchaseReceipts: [], wholesaleOrders: [], salesDocs: [], supplierPayments: [], customerPayments: [],
});

/** Το ποσό πληρωμής σε μερικό scope είναι μόνο το ορατό allocation, όχι το ξένο υπόλοιπο της πληρωμής. */
export function visiblePaymentAmount(payment: { amountCents: number; allocations: { amountCents: number }[] }, restricted: boolean) {
  return restricted ? payment.allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0) : payment.amountCents;
}

export async function loadParty360(ctx: Party360Context, partyId: string): Promise<Party360Data> {
  const access = party360Access(ctx.permissions);
  if (!Object.values(access).some(Boolean)) return { ...emptyParty360(), access };

  const warehouses = await db.warehouse.findMany({
    where: {
      orgId: ctx.orgId,
      ...(ctx.warehouseIds.length ? { id: { in: [...ctx.warehouseIds] } } : ctx.storeIds.length ? { stores: { some: { storeId: { in: [...ctx.storeIds] } } } } : {}),
    },
    select: { id: true },
  });
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const purchaseWhere = party360PurchaseWhere(ctx, partyId, warehouseIds);
  const storeWhere = party360StoreWhere(ctx);
  const docLines = { select: { quantity: true, unitPriceCents: true, discountBps: true, vatRate: true } } as const;
  const docInclude = { warehouse: { select: { name: true } }, lines: docLines } as const;

  const [purchaseOrders, purchaseDocs, purchaseReceipts, wholesaleOrders, salesDocs] = await Promise.all([
    access.purchaseOrders ? db.purchaseOrder.findMany({ where: purchaseWhere, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    access.purchaseDocs ? db.purchaseDoc.findMany({ where: { ...purchaseWhere, kind: "INVOICE" }, orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }], include: docInclude }) : Promise.resolve([]),
    access.purchaseDocs ? db.purchaseDoc.findMany({ where: { ...purchaseWhere, kind: "RECEIPT", status: "POSTED" }, orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }], include: docInclude }) : Promise.resolve([]),
    access.wholesaleOrders ? db.wholesaleOrder.findMany({ where: { orgId: ctx.orgId, customerId: partyId, warehouseId: { in: warehouseIds }, ...storeWhere }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    access.salesDocs ? db.salesDocument.findMany({ where: { orgId: ctx.orgId, customerId: partyId, warehouseId: { in: warehouseIds }, ...storeWhere }, orderBy: { issuedAt: "desc" } }) : Promise.resolve([]),
  ]);

  const restricted = Boolean(ctx.storeIds.length || ctx.warehouseIds.length);
  const postedPurchaseIds = purchaseDocs.filter((doc) => doc.status === "POSTED").map((doc) => doc.id);
  const customerAllocationWhere = { document: { warehouseId: { in: warehouseIds }, ...storeWhere } };
  const [supplierPaymentRows, customerPaymentRows] = await Promise.all([
    access.payments ? db.supplierPayment.findMany({
      where: { orgId: ctx.orgId, supplierId: partyId, ...(restricted ? { allocations: { some: { purchaseDocId: { in: postedPurchaseIds } } } } : {}) },
      orderBy: { paidAt: "desc" },
      include: { allocations: { ...(restricted ? { where: { purchaseDocId: { in: postedPurchaseIds } } } : {}), select: { amountCents: true } } },
    }) : Promise.resolve([]),
    access.payments ? db.customerPayment.findMany({
      where: { orgId: ctx.orgId, customerId: partyId, ...(restricted ? { allocations: { some: customerAllocationWhere } } : {}) },
      orderBy: { paidAt: "desc" },
      include: { allocations: { ...(restricted ? { where: customerAllocationWhere } : {}), select: { amountCents: true } } },
    }) : Promise.resolve([]),
  ]);
  const payment = (row: { id: string; paidAt: Date; reference: string | null; amountCents: number; allocations: { amountCents: number }[] }): Party360Payment => ({
    id: row.id, paidAt: row.paidAt, reference: row.reference, amountCents: row.amountCents, visibleAmountCents: visiblePaymentAmount(row, restricted),
  });

  return {
    access, purchaseOrders, purchaseDocs, purchaseReceipts, wholesaleOrders, salesDocs,
    supplierPayments: supplierPaymentRows.map(payment), customerPayments: customerPaymentRows.map(payment),
  };
}

export type Party360Metric = { id: string; label: string; count: number; totalCents: number; href: string };
export function party360Metrics(data: Party360Data, roles: readonly string[]): Party360Metric[] {
  const metrics: Party360Metric[] = [];
  const supplier = roles.includes("supplier"), customer = roles.includes("customer");
  if (supplier && data.access.purchaseOrders) {
    const rows = data.purchaseOrders.filter((row) => row.status !== "CANCELLED");
    metrics.push({ id: "purchase-orders", label: "Παραγγελίες προμηθευτή", count: rows.length, totalCents: rows.reduce((sum, row) => sum + row.totalCents, 0), href: "/orders" });
  }
  if (supplier && data.access.purchaseDocs) {
    const rows = data.purchaseDocs.filter((row) => row.status === "POSTED");
    metrics.push({ id: "purchase-docs", label: "POSTED τιμολόγια αγοράς", count: rows.length, totalCents: rows.reduce((sum, row) => sum + calculatePurchaseDocument(row.lines, row).totalCents, 0), href: "/purchases" });
  }
  if (customer && data.access.wholesaleOrders) {
    const rows = data.wholesaleOrders.filter((row) => row.status !== "CANCELLED");
    metrics.push({ id: "wholesale-orders", label: "Παραγγελίες πελάτη", count: rows.length, totalCents: rows.reduce((sum, row) => sum + row.totalCents, 0), href: "/wholesale-orders" });
  }
  if (customer && data.access.salesDocs) {
    const rows = data.salesDocs.filter((row) => row.status === "ISSUED");
    metrics.push({ id: "sales-docs", label: "Εκδοθέντα παραστατικά πελάτη", count: rows.length, totalCents: rows.reduce((sum, row) => sum + (row.docType === "5.1" ? -1 : 1) * row.totalCents, 0), href: "/invoices" });
  }
  if (supplier && data.access.payments) metrics.push({ id: "supplier-payments", label: "Πληρωμές προμηθευτή", count: data.supplierPayments.length, totalCents: data.supplierPayments.reduce((sum, row) => sum + row.visibleAmountCents, 0), href: "/finance" });
  if (customer && data.access.payments) metrics.push({ id: "customer-payments", label: "Εισπράξεις πελάτη", count: data.customerPayments.length, totalCents: data.customerPayments.reduce((sum, row) => sum + row.visibleAmountCents, 0), href: "/finance" });
  return metrics;
}

const PURCHASE_STATUS = { DRAFT: "Πρόχειρο", POSTED: "Καταχωρημένο", CANCELLED: "Ακυρωμένο" } as const;
const ORDER_STATUS = { DRAFT: "Πρόχειρη", SENT: "Στάλθηκε", PARTIAL: "Μερική παραλαβή", RECEIVED: "Παραλήφθηκε", CANCELLED: "Ακυρώθηκε" } as const;
const WHOLESALE_STATUS = { DRAFT: "Πρόχειρη", CONFIRMED: "Επιβεβαιωμένη", DELIVERED: "Παραδόθηκε", INVOICED: "Τιμολογήθηκε", CANCELLED: "Ακυρώθηκε" } as const;
const status = (value: string, labels: Record<string, string>) => labels[value] ?? value;

/** Εμπορικά γεγονότα για το υπάρχοντα CRM χρονολόγιο, με σεβασμό στα αντίστοιχα read permissions. */
export function party360Events(data: Party360Data): TimelineItem[] {
  const purchaseOrders = data.purchaseOrders.map((row): TimelineItem => ({
    id: `purchase-order-${row.id}`, at: row.createdAt, kind: "purchase_order", auto: true,
    title: `Παραγγελία προμηθευτή ${row.number}`, text: `${status(row.status, ORDER_STATUS)} · ${euro(row.totalCents)}`, href: `/orders/${row.id}`,
  }));
  const purchaseDocs = data.purchaseDocs.map((row): TimelineItem => ({
    id: `purchase-doc-${row.id}`, at: row.issuedAt ?? row.createdAt, kind: "document", auto: true,
    title: `Τιμολόγιο αγοράς ${row.number ?? "χωρίς αριθμό"}`,
    text: `${status(row.status, PURCHASE_STATUS)} · ${row.warehouse.name} · ${euro(calculatePurchaseDocument(row.lines, row).totalCents)}`, href: `/purchases/${row.id}`,
    tone: row.status === "POSTED" ? "success" : row.status === "CANCELLED" ? "danger" : "warning",
  }));
  const purchaseReceipts = data.purchaseReceipts.map((row): TimelineItem => ({
    id: `purchase-receipt-${row.id}`, at: row.issuedAt ?? row.createdAt, kind: "purchase_receipt", auto: true,
    title: `Παραλαβή ${row.number ?? "χωρίς αριθμό"}`, text: `${row.warehouse.name} · POSTED`, href: `/purchases/${row.id}`, tone: "success",
  }));
  const wholesaleOrders = data.wholesaleOrders.map((row): TimelineItem => ({
    id: `wholesale-order-${row.id}`, at: row.createdAt, kind: "wholesale_order", auto: true,
    title: `Παραγγελία πελάτη ${row.number}`, text: `${status(row.status, WHOLESALE_STATUS)} · ${euro(row.totalCents)}`, href: `/wholesale-orders/${row.id}`,
  }));
  const salesDocs = data.salesDocs.map((row): TimelineItem => ({
    id: `sales-doc-${row.id}`, at: row.issuedAt, kind: "document", auto: true,
    title: `${row.docType === "5.1" ? "Πιστωτικό" : "Παραστατικό"} πελάτη ${row.series}-${row.aa}`,
    text: `${row.status === "ISSUED" ? "Εκδοθέν" : "Ακυρωμένο"} · ${euro((row.docType === "5.1" ? -1 : 1) * row.totalCents)}`,
    href: `/invoices/${row.id}`, tone: row.status === "ISSUED" ? "success" : "danger",
  }));
  const paymentEvents = (rows: Party360Payment[], supplier: boolean) => rows.map((row): TimelineItem => ({
    id: `${supplier ? "supplier" : "customer"}-payment-${row.id}`, at: row.paidAt, kind: "payment", auto: true,
    title: supplier ? "Πληρωμή προμηθευτή" : "Είσπραξη πελάτη",
    text: `${euro(row.visibleAmountCents)}${row.reference ? ` · ${row.reference}` : ""}`, tone: "success",
  }));
  return [...purchaseOrders, ...purchaseDocs, ...purchaseReceipts, ...wholesaleOrders, ...salesDocs, ...paymentEvents(data.supplierPayments, true), ...paymentEvents(data.customerPayments, false)];
}
