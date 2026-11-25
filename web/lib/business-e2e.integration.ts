import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { closeCashRegister, createExpense, createFinanceAccount } from "./finance-db.ts";
import { DisabledMyDataProvider, transmitSalesDocument } from "./mydata-outgoing.ts";
import { createInvoiceFromReceipt, createPurchaseOrder, markPurchaseOrderSent, receivePurchaseOrder, reviewPurchaseReceipt } from "./procurement-db.ts";
import { correctProductionOutput } from "./production-db.ts";
import { closeProductionDay } from "./production-day-close-db.ts";
import { businessReport } from "./reports-db.ts";
import { createShift, saveDepartment, saveEmployee, saveEmployeePay, staffPayrollSummary } from "./staff-db.ts";
import { createStockCount, finalizeStockCount, updateStockCountMeasurements } from "./stock-counts.ts";
import { stockBalance } from "./stock-db.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";
import { postStockTransfer } from "./stock-transfers.ts";
import type { Permission } from "./permissions.ts";
import {
  confirmWholesaleOrder, createDeliveryRoute, createWholesaleOrder, creditSalesDocument,
  deliverWholesaleOrder, invoiceWholesaleOrder, recordCustomerPayment,
} from "./wholesale-db.ts";
import { WorkflowError } from "./workflow-db.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const KG = 1_000_000;
const businessDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
const at = (hour: number) => new Date(`${businessDate}T${String(hour).padStart(2, "0")}:00:00.000Z`);

