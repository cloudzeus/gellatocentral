import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import type { Permission } from "./permissions.ts";
import { businessReport } from "./reports-db.ts";
import { customerOutstandingDocuments, type CustomerOutstandingDocument } from "./reports.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const KG = 1_000_000;
const at = (hour: number) => new Date(`2026-11-24T${String(hour).padStart(2, "0")}:00:00.000Z`);

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `RPT integration ${suffix}`, vatNumber: `TEST-${suffix}` } });
  const foreign = await db.organization.create({ data: { name: `RPT foreign ${suffix}`, vatNumber: `FOREIGN-${suffix}` } });
  const user = await db.user.create({ data: { email: `reports-${suffix}@example.test`, name: "Αναφορές integration" } });
  const role = await db.orgRole.create({ data: { orgId: org.id, name: "Αναφορές integration", permissions: ["reports.read", "staff.pay"] } });
  const membership = await db.membership.create({ data: { orgId: org.id, userId: user.id, roleId: role.id } });
  const store = await db.store.create({ data: { orgId: org.id, name: "Κατάστημα RPT" } });
  const otherStore = await db.store.create({ data: { orgId: org.id, name: "Άλλο κατάστημα RPT" } });
  const foreignStore = await db.store.create({ data: { orgId: foreign.id, name: "Ξένο κατάστημα RPT" } });
  const warehouse = await db.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη RPT" } });
  const otherWarehouse = await db.warehouse.create({ data: { orgId: org.id, name: "Άλλη αποθήκη RPT" } });
  await db.storeWarehouse.createMany({ data: [{ storeId: store.id, warehouseId: warehouse.id }, { storeId: otherStore.id, warehouseId: otherWarehouse.id }] });
  await db.membershipStore.create({ data: { membershipId: membership.id, storeId: store.id } });
  await db.membershipWarehouse.create({ data: { orgId: org.id, membershipId: membership.id, warehouseId: warehouse.id } });
  const unit = await db.unit.findFirstOrThrow({ where: { code: "mg", toBase: 1 } });
  const vat = await db.vatRate.create({ data: { name: `RPT-${suffix}`, rate: 24 } });
  const paymentMethod = await db.paymentMethod.create({ data: { code: `card-${suffix}`, name: "Κάρτα RPT", provider: "MANUAL", ledgerKind: "CARD_CLEARING" } });
  const generic = await db.genericItem.create({ data: { orgId: org.id, name: "Παγωτό RPT", baseUnitId: unit.id, avgCostHundredths: 40_000 } });
  const lot = await db.stockLot.create({ data: { orgId: org.id, warehouseId: warehouse.id, genericItemId: generic.id, batchNumber: `RPT-${suffix}` } });
  const category = await db.category.create({ data: { orgId: org.id, name: "Παγωτά RPT" } });
  const product = await db.product.create({ data: { orgId: org.id, categoryId: category.id, vatRateId: vat.id, name: "Βανίλια RPT", priceCents: 1240 } });
  const recipe = await db.recipe.create({ data: { orgId: org.id, name: "Συνταγή RPT", productId: product.id, outputGenericItemId: generic.id, batchGrams: 1000, items: { create: [{ orgId: org.id, genericItemId: generic.id, grams: 1000 }] } } });
  const device = await db.device.create({ data: { orgId: org.id, storeId: store.id, name: "POS RPT", kind: "POS_WEB" } });
  const otherDevice = await db.device.create({ data: { orgId: org.id, storeId: otherStore.id, name: "POS other RPT", kind: "POS_WEB" } });
  const foreignDevice = await db.device.create({ data: { orgId: foreign.id, storeId: foreignStore.id, name: "POS foreign RPT", kind: "POS_WEB" } });
  const sale = await db.sale.create({ data: {
    orgId: org.id, storeId: store.id, deviceId: device.id, status: "COMPLETED", issuedAt: at(10), series: `RPT-${suffix}`, aa: 1, totalCents: 2480,
    lines: { create: [{ productId: product.id, name: product.name, quantity: 2, unitPriceCents: 1240, vatRate: 24 }] },
    payment: { create: { methodId: paymentMethod.id, amountCents: 2480, success: true } },
  } });
  await db.stockMovement.create({ data: { orgId: org.id, storeId: store.id, warehouseId: warehouse.id, documentId: sale.id, genericItemId: generic.id, lotId: lot.id, quantity: -KG, unitCostHundredths: 40_000, source: "sale", occurredAt: at(10) } });
  await db.sale.create({ data: { orgId: org.id, storeId: otherStore.id, deviceId: otherDevice.id, status: "COMPLETED", issuedAt: at(11), series: `OTHER-${suffix}`, aa: 1, totalCents: 9999, lines: { create: [{ productId: product.id, name: product.name, quantity: 1, unitPriceCents: 9999, vatRate: 24 }] } } });
  await db.sale.create({ data: { orgId: foreign.id, storeId: foreignStore.id, deviceId: foreignDevice.id, status: "COMPLETED", issuedAt: at(11), series: `FOREIGN-${suffix}`, aa: 1, totalCents: 7777 } });
  await db.cashClosing.createMany({ data: [
    { orgId: org.id, storeId: store.id, businessDate: new Date("2026-11-24T00:00:00.000Z"), shift: "DAY", expectedCashCents: 0, actualCashCents: 0, commissionCents: 100, status: "CLOSED", closedByName: user.name },
    { orgId: org.id, storeId: otherStore.id, businessDate: new Date("2026-11-24T00:00:00.000Z"), shift: "DAY", expectedCashCents: 0, actualCashCents: 0, commissionCents: 50, status: "CLOSED", closedByName: user.name },
    { orgId: foreign.id, storeId: foreignStore.id, businessDate: new Date("2026-11-24T00:00:00.000Z"), shift: "DAY", expectedCashCents: 0, actualCashCents: 0, commissionCents: 70, status: "CLOSED", closedByName: "Foreign RPT" },
  ] });
  const customer = await db.party.create({ data: { orgId: org.id, name: "Πελάτης RPT", roles: ["customer"], vatNumber: `C-${suffix}` } });
  const supplier = await db.party.create({ data: { orgId: org.id, name: "Προμηθευτής RPT", roles: ["supplier"] } });
  const order = await db.wholesaleOrder.create({ data: { orgId: org.id, customerId: customer.id, storeId: store.id, warehouseId: warehouse.id, number: `ORDER-${suffix}`, status: "INVOICED", netCents: 1000, vatCents: 240, totalCents: 1240, createdByName: user.name } });
  const invoiceFiscal = await db.fiscalDocument.create({ data: { orgId: org.id, partyId: customer.id, docType: "1.1", receiptReference: `RPT-INVOICE-${suffix}`, status: "NOT_SENT", request: { fixture: true } } });
  const invoice = await db.salesDocument.create({ data: {
    orgId: org.id, orderId: order.id, customerId: customer.id, storeId: store.id, warehouseId: warehouse.id, fiscalDocumentId: invoiceFiscal.id, docType: "1.1", series: `TIM-${suffix}`, aa: 1, issuedAt: at(12), dueAt: new Date("2026-12-24T00:00:00.000Z"), netCents: 1000, vatCents: 240, totalCents: 1240, customerSnapshot: { name: customer.name }, createdByName: user.name,
    lines: { create: [{ orgId: org.id, genericItemId: generic.id, lotId: lot.id, quantityBase: KG, unitPriceCents: 1000, vatRate: 24, costHundredths: 40_000 }] },
  } });
  const creditFiscal = await db.fiscalDocument.create({ data: { orgId: org.id, partyId: customer.id, docType: "5.1", relatedId: invoiceFiscal.id, receiptReference: `RPT-CREDIT-${suffix}`, status: "NOT_SENT", request: { fixture: true } } });
  await db.salesDocument.create({ data: {
    orgId: org.id, orderId: order.id, customerId: customer.id, storeId: store.id, warehouseId: warehouse.id, fiscalDocumentId: creditFiscal.id, docType: "5.1", series: `PIST-${suffix}`, aa: 1, issuedAt: at(13), netCents: 200, vatCents: 48, totalCents: 248, customerSnapshot: { name: customer.name }, createdByName: user.name,
    lines: { create: [{ orgId: org.id, genericItemId: generic.id, lotId: lot.id, quantityBase: 200_000, unitPriceCents: 1000, vatRate: 24, costHundredths: 8000 }] },
  } });
  await db.purchaseDoc.create({ data: {
    orgId: org.id, supplierId: supplier.id, warehouseId: warehouse.id, number: `BUY-${suffix}`, status: "POSTED", issuedAt: at(8), createdByName: user.name,
    lines: { create: [{ orgId: org.id, genericItemId: generic.id, description: "Αγορά RPT", quantity: 1, unitPriceCents: 1000, vatRate: 24 }] },
  } });
  // POSTED παραλαβή με σκόπιμα μεγάλα ποσά: δεν πρέπει να αλλάξει αγορές, ΦΠΑ ή supplier outstanding.
  await db.purchaseDoc.create({ data: {
    orgId: org.id, supplierId: supplier.id, warehouseId: warehouse.id, kind: "RECEIPT", source: "order", number: `RECEIPT-${suffix}`, status: "POSTED", issuedAt: at(8), createdByName: user.name,
    lines: { create: [{ orgId: org.id, genericItemId: generic.id, description: "Μη χρηματοοικονομική παραλαβή RPT", quantity: 1, unitPriceCents: 90_000, vatRate: 24 }] },
  } });
  await db.expense.create({ data: { orgId: org.id, storeId: store.id, supplierId: supplier.id, category: "utilities", documentNumber: `EXP-${suffix}`, netCents: 200, vatRate: 24, vatCents: 48, totalCents: 248, occurredAt: at(9), createdByName: user.name } });
  const account = await db.financeAccount.create({ data: { orgId: org.id, storeId: store.id, name: `Ταμείο-${suffix}`, kind: "cash", openingAt: at(0) } });
  await db.financeTransaction.createMany({ data: [
    { orgId: org.id, accountId: account.id, storeId: store.id, amountCents: 1240, kind: "income", occurredAt: at(14), createdByName: user.name },
    { orgId: org.id, accountId: account.id, storeId: store.id, amountCents: -248, kind: "expense", occurredAt: at(15), createdByName: user.name },
    { orgId: org.id, accountId: account.id, storeId: store.id, amountCents: 999, kind: "transfer", transferId: `transfer-${suffix}`, occurredAt: at(16), createdByName: user.name },
  ] });
  const employee = await db.employee.create({ data: { orgId: org.id, storeId: store.id, name: "Εργαζόμενος RPT", pay: { create: { orgId: org.id, hourlyRateCents: 900 } } } });
  await db.shift.create({ data: { orgId: org.id, employeeId: employee.id, storeId: store.id, startsAt: new Date("2026-11-24T08:00:00.000Z"), endsAt: new Date("2026-11-24T10:00:00.000Z"), hourlyRateCents: 900 } });
  // Η πωληθείσα lot συνδέεται με δόση 300 cents υλικών + 450 εργασίας και 10% φύρα.
  const batch = await db.productionBatch.create({ data: { orgId: org.id, recipeId: recipe.id, warehouseId: warehouse.id, outputGenericItemId: generic.id, outputLotId: lot.id, batchNumber: `BATCH-${suffix}`, costHundredths: 30_000, expectedQuantityGrams: 1000, quantityGrams: 900, wasteGrams: 100, producedAt: at(17), labourMinutes: 30, labourCostCents: 450 } });
  await db.stockLot.update({ where: { id: lot.id }, data: { productionBatchId: batch.id } });
  await db.budgetTarget.create({ data: { orgId: org.id, storeId: store.id, year: 2026, month: 11, salesCents: 100_000, cogsCents: 20_000, payrollCents: 10_000, expenseCents: 5000 } });
  return { orgId: org.id, foreignOrgId: foreign.id, userId: user.id, membershipId: membership.id, storeId: store.id, otherStoreId: otherStore.id, warehouseId: warehouse.id, genericId: generic.id, vatId: vat.id, invoiceId: invoice.id, paymentMethodId: paymentMethod.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture, restricted = false, pay = true): StockContext {
  const permissions: Permission[] = ["reports.read", ...(pay ? ["staff.pay" as const] : [])];
  return { orgId: f.orgId, membershipId: f.membershipId, userId: f.userId, userName: "Αναφορές integration", permissions, storeIds: restricted ? [f.storeId] : [], warehouseIds: restricted ? [f.warehouseId] : [], can: (permission) => permissions.includes(permission) };
}

