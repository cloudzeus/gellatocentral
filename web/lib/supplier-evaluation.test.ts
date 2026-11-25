import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { db } from "./db.ts";
import type { Permission } from "./permissions.ts";
import { calculateSupplierEvaluation, canEvaluateSupplier, loadSupplierEvaluation, supplierPostedWhere } from "./supplier-evaluation.ts";

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

const at = (value: string) => new Date(value);
const noExpenses = { shippingCostCents: 0, otherExpensesCents: 0, expensesVatRate: 24 };

function receipt(id: string, purchaseDocId: string, expectedAt: Date | null, patch: Record<string, unknown> = {}) {
  return {
    id, purchaseDocId, reversedAt: null, invoiceMatchStatus: "MATCHED",
    order: { id: `order-${id}`, number: `Π-${id}`, expectedAt },
    discrepancies: [], invoiceDiscrepancies: [], ...patch,
  };
}

test("αξιολόγηση RBAC: απαιτούνται ταυτόχρονα reports.read και purchases.read", () => {
  assert.equal(canEvaluateSupplier([]), false);
  assert.equal(canEvaluateSupplier(["reports.read"]), false);
  assert.equal(canEvaluateSupplier(["purchases.read"]), false);
  assert.equal(canEvaluateSupplier(["orders.read", "finance.read"]), false);
  assert.equal(canEvaluateSupplier(["reports.read", "purchases.read"]), true);
  const permissions: Permission[] = ["reports.read", "purchases.read"];
  assert.equal(canEvaluateSupplier(permissions), true);
});

test("αξιολόγηση query: υποχρεωτικά tenant, supplier, warehouse, kind και POSTED", () => {
  assert.deepEqual(supplierPostedWhere({ orgId: "org-1" }, "supplier-1", ["w1", "w2"], "RECEIPT"), {
    orgId: "org-1", supplierId: "supplier-1", warehouseId: { in: ["w1", "w2"] }, kind: "RECEIPT", status: "POSTED",
  });
});

test("αξιολόγηση KPI: ακριβή cents, ημερολογιακή Αθήνα, αποκλίσεις χωρίς διπλομέτρηση", () => {
  const result = calculateSupplierEvaluation({
    invoices: [
      {
        id: "invoice-1", status: "POSTED", shippingCostCents: 100, otherExpensesCents: 50, expensesVatRate: 24,
        lines: [{ quantity: 2, unitPriceCents: 1_000, discountBps: 1_000, vatRate: 24 }],
      },
      {
        id: "invoice-2", status: "POSTED", ...noExpenses,
        lines: [{ quantity: 1, unitPriceCents: 555, discountBps: 0, vatRate: 13 }],
      },
      {
        id: "draft", status: "DRAFT", ...noExpenses,
        lines: [{ quantity: 1, unitPriceCents: 99_999, discountBps: 0, vatRate: 24 }],
      },
    ],
    receiptDocs: [
      { id: "doc-1", issuedAt: at("2026-11-10T10:00:00.000Z"), createdAt: at("2026-11-09T10:00:00.000Z"), warehouse: { name: "Α" } },
      { id: "doc-2", issuedAt: at("2026-11-12T23:30:00.000Z"), createdAt: at("2026-11-12T20:00:00.000Z"), warehouse: { name: "Β" } },
      { id: "doc-3", issuedAt: null, createdAt: at("2026-11-11T10:00:00.000Z"), warehouse: { name: "Γ" } },
      { id: "doc-4", issuedAt: at("2026-11-14T10:00:00.000Z"), createdAt: at("2026-11-14T10:00:00.000Z"), warehouse: { name: "Δ" } },
    ],
    receipts: [
      receipt("r1", "doc-1", at("2026-11-10T08:00:00.000Z"), { discrepancies: [{ id: "d1" }] }),
      receipt("r2", "doc-2", at("2026-11-10T08:00:00.000Z"), { discrepancies: [{ id: "d2" }, { id: "d3" }], invoiceDiscrepancies: [{ id: "id1" }], invoiceMatchStatus: "MISMATCH" }),
      receipt("r3", "doc-3", null),
      receipt("reversed", "doc-4", null, { reversedAt: at("2026-11-15T10:00:00.000Z"), discrepancies: [{ id: "ignored" }] }),
      receipt("orphan", "other-org-doc", null, { discrepancies: [{ id: "ignored-too" }] }),
    ],
  });
  assert.equal(result.invoiceCount, 2);
  assert.equal(result.netCents, 2_505);
  assert.equal(result.vatCents, 540);
  assert.equal(result.totalCents, 3_045);
  assert.equal(result.receiptCount, 3);
  assert.equal(result.scheduledReceiptCount, 2);
  assert.equal(result.onTimeReceiptCount, 1);
  assert.equal(result.lateReceiptCount, 1);
  assert.equal(result.onTimeRateBps, 5_000);
  assert.equal(result.receiptsWithDiscrepancies, 2);
  assert.equal(result.discrepancyRateBps, 6_667);
  assert.equal(result.receiptDiscrepancyCount, 3);
  assert.equal(result.invoiceDiscrepancyCount, 1);
  assert.deepEqual(result.rows.map((row) => row.id), ["r2", "r3", "r1"]);
  assert.equal(result.rows.find((row) => row.id === "r1")?.delayDays, 0);
  assert.equal(result.rows.find((row) => row.id === "r2")?.delayDays, 3);
  assert.equal(result.rows.find((row) => row.id === "r2")?.discrepancyCount, 3);
  assert.equal(result.rows.find((row) => row.id === "r3")?.delayDays, null);
});