const allPermissions: Permission[] = [
  "purchases.read", "purchases.add", "purchases.edit", "production.read", "production.add",
  "stock.transfer", "counts.read", "counts.add", "counts.edit", "counts.finalize",
  "wholesale.read", "wholesale.add", "wholesale.edit", "invoices.read", "invoices.add", "invoices.edit", "invoices.cancel",
  "finance.read", "finance.edit", "staff.read", "staff.add", "staff.edit", "staff.pay", "reports.read",
];

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `E2E integration ${suffix}`, vatNumber: `E2E-${suffix}` } });
    const foreign = await tx.organization.create({ data: { name: `E2E foreign ${suffix}`, vatNumber: `FOREIGN-${suffix}` } });
    const user = await tx.user.create({ data: { email: `e2e-${suffix}@example.test`, name: "Υπεύθυνος E2E integration" } });
    const role = await tx.orgRole.create({ data: { orgId: org.id, name: "Πλήρης E2E integration", permissions: allPermissions } });
    const membership = await tx.membership.create({ data: { orgId: org.id, userId: user.id, roleId: role.id } });
    const foreignRole = await tx.orgRole.create({ data: { orgId: foreign.id, name: "Ξένος E2E", permissions: allPermissions } });
    const foreignMembership = await tx.membership.create({ data: { orgId: foreign.id, userId: user.id, roleId: foreignRole.id } });
    const store = await tx.store.create({ data: { orgId: org.id, name: "Κατάστημα E2E" } });
    const otherStore = await tx.store.create({ data: { orgId: org.id, name: "Υποκατάστημα E2E" } });
    const rawWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Πρώτες ύλες E2E" } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Έτοιμα E2E" } });
    const otherWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Έτοιμα υποκαταστήματος E2E" } });
    await tx.storeWarehouse.createMany({ data: [
      { storeId: store.id, warehouseId: warehouse.id, isDefault: true },
      { storeId: otherStore.id, warehouseId: otherWarehouse.id, isDefault: true },
    ] });
    const foreignStore = await tx.store.create({ data: { orgId: foreign.id, name: "Ξένο κατάστημα E2E" } });
    const foreignWarehouse = await tx.warehouse.create({ data: { orgId: foreign.id, name: "Ξένη αποθήκη E2E" } });
    await tx.storeWarehouse.create({ data: { storeId: foreignStore.id, warehouseId: foreignWarehouse.id, isDefault: true } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `e2e-mg-${suffix}`, nameEL: "χιλιοστόγραμμο E2E", dimension: "mass", toBase: 1 } });
    const raw = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα E2E", baseUnitId: unit.id } });
    const base = await tx.genericItem.create({ data: { orgId: org.id, name: "Βάση E2E", baseUnitId: unit.id } });
    const final = await tx.genericItem.create({ data: { orgId: org.id, name: "Παγωτό E2E", baseUnitId: unit.id } });
    const foreignGeneric = await tx.genericItem.create({ data: { orgId: foreign.id, name: "Ξένο είδος E2E", baseUnitId: unit.id } });
    const supplier = await tx.party.create({ data: { orgId: org.id, name: "Προμηθευτής E2E", roles: ["supplier"], vatNumber: `S-${suffix}` } });
    const customer = await tx.party.create({ data: { orgId: org.id, name: "Πελάτης E2E", roles: ["customer"], vatNumber: `C-${suffix}` } });
    const foreignCustomer = await tx.party.create({ data: { orgId: foreign.id, name: "Ξένος πελάτης E2E", roles: ["customer"], vatNumber: `FC-${suffix}` } });
    const baseRecipe = await tx.recipe.create({ data: {
      orgId: org.id, name: "Υποσυνταγή E2E", type: "cream", batchGrams: 1000, outputGenericItemId: base.id,
      items: { create: [{ orgId: org.id, genericItemId: raw.id, grams: 1000 }] },
    } });
    const finalRecipe = await tx.recipe.create({ data: {
      orgId: org.id, name: "Τελική συνταγή E2E", type: "cream", batchGrams: 2000, outputGenericItemId: final.id, shelfLifeDays: 5,
      items: { create: [{ orgId: org.id, genericItemId: base.id, grams: 500 }, { orgId: org.id, genericItemId: raw.id, grams: 1500, sortOrder: 1 }] },
    } });
    const plan = await tx.productionPlan.create({ data: {
      orgId: org.id, storeId: store.id, recipeId: finalRecipe.id, sourceWarehouseId: rawWarehouse.id, destinationWarehouseId: warehouse.id,
      plannedFor: at(8), quantityGrams: 2000, createdByName: user.name,
    } });
    const device = await tx.device.create({ data: { orgId: org.id, storeId: store.id, name: "POS E2E", kind: "POS_WEB" } });
    const existingCash = await tx.paymentMethod.findFirst({ where: { code: "cash", ledgerKind: "CASH" } });
    const cashMethod = existingCash ?? await tx.paymentMethod.create({ data: { code: `e2e-cash-${suffix}`, name: "Μετρητά E2E", provider: "MANUAL", ledgerKind: "CASH" } });
    const category = await tx.category.create({ data: { orgId: org.id, name: "Παγωτά E2E" } });
    const vat = await tx.vatRate.create({ data: { name: `E2E-${suffix}`, rate: 24 } });
    const product = await tx.product.create({ data: { orgId: org.id, categoryId: category.id, vatRateId: vat.id, name: "Βανίλια E2E", priceCents: 1240 } });
    return {
      orgId: org.id, foreignOrgId: foreign.id, userId: user.id, membershipId: membership.id, foreignMembershipId: foreignMembership.id,
      storeId: store.id, otherStoreId: otherStore.id, rawWarehouseId: rawWarehouse.id, warehouseId: warehouse.id, otherWarehouseId: otherWarehouse.id,
      foreignStoreId: foreignStore.id, foreignWarehouseId: foreignWarehouse.id, rawItemId: raw.id, baseItemId: base.id, finalItemId: final.id,
      foreignGenericItemId: foreignGeneric.id, supplierId: supplier.id, customerId: customer.id, foreignCustomerId: foreignCustomer.id,
      baseRecipeId: baseRecipe.id, finalRecipeId: finalRecipe.id, planId: plan.id, unitId: unit.id, ownsUnit: !existingUnit,
      deviceId: device.id, cashMethodId: cashMethod.id, ownsCashMethod: !existingCash, productId: product.id, vatId: vat.id, userName: user.name,
    };
  });
}