function outstandingDocument(overrides: Partial<CustomerOutstandingDocument> = {}): CustomerOutstandingDocument {
  return { id: "invoice", customerId: "customer", docType: "1.1", status: "ISSUED", totalCents: 1240, dueAt: new Date("2026-12-24T00:00:00Z"), fiscalDocumentId: "fiscal-invoice", allocations: [], ...overrides };
}

test("outstanding: το συσχετιζόμενο πιστωτικό μειώνει μόνο το αρχικό τιμολόγιο", () => {
  const credit = outstandingDocument({ id: "credit", docType: "5.1", totalCents: 248, fiscalDocumentId: "fiscal-credit" });
  const rows = customerOutstandingDocuments([outstandingDocument(), credit], [{ id: "fiscal-invoice", relatedId: null }, { id: "fiscal-credit", relatedId: "fiscal-invoice" }]);
  assert.deepEqual(rows.map((row) => ({ id: row.id, outstandingCents: row.outstandingCents })), [{ id: "invoice", outstandingCents: 992 }]);
});

test("outstanding: συσχετιζόμενο πιστωτικό και allocations αφαιρούνται μία φορά", () => {
  const invoice = outstandingDocument({ allocations: [{ amountCents: 192 }] });
  const credit = outstandingDocument({ id: "credit", docType: "5.1", totalCents: 248, fiscalDocumentId: "fiscal-credit" });
  const rows = customerOutstandingDocuments([invoice, credit], [{ id: "fiscal-invoice", relatedId: null }, { id: "fiscal-credit", relatedId: "fiscal-invoice" }]);
  assert.equal(rows[0]?.outstandingCents, 800);
});