test("αξιολόγηση KPI: χωρίς προθεσμίες ή παραλαβές τα rates παραμένουν null", () => {
  const empty = calculateSupplierEvaluation({ invoices: [], receiptDocs: [], receipts: [] });
  assert.equal(empty.onTimeRateBps, null);
  assert.equal(empty.discrepancyRateBps, null);
  const unscheduled = calculateSupplierEvaluation({
    invoices: [],
    receiptDocs: [{ id: "doc", issuedAt: null, createdAt: at("2026-11-10T10:00:00.000Z"), warehouse: { name: "Α" } }],
    receipts: [receipt("r", "doc", null)],
  });
  assert.equal(unscheduled.receiptCount, 1);
  assert.equal(unscheduled.scheduledReceiptCount, 0);
  assert.equal(unscheduled.onTimeRateBps, null);
  assert.equal(unscheduled.discrepancyRateBps, 0);
});

test("αξιολόγηση load: τα scoped POSTED receipt docs περιορίζουν και τα receipt KPIs", async (t) => {
  const queries: Record<string, unknown> = {};
  stubFindMany(t, db.warehouse, async (query: unknown) => {
    queries.warehouses = query;
    return [{ id: "w1" }, { id: "w2" }] as never;
  });
  stubFindMany(t, db.purchaseDoc, async (query: unknown) => {
    const kind = (query as { where: { kind: string } }).where.kind;
    queries[kind] = query;
    if (kind === "INVOICE") return [{ id: "invoice", status: "POSTED", ...noExpenses, lines: [{ quantity: 1, unitPriceCents: 100, discountBps: 0, vatRate: 24 }] }] as never;
    return [{ id: "receipt-doc", issuedAt: at("2026-11-10T10:00:00.000Z"), createdAt: at("2026-11-10T09:00:00.000Z"), warehouse: { name: "Κεντρική" } }] as never;
  });
  stubFindMany(t, db.purchaseReceipt, async (query: unknown) => {
    queries.receipts = query;
    return [receipt("r1", "receipt-doc", at("2026-11-10T08:00:00.000Z"))] as never;
  });
  const result = await loadSupplierEvaluation({ orgId: "org-1", storeIds: ["s1"], warehouseIds: [] }, "supplier-1");
  assert.deepEqual(queries.warehouses, { where: { orgId: "org-1", stores: { some: { storeId: { in: ["s1"] } } } }, select: { id: true } });
  for (const kind of ["INVOICE", "RECEIPT"]) {
    assert.deepEqual((queries[kind] as { where: unknown }).where, {
      orgId: "org-1", supplierId: "supplier-1", warehouseId: { in: ["w1", "w2"] }, kind, status: "POSTED",
    });
  }
  assert.deepEqual((queries.receipts as { where: unknown }).where, {
    orgId: "org-1", purchaseDocId: { in: ["receipt-doc"] }, reversedAt: null,
  });
  assert.equal(result.invoiceCount, 1);
  assert.equal(result.receiptCount, 1);
  assert.equal(result.totalCents, 124);
});

test("αξιολόγηση load: χωρίς ορατό POSTED receipt δεν ζητά ανεξάρτητες παραλαβές", async (t) => {
  stubFindMany(t, db.warehouse, async () => [{ id: "w1" }] as never);
  stubFindMany(t, db.purchaseDoc, async () => [] as never);
  const receipts = stubFindMany(t, db.purchaseReceipt, async () => [] as never);
  const result = await loadSupplierEvaluation({ orgId: "org-1", storeIds: [], warehouseIds: ["w1"] }, "supplier-1");
  assert.equal(receipts.mock.callCount(), 0);
  assert.equal(result.receiptCount, 0);
});