function context(f: Fixture, options: { restricted?: boolean; foreign?: boolean; pay?: boolean } = {}): StockContext {
  const permissions = allPermissions.filter((permission) => options.pay !== false || permission !== "staff.pay");
  return {
    orgId: options.foreign ? f.foreignOrgId : f.orgId,
    membershipId: options.foreign ? f.foreignMembershipId : f.membershipId,
    userId: f.userId, userName: f.userName, permissions,
    storeIds: options.restricted ? [f.storeId] : [],
    warehouseIds: options.restricted ? [f.warehouseId] : [],
    can: (permission) => permissions.includes(permission),
  };
}

async function cleanup(f: Fixture) {
  const orgIds = [f.orgId, f.foreignOrgId];
  await db.stockMovement.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.customerPaymentAllocation.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.customerPayment.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.financeTransaction.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.salesDocumentLine.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.salesDocument.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.fiscalDocument.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.deliveryStop.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.deliveryRoute.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.stockTransferLine.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.stockTransfer.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.stockCountLine.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.stockCount.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.shift.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.employeePay.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.employee.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.saleLine.deleteMany({ where: { sale: { orgId: { in: orgIds } } } });
  await db.purchaseReceipt.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsCashMethod) await db.paymentMethod.deleteMany({ where: { id: f.cashMethodId } });
  await db.vatRate.deleteMany({ where: { id: f.vatId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

test("PostgreSQL E2E: αγορά → παραγωγή → απόθεμα → χονδρική → ταμείο → P&L με tenant/RBAC", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  const restricted = context(f, { restricted: true });
  try {
    // 10 kg × 500 λεπτά/kg, ΦΠΑ 24%: η αγορά είναι 5.000 + 1.200 = 6.200 λεπτά.
    const purchase = await createPurchaseOrder(ctx, {
      supplierId: f.supplierId, warehouseId: f.rawWarehouseId,
      lines: [{ genericItemId: f.rawItemId, quantityBase: 10 * KG, unitPriceCents: 500, vatRate: 24 }],
    });
    assert.deepEqual({ net: purchase.netCents, vat: purchase.vatCents, total: purchase.totalCents }, { net: 5000, vat: 1200, total: 6200 });
    await markPurchaseOrderSent(ctx, purchase.id);
    const orderLine = purchase.lines[0]!;
    const firstReceiptInput = { orderId: purchase.id, clientKey: randomUUID(), lines: [{ orderLineId: orderLine.id, quantityBase: 4 * KG, batchNumber: `EARLY-${randomUUID()}`, expiresAt: new Date("2027-01-01T00:00:00.000Z") }] };
    const firstReceipt = await receivePurchaseOrder(ctx, firstReceiptInput);
    const secondReceiptInput = { orderId: purchase.id, clientKey: randomUUID(), lines: [{ orderLineId: orderLine.id, quantityBase: 6 * KG, batchNumber: `LATE-${randomUUID()}`, expiresAt: new Date("2027-02-01T00:00:00.000Z") }] };
    const secondReceipt = await receivePurchaseOrder(ctx, secondReceiptInput);
    assert.equal((await receivePurchaseOrder(ctx, secondReceiptInput)).id, secondReceipt.id);
    assert.equal(await db.purchaseReceipt.count({ where: { orgId: f.orgId } }), 2);
    assert.equal((await db.purchaseOrder.findUnique({ where: { id: purchase.id } }))?.status, "RECEIVED");
    const receiptLines = await db.purchaseReceiptLine.findMany({ where: { orgId: f.orgId }, orderBy: { quantityBase: "asc" } });
    const earlyLotId = receiptLines.find((line) => line.receiptId === firstReceipt.id)!.lotId!;
    const lateLotId = receiptLines.find((line) => line.receiptId === secondReceipt.id)!.lotId!;
    assert.equal((await db.genericItem.findUnique({ where: { id: f.rawItemId } }))?.avgCostHundredths, 50_000);
    const movementsAfterReceipts = await db.stockMovement.count({ where: { orgId: f.orgId } });
    await reviewPurchaseReceipt(ctx, { receiptId: firstReceipt.id, note: "Έλεγχος πρώτης παραλαβής E2E" });
    await reviewPurchaseReceipt(ctx, { receiptId: secondReceipt.id, note: "Έλεγχος δεύτερης παραλαβής E2E" });
    await createInvoiceFromReceipt(ctx, { receiptId: firstReceipt.id, number: `ΤΙΜ-A-${randomUUID()}`, issuedAt: at(9), lines: [{ receiptLineId: receiptLines.find((line) => line.receiptId === firstReceipt.id)!.id, quantityBase: 4 * KG, unitPriceCents: 500, vatRate: 24 }] });
    await createInvoiceFromReceipt(ctx, { receiptId: secondReceipt.id, number: `ΤΙΜ-B-${randomUUID()}`, issuedAt: at(9), lines: [{ receiptLineId: receiptLines.find((line) => line.receiptId === secondReceipt.id)!.id, quantityBase: 6 * KG, unitPriceCents: 500, vatRate: 24 }] });
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), movementsAfterReceipts);
    assert.equal((await db.genericItem.findUnique({ where: { id: f.rawItemId } }))?.avgCostHundredths, 50_000);
    assert.equal(
      await stockBalance(db, { orgId: f.orgId, warehouseId: f.rawWarehouseId, genericItemId: f.rawItemId, lotId: earlyLotId })
      + await stockBalance(db, { orgId: f.orgId, warehouseId: f.rawWarehouseId, genericItemId: f.rawItemId, lotId: lateLotId }),
      10 * KG,
    );
    await assert.rejects(createPurchaseOrder(restricted, { supplierId: f.supplierId, warehouseId: f.rawWarehouseId, lines: [{ genericItemId: f.rawItemId, quantityBase: KG, unitPriceCents: 1, vatRate: 24 }] }), WorkflowError);

    // 2 kg τελικού απαιτούν 500 g νέας βάσης και 1.500 g γάλα· πραγματική έξοδος 1.800 g.
    const closeInput = {
      businessDate, sourceWarehouseId: f.rawWarehouseId, destinationWarehouseId: f.warehouseId, clientKey: randomUUID(),
      actuals: [{ planId: f.planId, quantityGrams: 1800, scrapReason: "Απώλεια E2E", labourMinutes: 30, labourCostCents: 500 }],
    };
    const dayClose = await closeProductionDay(ctx, closeInput);
    assert.equal(dayClose.status, "COMPLETED");
    assert.equal((await closeProductionDay(ctx, closeInput)).id, dayClose.id);
    assert.equal(await db.productionDayClose.count({ where: { orgId: f.orgId } }), 1);
    const batches = await db.productionBatch.findMany({ where: { orgId: f.orgId }, include: { items: true } });
    assert.equal(batches.length, 2);
    const finalBatch = batches.find((batch) => batch.recipeId === f.finalRecipeId)!;
    const baseBatch = batches.find((batch) => batch.recipeId === f.baseRecipeId)!;
    assert.equal(baseBatch.quantityGrams, 500);
    assert.equal(finalBatch.costHundredths, 100_000);
    assert.equal(finalBatch.items.reduce((sum, item) => sum + item.costHundredths, 0), 100_000);
    const finalOutput = await db.stockMovement.findFirstOrThrow({ where: { orgId: f.orgId, documentId: finalBatch.id, source: "production_output" } });
    // (1.000 λεπτά υλικά + 500 εργασία) / 1,8 kg = 833,33 λεπτά/kg.
    assert.equal(finalOutput.unitCostHundredths, 83_333);
    assert.equal((await db.genericItem.findUnique({ where: { id: f.finalItemId } }))?.avgCostHundredths, 83_333);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.rawWarehouseId, genericItemId: f.rawItemId, lotId: earlyLotId }), 2000 * 1000);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.rawWarehouseId, genericItemId: f.rawItemId, lotId: lateLotId }), 6 * KG);
    await correctProductionOutput(ctx, { batchId: finalBatch.id, correctedQuantityGrams: 1900, reason: "Επανάληψη ζύγισης E2E" });
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.finalItemId, lotId: finalBatch.outputLotId! }), 1900 * 1000);

    const transferInput = {
      clientKey: randomUUID(), sourceWarehouseId: f.warehouseId, destinationWarehouseId: f.otherWarehouseId,
      note: "Τροφοδοσία υποκαταστήματος E2E",
      lines: [{ genericItemId: f.finalItemId, sourceLotId: finalBatch.outputLotId!, quantity: 400 * 1000 }],
    };
    await assert.rejects(postStockTransfer(restricted, transferInput), StockScopeError);
    const transfer = await postStockTransfer(ctx, transferInput);
    assert.equal((await postStockTransfer(ctx, transferInput)).id, transfer.id);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, transferId: transfer.id } }), 2);
    const transferLine = await db.stockTransferLine.findFirstOrThrow({ where: { orgId: f.orgId, transferId: transfer.id } });
    assert.equal(transferLine.unitCostHundredths, 83_333);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.finalItemId, lotId: finalBatch.outputLotId! }), 1500 * 1000);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.otherWarehouseId, genericItemId: f.finalItemId, lotId: transferLine.destinationLotId! }), 400 * 1000);

    const countInput = { clientKey: randomUUID(), storeId: f.otherStoreId, warehouseId: f.otherWarehouseId, countedOn: businessDate, note: "Απογραφή E2E" };
    const createdCount = await createStockCount(ctx, countInput);
    assert.equal((await createStockCount(ctx, countInput)).id, createdCount.id);
    const count = await db.stockCount.findUniqueOrThrow({ where: { id: createdCount.id }, include: { lines: true } });
    assert.equal(count.lines.length, 1);
    await updateStockCountMeasurements(ctx, count.id, [{ lineId: count.lines[0]!.id, actualQty: 350 * 1000, reason: "Φύρα κατά τη μεταφορά E2E" }]);
    assert.equal((await finalizeStockCount(ctx, count.id)).correctionCount, 1);
    assert.equal((await finalizeStockCount(ctx, count.id)).replayed, true);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.otherWarehouseId, genericItemId: f.finalItemId, lotId: transferLine.destinationLotId! }), 350 * 1000);

    const foreignOrderInput = { customerId: f.foreignCustomerId, storeId: f.storeId, warehouseId: f.warehouseId, lines: [{ genericItemId: f.foreignGenericItemId, quantityBase: KG, unitPriceCents: 1000, vatRate: 24 }] };
    await assert.rejects(createWholesaleOrder(ctx, foreignOrderInput), WorkflowError);
    await assert.rejects(createWholesaleOrder(restricted, { customerId: f.customerId, storeId: f.otherStoreId, warehouseId: f.otherWarehouseId, lines: [{ genericItemId: f.finalItemId, quantityBase: 1000, unitPriceCents: 1000, vatRate: 24 }] }), WorkflowError);
    assert.equal(await db.wholesaleOrder.count({ where: { orgId: f.orgId } }), 0);

    const order = await createWholesaleOrder(ctx, { customerId: f.customerId, storeId: f.storeId, warehouseId: f.warehouseId, lines: [{ genericItemId: f.finalItemId, quantityBase: KG, unitPriceCents: 1000, vatRate: 24 }] });
    assert.equal(order.totalCents, 1240);
    await confirmWholesaleOrder(ctx, order.id);
    const route = await createDeliveryRoute(ctx, { storeId: f.storeId, name: "Διαδρομή E2E", plannedFor: at(11), orderIds: [order.id] });
    const delivery = await deliverWholesaleOrder(ctx, { orderId: order.id, series: `ΔΑ-${randomUUID().slice(0, 8)}`, stopId: route.stops[0]!.id, deliveredAt: at(12), recipientName: "Παραλήπτης E2E" });
    assert.equal(delivery.lines[0]!.costHundredths, 83_333);
    const invoice = await invoiceWholesaleOrder(ctx, { orderId: order.id, series: `ΤΙΜ-${randomUUID().slice(0, 8)}`, issuedAt: at(13) });
    assert.equal((await invoiceWholesaleOrder(ctx, { orderId: order.id, series: "IGNORED" })).id, invoice.id);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, documentId: invoice.id } }), 0);
    await assert.rejects(invoiceWholesaleOrder(context(f, { foreign: true }), { orderId: order.id, series: "FOREIGN" }), WorkflowError);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.finalItemId, lotId: finalBatch.outputLotId! }), 500 * 1000);

    await assert.rejects(transmitSalesDocument(ctx, invoice.id, new DisabledMyDataProvider()), /Δεν έχει ρυθμιστεί πάροχος/);
    const failedFiscal = await db.fiscalDocument.findUniqueOrThrow({ where: { id: invoice.fiscalDocumentId! } });
    assert.equal(failedFiscal.status, "FAILED");
    assert.equal(failedFiscal.response, null);
    const fiscalRows = await db.fiscalDocument.findMany({ where: { orgId: f.orgId }, select: { response: true } });
    assert.ok(fiscalRows.every((row) => row.response === null));

    const cash = await createFinanceAccount(ctx, { name: `Ταμείο E2E ${randomUUID()}`, kind: "cash", storeId: f.storeId, openingBalanceCents: 1000, openingAt: at(0) });
    const expense = await createExpense(ctx, { storeId: f.storeId, supplierId: f.supplierId, accountId: cash.id, category: "utilities", documentNumber: `EXP-${randomUUID()}`, netCents: 100, vatRate: 24, occurredAt: at(9) });
    assert.equal(expense.totalCents, 124);
    const payment = await recordCustomerPayment(ctx, { clientKey: randomUUID(), customerId: f.customerId, accountId: cash.id, amountCents: 1000, paidAt: at(14), allocations: [{ documentId: invoice.id, amountCents: 1000 }] });
    assert.equal(payment.amountCents, 1000);
    assert.equal(await db.customerPaymentAllocation.count({ where: { orgId: f.orgId, paymentId: payment.id } }), 1);
    const accountTransactions = await db.financeTransaction.aggregate({ where: { orgId: f.orgId, accountId: cash.id }, _sum: { amountCents: true } });
    assert.equal(1000 + (accountTransactions._sum.amountCents ?? 0), 1876);
    await assert.rejects(creditSalesDocument(ctx, { documentId: invoice.id, series: "ΠΙΣΤ-PAID", reason: "Δεν επιτρέπεται μετά από είσπραξη" }), WorkflowError);

    const secondOrder = await createWholesaleOrder(ctx, { customerId: f.customerId, storeId: f.storeId, warehouseId: f.warehouseId, lines: [{ genericItemId: f.finalItemId, quantityBase: 500 * 1000, unitPriceCents: 1000, vatRate: 24 }] });
    await confirmWholesaleOrder(ctx, secondOrder.id);
    await deliverWholesaleOrder(ctx, { orderId: secondOrder.id, series: `ΔΑ2-${randomUUID().slice(0, 8)}`, deliveredAt: at(15) });
    const secondInvoice = await invoiceWholesaleOrder(ctx, { orderId: secondOrder.id, series: `ΤΙΜ2-${randomUUID().slice(0, 8)}`, issuedAt: at(16) });
    assert.equal(secondInvoice.lines[0]!.costHundredths, 41_667);
    const credit = await creditSalesDocument(ctx, { documentId: secondInvoice.id, series: `ΠΙΣΤ-${randomUUID().slice(0, 8)}`, reason: "Επιστροφή E2E" });
    assert.equal(credit.totalCents, 620);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.finalItemId, lotId: finalBatch.outputLotId! }), 500 * 1000);

    const sale = await db.sale.create({ data: {
      orgId: f.orgId, storeId: f.storeId, deviceId: f.deviceId, status: "COMPLETED", totalCents: 2480, issuedAt: at(10), series: `E2E-${randomUUID()}`, aa: 1,
      payment: { create: { methodId: f.cashMethodId, amountCents: 2480, success: true } },
      lines: { create: [{ productId: f.productId, name: "Βανίλια E2E", quantity: 2, unitPriceCents: 1240, vatRate: 24 }] },
    } });
    assert.ok(sale.id);
    const closing = await closeCashRegister(ctx, { storeId: f.storeId, businessDate: at(0), openingCashCents: 1000, actualCashCents: 3356, cashAccountId: cash.id });
    assert.deepEqual({ cash: closing.cashSalesCents, payouts: closing.payoutsCents, expected: closing.expectedCashCents, actual: closing.actualCashCents, sales: closing.salesCount }, { cash: 2480, payouts: 124, expected: 3356, actual: 3356, sales: 1 });

    const department = await saveDepartment(ctx, { name: `Παραγωγή E2E ${randomUUID()}`, kind: "production" });
    const employee = await saveEmployee(ctx, { name: "Εργαζόμενος E2E", departmentId: department.id, storeId: f.storeId });
    const noPay = context(f, { pay: false });
    await assert.rejects(saveEmployeePay(noPay, employee.id, { payType: "HOURLY", hourlyRateCents: 750, monthlySalaryCents: 0 }), WorkflowError);
    await saveEmployeePay(ctx, employee.id, { payType: "HOURLY", hourlyRateCents: 750, monthlySalaryCents: 0, iban: "GR16 0110 1250 0000 0001 2300 695", vatNumber: "123456789" });
    await createShift(ctx, { employeeId: employee.id, startsAt: at(8), endsAt: at(10), hourlyRateCents: 750 });
    await assert.rejects(staffPayrollSummary(noPay, at(0), at(23)), WorkflowError);

    const report = await businessReport(ctx, { from: businessDate, to: businessDate });
    assert.deepEqual(report.sales, { posCount: 1, posNetCents: 2000, posVatCents: 480, posGrossCents: 2480, wholesaleCount: 1, creditCount: 1, wholesaleNetCents: 500, wholesaleVatCents: 120, wholesaleGrossCents: 620, netRevenueCents: 2500 });
    assert.deepEqual(report.margin, { posCogsCents: 0, wholesaleCogsCents: 416, cogsCents: 416, grossCents: 2084, expenseNetCents: 100, payrollCents: 1500, operatingCents: 484, posCostedMovements: 0, posMovementCount: 0, unallocatedPosCogsCents: 0, commissionCents: 0, unallocatedCommissionCents: 0 });
    assert.deepEqual(report.vat, { outputCents: 600, purchaseCents: 1200, expenseCents: 24, balanceCents: -624 });
    assert.deepEqual(report.cash.inCents, 1000);
    assert.deepEqual({ out: report.cash.outCents, net: report.cash.netCents }, { out: 124, net: 876 });
    assert.deepEqual({ batches: report.production.batches, expected: report.production.expectedGrams, actual: report.production.actualGrams, waste: report.production.wasteGrams, labour: report.production.labourCostCents }, { batches: 2, expected: 2500, actual: 2400, waste: 100, labour: 500 });
    assert.equal(report.customers.find((row) => row.id === f.customerId)?.outstandingCents, 240);
    assert.equal(report.suppliers.find((row) => row.id === f.supplierId)?.outstandingCents, 6200);
    assert.equal(report.purchases.netCents, 5000);
    const privateReport = await businessReport(noPay, { from: businessDate, to: businessDate });
    assert.equal(privateReport.margin.payrollCents, 0);
    assert.equal(privateReport.margin.operatingCents, 1984);
    assert.equal(privateReport.payroll.length, 0);
    const foreignReport = await businessReport(context(f, { foreign: true }), { from: businessDate, to: businessDate });
    assert.equal(foreignReport.sales.netRevenueCents, 0);
    assert.equal(foreignReport.purchases.netCents, 0);
    assert.equal(foreignReport.cash.netCents, 0);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.foreignOrgId } }), 0);
    assert.equal(await db.wholesaleOrder.count({ where: { orgId: f.foreignOrgId } }), 0);
    assert.equal(await db.fiscalDocument.count({ where: { orgId: f.orgId, status: "SIGNED" } }), 0);
  } finally {
    await cleanup(f);
  }
});