test("outstanding: δεν εφευρίσκεται allocation για ασύνδετο ή υπερβάλλον πιστωτικό", () => {
  const otherInvoice = outstandingDocument({ id: "other-invoice", fiscalDocumentId: "fiscal-other" });
  const credit = outstandingDocument({ id: "credit", docType: "5.1", totalCents: 1240, fiscalDocumentId: "fiscal-credit" });
  const orphan = outstandingDocument({ id: "orphan", docType: "5.1", totalCents: 500, fiscalDocumentId: "fiscal-orphan" });
  const rows = customerOutstandingDocuments([outstandingDocument({ status: "CANCELLED" }), otherInvoice, credit, orphan], [
    { id: "fiscal-invoice", relatedId: null }, { id: "fiscal-other", relatedId: null },
    { id: "fiscal-credit", relatedId: "fiscal-invoice" }, { id: "fiscal-orphan", relatedId: null },
  ]);
  assert.deepEqual(rows.map((row) => ({ id: row.id, outstandingCents: row.outstandingCents })), [{ id: "other-invoice", outstandingCents: 1240 }]);
});

test("PostgreSQL RPT: πραγματικά σύνολα, COGS, payroll, cash και tenant/store isolation", databaseOptions, async () => {
  const f = await fixture();
  try {
    const report = await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24", storeId: f.storeId });
    assert.deepEqual({ net: report.sales.posNetCents, vat: report.sales.posVatCents, gross: report.sales.posGrossCents }, { net: 2000, vat: 480, gross: 2480 });
    assert.deepEqual({ net: report.sales.wholesaleNetCents, vat: report.sales.wholesaleVatCents, gross: report.sales.wholesaleGrossCents }, { net: 800, vat: 192, gross: 992 });
    assert.equal(report.sales.netRevenueCents, 2800);
    assert.equal(report.wholesaleItems[0]?.netCents, 800);
    assert.equal(report.margin.posCogsCents, 400);
    assert.equal(report.margin.wholesaleCogsCents, 320);
    assert.equal(report.margin.cogsCents, 720);
    assert.equal(report.margin.expenseNetCents, 200);
    assert.equal(report.margin.payrollCents, 1800);
    assert.equal(report.margin.operatingCents, 80);
    assert.equal(report.margin.posCostedMovements, 1);
    assert.equal(report.products[0]?.cogsCents, 400);
    // 300 υλικά + 450 εργασία με 10% φύρα → profile 270/405/75· POS 400 → 144/216/40.
    assert.deepEqual({ materials: report.products[0]?.materialsCents, labour: report.products[0]?.labourCents, waste: report.products[0]?.wasteCents }, { materials: 144, labour: 216, waste: 40 });
    assert.equal(report.products[0]?.commissionCents, 100);
    assert.equal(report.products[0]?.contributionCents, 1500);
    // Χονδρική: τιμολόγιο 400 μείον πιστωτικό 80 (29/43/8) → 115/173/32, σύνολο 320.
    assert.deepEqual({ materials: report.wholesaleItems[0]?.materialsCents, labour: report.wholesaleItems[0]?.labourCents, waste: report.wholesaleItems[0]?.wasteCents }, { materials: 115, labour: 173, waste: 32 });
    assert.equal(report.wholesaleItems[0]?.contributionCents, 480);
    assert.equal(report.margin.commissionCents, 100);
    assert.equal(report.margin.unallocatedCommissionCents, 0);
    assert.equal(report.margin.unallocatedPosCogsCents, 0);
    assert.equal(report.vat.balanceCents, 384);
    assert.equal(report.purchases.netCents, 1000);
    assert.equal(report.cash.inCents, 1240);
    assert.equal(report.cash.outCents, 248);
    assert.equal(report.cash.netCents, 992);
    assert.equal(report.production.wasteGrams, 100);
    assert.equal(report.production.labourCostCents, 450);
    assert.equal(report.customers[0]?.outstandingCents, 992);
    assert.deepEqual(report.customers[0]?.aging, { current: 992, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 });
    assert.equal(report.suppliers[0]?.outstandingCents, 1240);

    const restricted = await businessReport(context(f, true), { from: "2026-11-24", to: "2026-11-24" });
    assert.equal(restricted.sales.posCount, 1);
    assert.equal(restricted.sales.posGrossCents, 2480);
    assert.equal(restricted.margin.commissionCents, 100);
    const otherStore = await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24", storeId: f.otherStoreId });
    assert.equal(otherStore.sales.posNetCents, 8064);
    assert.equal(otherStore.margin.commissionCents, 50);
    assert.equal(otherStore.margin.unallocatedCommissionCents, 50);
    assert.equal(otherStore.products[0]?.commissionCents, 0);
    const noPay = await businessReport(context(f, false, false), { from: "2026-11-24", to: "2026-11-24", storeId: f.storeId });
    assert.equal(noPay.margin.payrollCents, 0);
    assert.equal(noPay.payroll.length, 0);
    assert.equal(noPay.production.labourCostCents, null);
    assert.deepEqual({ materials: noPay.products[0]?.materialsCents, labour: noPay.products[0]?.labourCents, waste: noPay.products[0]?.wasteCents }, { materials: null, labour: null, waste: null });
    assert.deepEqual({ materials: noPay.wholesaleItems[0]?.materialsCents, labour: noPay.wholesaleItems[0]?.labourCents, waste: noPay.wholesaleItems[0]?.wasteCents }, { materials: null, labour: null, waste: null });
    await db.customerPayment.create({ data: {
      orgId: f.orgId, customerId: report.customers[0]!.id, amountCents: 692, paidAt: at(18), createdByName: "Αναφορές integration",
      allocations: { create: [{ orgId: f.orgId, documentId: f.invoiceId, amountCents: 192 }] },
    } });
    // Τα 500 cents παραμένουν αδιάθετη προκαταβολή· μόνο τα 192 cents της allocation μειώνουν το τιμολόγιο.
    const withPayment = await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24", storeId: f.storeId });
    assert.equal(withPayment.customers[0]?.outstandingCents, 800);
    assert.deepEqual(withPayment.customers[0]?.aging, { current: 800, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 });
    await assert.rejects(businessReport(context(f, true), { from: "2026-11-24", to: "2026-11-24", storeId: f.otherStoreId }), StockScopeError);
  } finally {
    await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
    await db.customerPaymentAllocation.deleteMany({ where: { orgId: { in: [f.orgId, f.foreignOrgId] } } });
    await db.saleLine.deleteMany({ where: { sale: { orgId: { in: [f.orgId, f.foreignOrgId] } } } });
    await db.organization.deleteMany({ where: { id: { in: [f.orgId, f.foreignOrgId] } } });
    await db.user.deleteMany({ where: { id: f.userId } });
    await db.vatRate.deleteMany({ where: { id: f.vatId } });
    await db.paymentMethod.deleteMany({ where: { id: f.paymentMethodId } });
  }
});
