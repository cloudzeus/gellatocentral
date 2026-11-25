import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mergeTimeline, type TimelineItem } from "./crm.ts";
import { db } from "./db.ts";
import {
  emptyParty360,
  loadParty360,
  party360Access,
  party360Events,
  party360Metrics,
  party360PurchaseWhere,
  party360StoreWhere,
  visiblePaymentAmount,
  type Party360Context,
  type Party360Data,
} from "./party-360.ts";
import type { Permission } from "./permissions.ts";

// Τα Prisma delegates είναι proxies· το stub ορίζει ρητά τη μέθοδο και την επαναφέρει χωρίς καμία DB κλήση.
function stubFindMany(t: TestContext, delegate: object, implementation: (query?: unknown) => Promise<unknown>) {
  const stub = t.mock.fn(implementation);
  const descriptor = Object.getOwnPropertyDescriptor(delegate, "findMany");
  Object.defineProperty(delegate, "findMany", { configurable: true, writable: true, value: stub });
  t.after(() => {
    if (descriptor) Object.defineProperty(delegate, "findMany", descriptor);
    else Reflect.deleteProperty(delegate, "findMany");
  });
  return stub;
}

const at = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T12:00:00.000Z`);
const allRead: Permission[] = ["orders.read", "purchases.read", "wholesale.read", "invoices.read", "finance.read"];
const expenses = { shippingCostCents: 0, otherExpensesCents: 0, expensesVatRate: 24 };
const purchaseDoc = (id: string, status = "POSTED") => ({
  id, number: `Α-${id}`, status, issuedAt: at(10), createdAt: at(9), source: "manual", note: null, mydataMark: null, ...expenses,
  lines: [{ quantity: 2, unitPriceCents: 1_000, discountBps: 0, vatRate: 24 }], warehouse: { name: "Κεντρική" },
});

function data(patch: Partial<Party360Data> = {}): Party360Data {
  return {
    ...emptyParty360(),
    access: { purchaseOrders: true, purchaseDocs: true, wholesaleOrders: true, salesDocs: true, payments: true },
    ...patch,
  };
}

test("360 RBAC: κάθε ενότητα απαιτεί το δικό της read permission", () => {
  const cases = [
    ["orders.read", "purchaseOrders"],
    ["purchases.read", "purchaseDocs"],
    ["wholesale.read", "wholesaleOrders"],
    ["invoices.read", "salesDocs"],
    ["finance.read", "payments"],
  ] as const;
  assert.deepEqual(party360Access([]), { purchaseOrders: false, purchaseDocs: false, wholesaleOrders: false, salesDocs: false, payments: false });
  for (const [permission, key] of cases) {
    const access = party360Access([permission]);
    assert.equal(access[key], true, permission);
    for (const [, other] of cases) if (other !== key) assert.equal(access[other], false, `${permission} δεν ανοίγει ${other}`);
  }
});

test("360 scope: tenant, πάρτι, αποθήκες και αποκλεισμός store δεδομένων σε warehouse-only χρήστη", () => {
  assert.deepEqual(party360StoreWhere({ storeIds: ["s1", "s2"], warehouseIds: [] }), { storeId: { in: ["s1", "s2"] } });
  assert.deepEqual(party360StoreWhere({ storeIds: [], warehouseIds: ["w1"] }), { storeId: { in: [] } });
  assert.deepEqual(party360StoreWhere({ storeIds: [], warehouseIds: [] }), {});
  assert.deepEqual(party360PurchaseWhere({ orgId: "org-1" }, "party-1", ["w1"]), {
    orgId: "org-1", supplierId: "party-1", warehouseId: { in: ["w1"] },
  });
});

test("360 πληρωμές: μερικό scope μετρά μόνο ορατά allocations, καθολικό scope το πλήρες ποσό", () => {
  const payment = { amountCents: 1_000, allocations: [{ amountCents: 250 }, { amountCents: 150 }] };
  assert.equal(visiblePaymentAmount(payment, true), 400);
  assert.equal(visiblePaymentAmount(payment, false), 1_000);
  assert.equal(visiblePaymentAmount({ amountCents: 900, allocations: [] }, true), 0);
});

test("360 σύνοψη: μόνο ενεργά/POSTED/ISSUED ποσά και αρνητικό πρόσημο πιστωτικού", () => {
  const result = party360Metrics(data({
    purchaseOrders: [
      { id: "po1", number: "Π1", status: "SENT", totalCents: 1_000, createdAt: at(8) },
      { id: "po2", number: "Π2", status: "CANCELLED", totalCents: 9_000, createdAt: at(7) },
    ],
    purchaseDocs: [purchaseDoc("i1"), { ...purchaseDoc("i2", "DRAFT"), lines: [{ quantity: 1, unitPriceCents: 9_999, discountBps: 0, vatRate: 24 }] }],
    wholesaleOrders: [
      { id: "wo1", number: "Χ1", status: "CONFIRMED", totalCents: 500, createdAt: at(8) },
      { id: "wo2", number: "Χ2", status: "CANCELLED", totalCents: 700, createdAt: at(7) },
    ],
    salesDocs: [
      { id: "sd1", docType: "1.1", series: "Α", aa: 1, status: "ISSUED", totalCents: 1_000, issuedAt: at(10) },
      { id: "sd2", docType: "5.1", series: "Α", aa: 2, status: "ISSUED", totalCents: 200, issuedAt: at(11) },
      { id: "sd3", docType: "1.1", series: "Α", aa: 3, status: "CANCELLED", totalCents: 5_000, issuedAt: at(12) },
    ],
    supplierPayments: [{ id: "sp1", paidAt: at(12), reference: null, amountCents: 900, visibleAmountCents: 400 }],
    customerPayments: [{ id: "cp1", paidAt: at(12), reference: null, amountCents: 800, visibleAmountCents: 300 }],
  }), ["supplier", "customer"]);
  assert.deepEqual(result.map(({ id, count, totalCents }) => ({ id, count, totalCents })), [
    { id: "purchase-orders", count: 1, totalCents: 1_000 },
    { id: "purchase-docs", count: 1, totalCents: 2_480 },
    { id: "wholesale-orders", count: 1, totalCents: 500 },
    { id: "sales-docs", count: 2, totalCents: 800 },
    { id: "supplier-payments", count: 1, totalCents: 400 },
    { id: "customer-payments", count: 1, totalCents: 300 },
  ]);
  assert.deepEqual(party360Metrics(data(), ["partner"]), []);
});

test("360 timeline: πραγματικά IDs/hrefs, πληρωμές και συνένωση με χειροκίνητο CRM", () => {
  const events = party360Events(data({
    purchaseOrders: [{ id: "po1", number: "Π1", status: "SENT", totalCents: 1_000, createdAt: at(8) }],
    purchaseDocs: [purchaseDoc("i1")],
    purchaseReceipts: [{ ...purchaseDoc("r1"), number: null }],
    wholesaleOrders: [{ id: "wo1", number: "Χ1", status: "CONFIRMED", totalCents: 500, createdAt: at(9) }],
    salesDocs: [{ id: "sd1", docType: "5.1", series: "Α", aa: 2, status: "ISSUED", totalCents: 200, issuedAt: at(11) }],
    supplierPayments: [{ id: "sp1", paidAt: at(12), reference: "ΤΡΑΠ-1", amountCents: 900, visibleAmountCents: 400 }],
    customerPayments: [{ id: "cp1", paidAt: at(13), reference: null, amountCents: 800, visibleAmountCents: 300 }],
  }));
  assert.deepEqual(events.map((event) => [event.id, event.kind, event.href]), [
    ["purchase-order-po1", "purchase_order", "/orders/po1"],
    ["purchase-doc-i1", "document", "/purchases/i1"],
    ["purchase-receipt-r1", "purchase_receipt", "/purchases/r1"],
    ["wholesale-order-wo1", "wholesale_order", "/wholesale-orders/wo1"],
    ["sales-doc-sd1", "document", "/invoices/sd1"],
    ["supplier-payment-sp1", "payment", undefined],
    ["customer-payment-cp1", "payment", undefined],
  ]);
  assert.ok(events.every((event) => event.auto));
  assert.match(events[4].text ?? "", /-/);
  const manual: TimelineItem = { id: "manual", at: at(20), kind: "note", title: "Σημείωση" };
  assert.deepEqual(mergeTimeline([events, [manual]]).map((event) => event.id).slice(0, 3), ["manual", "customer-payment-cp1", "supplier-payment-sp1"]);
  assert.deepEqual(mergeTimeline([events, [manual]], "auto").map((event) => event.id).slice(0, 2), ["customer-payment-cp1", "supplier-payment-sp1"]);
});

test("360 load: store scope περνά σε όλα τα queries και περιορίζει τα payment allocations", async (t) => {
  const queries: Record<string, unknown> = {};
  stubFindMany(t, db.warehouse, async (query: unknown) => {
    queries.warehouses = query;
    return [{ id: "w1" }] as never;
  });
  stubFindMany(t, db.purchaseOrder, async (query: unknown) => {
    queries.purchaseOrders = query;
    return [] as never;
  });
  stubFindMany(t, db.purchaseDoc, async (query: unknown) => {
    const kind = (query as { where: { kind: string } }).where.kind;
    queries[kind === "INVOICE" ? "invoices" : "receipts"] = query;
    return (kind === "INVOICE" ? [purchaseDoc("visible-invoice")] : []) as never;
  });
  stubFindMany(t, db.wholesaleOrder, async (query: unknown) => {
    queries.wholesale = query;
    return [] as never;
  });
  stubFindMany(t, db.salesDocument, async (query: unknown) => {
    queries.sales = query;
    return [] as never;
  });
  stubFindMany(t, db.supplierPayment, async (query: unknown) => {
    queries.supplierPayments = query;
    return [{ id: "sp1", paidAt: at(12), reference: null, amountCents: 1_000, allocations: [{ amountCents: 400 }] }] as never;
  });
  stubFindMany(t, db.customerPayment, async (query: unknown) => {
    queries.customerPayments = query;
    return [{ id: "cp1", paidAt: at(12), reference: null, amountCents: 800, allocations: [{ amountCents: 300 }] }] as never;
  });
  const ctx: Party360Context = { orgId: "org-1", storeIds: ["s1"], warehouseIds: [], permissions: allRead };
  const result = await loadParty360(ctx, "party-1");
  assert.deepEqual(queries.warehouses, { where: { orgId: "org-1", stores: { some: { storeId: { in: ["s1"] } } } }, select: { id: true } });
  assert.deepEqual((queries.purchaseOrders as { where: unknown }).where, { orgId: "org-1", supplierId: "party-1", warehouseId: { in: ["w1"] } });
  assert.deepEqual((queries.wholesale as { where: unknown }).where, { orgId: "org-1", customerId: "party-1", warehouseId: { in: ["w1"] }, storeId: { in: ["s1"] } });
  assert.deepEqual((queries.sales as { where: unknown }).where, { orgId: "org-1", customerId: "party-1", warehouseId: { in: ["w1"] }, storeId: { in: ["s1"] } });
  assert.deepEqual((queries.supplierPayments as { where: unknown }).where, {
    orgId: "org-1", supplierId: "party-1", allocations: { some: { purchaseDocId: { in: ["visible-invoice"] } } },
  });
  assert.deepEqual((queries.supplierPayments as { include: unknown }).include, {
    allocations: { where: { purchaseDocId: { in: ["visible-invoice"] } }, select: { amountCents: true } },
  });
  const customerAllocation = { document: { warehouseId: { in: ["w1"] }, storeId: { in: ["s1"] } } };
  assert.deepEqual((queries.customerPayments as { where: unknown }).where, {
    orgId: "org-1", customerId: "party-1", allocations: { some: customerAllocation },
  });
  assert.equal(result.supplierPayments[0].visibleAmountCents, 400);
  assert.equal(result.customerPayments[0].visibleAmountCents, 300);
});

test("360 load: καθολικό scope κρατά και μη allocated πληρωμές με πλήρες ποσό", async (t) => {
  const paymentQueries: Record<string, { where: Record<string, unknown>; include: { allocations: Record<string, unknown> } }> = {};
  stubFindMany(t, db.warehouse, async () => [{ id: "w1" }] as never);
  stubFindMany(t, db.purchaseOrder, async () => [] as never);
  stubFindMany(t, db.purchaseDoc, async () => [] as never);
  stubFindMany(t, db.wholesaleOrder, async () => [] as never);
  stubFindMany(t, db.salesDocument, async () => [] as never);
  stubFindMany(t, db.supplierPayment, async (query: unknown) => {
    paymentQueries.supplier = query as typeof paymentQueries.supplier;
    return [{ id: "sp1", paidAt: at(12), reference: null, amountCents: 1_000, allocations: [] }] as never;
  });
  stubFindMany(t, db.customerPayment, async (query: unknown) => {
    paymentQueries.customer = query as typeof paymentQueries.customer;
    return [{ id: "cp1", paidAt: at(12), reference: null, amountCents: 800, allocations: [] }] as never;
  });
  const result = await loadParty360({ orgId: "org-1", storeIds: [], warehouseIds: [], permissions: allRead }, "party-1");
  for (const query of Object.values(paymentQueries)) {
    assert.equal("allocations" in query.where, false);
    assert.equal("where" in query.include.allocations, false);
  }
  assert.equal(result.supplierPayments[0].visibleAmountCents, 1_000);
  assert.equal(result.customerPayments[0].visibleAmountCents, 800);
});

test("360 load: χωρίς εμπορικό permission δεν γίνεται query", async (t) => {
  const warehouses = stubFindMany(t, db.warehouse, async () => [] as never);
  const result = await loadParty360({ orgId: "org-1", storeIds: [], warehouseIds: [], permissions: [] }, "party-1");
  assert.equal(warehouses.mock.callCount(), 0);
  assert.deepEqual(result, emptyParty360());
});
