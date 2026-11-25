import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { transmitSalesDocument, type MyDataProvider } from "./mydata-outgoing.ts";
import { postStockMovement, stockBalance } from "./stock-db.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";
import { stockTransaction } from "./stock-transaction.ts";
import {
  confirmWholesaleOrder, createB2bAccess, createB2bOrder, createDeliveryRoute,
  createWholesaleOrder, creditSalesDocument, deliverWholesaleOrder, invoiceWholesaleOrder,
  recordCustomerPayment, savePriceList,
} from "./wholesale-db.ts";
import { WorkflowError } from "./workflow-db.ts";

// Σειρά παραστατικών της δοκιμής (η έκδοση δέχεται μόνο υπάρχουσα σειρά)
const newSeries = (orgId: string, docType: string) =>
  db.documentSeries.create({ data: { orgId, docType, code: `${docType}-${randomUUID().slice(0, 8)}` }, select: { id: true } }).then((s) => s.id);

const databaseOptions = { skip: !process.env.DATABASE_URL };
const KG = 1_000_000;

type Fixture = {
  orgId: string; userId: string; membershipId: string; storeId: string; otherStoreId: string;
  warehouseId: string; otherWarehouseId: string; customerId: string; otherCustomerId: string;
  genericItemId: string; earlyLotId: string; lateLotId: string; unitId: string; ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `WHOLESALE integration ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const user = await tx.user.create({ data: { email: `wholesale-${suffix}@example.test`, name: "Υπεύθυνος χονδρικής integration" } });
    const role = await tx.orgRole.create({ data: { orgId: org.id, name: "Χονδρική integration", permissions: ["wholesale.read", "wholesale.add", "wholesale.edit", "invoices.read", "invoices.add", "invoices.edit", "invoices.cancel"] } });
    const membership = await tx.membership.create({ data: { orgId: org.id, userId: user.id, roleId: role.id } });
    const store = await tx.store.create({ data: { orgId: org.id, name: "Κατάστημα χονδρικής integration" } });
    const otherStore = await tx.store.create({ data: { orgId: org.id, name: "Άλλο κατάστημα integration" } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη χονδρικής integration" } });
    const otherWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Άλλη αποθήκη integration" } });
    await tx.storeWarehouse.createMany({ data: [{ storeId: store.id, warehouseId: warehouse.id }, { storeId: otherStore.id, warehouseId: otherWarehouse.id }] });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Παγωτό χονδρικής integration", baseUnitId: unit.id, avgCostHundredths: 400_000 } });
    const customer = await tx.party.create({ data: { orgId: org.id, name: "Πελάτης Α integration", roles: ["customer"], vatNumber: `C-${suffix}` } });
    const otherCustomer = await tx.party.create({ data: { orgId: org.id, name: "Πελάτης Β integration", roles: ["customer"], vatNumber: `D-${suffix}` } });
    const earlyLot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: warehouse.id, genericItemId: generic.id, batchNumber: `EARLY-${suffix}`, expiresAt: new Date("2026-12-01T00:00:00.000Z") } });
    const lateLot = await tx.stockLot.create({ data: { orgId: org.id, warehouseId: warehouse.id, genericItemId: generic.id, batchNumber: `LATE-${suffix}`, expiresAt: new Date("2027-01-01T00:00:00.000Z") } });
    return { orgId: org.id, userId: user.id, membershipId: membership.id, storeId: store.id, otherStoreId: otherStore.id, warehouseId: warehouse.id, otherWarehouseId: otherWarehouse.id, customerId: customer.id, otherCustomerId: otherCustomer.id, genericItemId: generic.id, earlyLotId: earlyLot.id, lateLotId: lateLot.id, unitId: unit.id, ownsUnit: !existingUnit };
  });
}

function context(f: Fixture, restricted = false): StockContext {
  return {
    orgId: f.orgId, membershipId: f.membershipId, userId: f.userId, userName: "Υπεύθυνος χονδρικής integration",
    permissions: ["wholesale.read", "wholesale.add", "wholesale.edit", "invoices.read", "invoices.add", "invoices.edit", "invoices.cancel"],
    storeIds: restricted ? [f.storeId] : [], warehouseIds: restricted ? [f.warehouseId] : [],
    can: () => true,
  };
}

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
  await db.customerPaymentAllocation.deleteMany({ where: { orgId: f.orgId } });
  await db.customerPayment.deleteMany({ where: { orgId: f.orgId } });
  await db.financeTransaction.deleteMany({ where: { orgId: f.orgId } });
  await db.salesDocumentLine.deleteMany({ where: { orgId: f.orgId } });
  await db.salesDocument.deleteMany({ where: { orgId: f.orgId } });
  await db.fiscalDocument.deleteMany({ where: { orgId: f.orgId } });
  await db.deliveryStop.deleteMany({ where: { orgId: f.orgId } });
  await db.deliveryRoute.deleteMany({ where: { orgId: f.orgId } });
  await db.wholesaleOrderLine.deleteMany({ where: { orgId: f.orgId } });
  await db.wholesaleOrder.deleteMany({ where: { orgId: f.orgId } });
  await db.priceListItem.deleteMany({ where: { orgId: f.orgId } });
  await db.priceListParty.deleteMany({ where: { orgId: f.orgId } });
  await db.priceList.deleteMany({ where: { orgId: f.orgId } });
  await db.b2bAccess.deleteMany({ where: { orgId: f.orgId } });
  await db.documentSeries.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

async function seed(f: Fixture) {
  await stockTransaction(async (tx) => {
    const actor = { id: f.userId, name: "Seed integration" };
    await postStockMovement(tx, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: f.earlyLotId, quantity: KG, unitCostHundredths: 400_000, source: "manual", actor });
    await postStockMovement(tx, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: f.lateLotId, quantity: 5 * KG, unitCostHundredths: 400_000, source: "manual", actor });
  });
}

test("PostgreSQL WSL: FEFO, route, invoice χωρίς διπλή έξοδο, payment, myDATA retry και credit", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  try {
    await seed(f);
    await savePriceList(ctx, { name: `Γενικός ${randomUUID()}`, validFrom: new Date("2026-01-01T00:00:00.000Z"), lines: [{ genericItemId: f.genericItemId, unitPriceCents: 900, vatRate: 24 }] });
    await savePriceList(ctx, { name: `Πελάτης ${randomUUID()}`, validFrom: new Date("2026-01-01T00:00:00.000Z"), customerId: f.customerId, lines: [{ genericItemId: f.genericItemId, unitPriceCents: 1000, vatRate: 24 }] });
    const order = await createWholesaleOrder(ctx, { customerId: f.customerId, storeId: f.storeId, warehouseId: f.warehouseId, lines: [{ genericItemId: f.genericItemId, quantityBase: 2 * KG, unitPriceCents: 1000, vatRate: 24 }] });
    assert.equal(order.totalCents, 2480);
    await confirmWholesaleOrder(ctx, order.id);
    const route = await createDeliveryRoute(ctx, { storeId: f.storeId, name: "Διαδρομή integration", plannedFor: new Date("2026-11-23T10:00:00.000Z"), orderIds: [order.id] });
    const delivery = await deliverWholesaleOrder(ctx, { orderId: order.id, seriesId: await newSeries(f.orgId, "9.3"), stopId: route.stops[0]!.id, deliveredAt: new Date("2026-11-23T11:00:00.000Z"), recipientName: "Παραλήπτης integration", proofNote: "Υπογραφή δοκιμής" });
    assert.equal(delivery.lines.length, 2);
    assert.equal(delivery.lines.find((line) => line.lotId === f.earlyLotId)?.quantityBase, KG);
    assert.equal(delivery.lines.find((line) => line.lotId === f.lateLotId)?.quantityBase, KG);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: f.earlyLotId }), 0);
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: f.lateLotId }), 4 * KG);
    assert.equal((await db.deliveryRoute.findUnique({ where: { id: route.id } }))?.status, "COMPLETED");
    const negativeAfterDelivery = await db.stockMovement.count({ where: { orgId: f.orgId, documentId: delivery.id, quantity: { lt: 0 } } });
    const invoice = await invoiceWholesaleOrder(ctx, { orderId: order.id, seriesId: await newSeries(f.orgId, "1.1"), issuedAt: new Date("2026-11-23T12:00:00.000Z") });
    assert.equal(invoice.lines.length, 2);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, documentId: invoice.id } }), 0);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, documentId: delivery.id, quantity: { lt: 0 } } }), negativeAfterDelivery);
    assert.equal((await invoiceWholesaleOrder(ctx, { orderId: order.id, seriesId: await newSeries(f.orgId, "1.1") })).id, invoice.id);

    let calls = 0;
    const provider: MyDataProvider = { async submit(submission) {
      calls += 1;
      assert.equal(submission.idempotencyKey, (await db.fiscalDocument.findUnique({ where: { id: invoice.fiscalDocumentId! } }))?.receiptReference);
      if (calls === 1) throw new Error("Mock provider timeout");
      return { mark: "TEST-MARK-NOT-REAL", uid: "test-only" };
    } };
    await assert.rejects(transmitSalesDocument(ctx, invoice.id, provider), /Mock provider timeout/);
    assert.equal((await db.fiscalDocument.findUnique({ where: { id: invoice.fiscalDocumentId! } }))?.status, "FAILED");
    await transmitSalesDocument(ctx, invoice.id, provider);
    await transmitSalesDocument(ctx, invoice.id, provider);
    assert.equal(calls, 2);
    assert.equal((await db.fiscalDocument.findUnique({ where: { id: invoice.fiscalDocumentId! } }))?.status, "SIGNED");

    const receiptAccount = await db.financeAccount.create({ data: { orgId: f.orgId, storeId: f.storeId, name: `Εισπράξεις ${randomUUID()}`, kind: "cash", openingAt: new Date("2026-11-23T00:00:00.000Z") } });
    const paymentInput = { clientKey: randomUUID(), customerId: f.customerId, accountId: receiptAccount.id, amountCents: 1000, paidAt: new Date("2026-11-23T13:00:00.000Z"), allocations: [{ documentId: invoice.id, amountCents: 1000 }] };
    const [payment, concurrentReplay] = await Promise.all([recordCustomerPayment(ctx, paymentInput), recordCustomerPayment(ctx, paymentInput)]);
    assert.equal(concurrentReplay.id, payment.id);
    assert.equal((await recordCustomerPayment(ctx, paymentInput)).id, payment.id);
    await assert.rejects(recordCustomerPayment(ctx, { ...paymentInput, reference: "Αλλαγμένο payload" }), /διαφορετικά δεδομένα/);
    assert.equal(await db.customerPayment.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.customerPaymentAllocation.count({ where: { orgId: f.orgId, paymentId: payment.id } }), 1);
    assert.equal(await db.financeTransaction.count({ where: { orgId: f.orgId, referenceType: "customer_payment", referenceId: payment.id } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "payment.customer", entityId: payment.id } }), 1);
    const receiptLedger = await db.financeTransaction.findFirstOrThrow({ where: { orgId: f.orgId, referenceType: "customer_payment", referenceId: payment.id } });
    assert.equal(receiptLedger.storeId, f.storeId);
    await assert.rejects(recordCustomerPayment(ctx, { clientKey: randomUUID(), customerId: f.customerId, amountCents: 2000, paidAt: new Date(), allocations: [{ documentId: invoice.id, amountCents: 2000 }] }), WorkflowError);
    await assert.rejects(recordCustomerPayment(ctx, { clientKey: randomUUID(), customerId: f.otherCustomerId, amountCents: 100, paidAt: new Date(), allocations: [{ documentId: invoice.id, amountCents: 100 }] }), WorkflowError);
    await assert.rejects(creditSalesDocument(ctx, { documentId: invoice.id, seriesId: await newSeries(f.orgId, "5.1"), reason: "Δεν επιτρέπεται με είσπραξη" }), WorkflowError);

    const second = await createWholesaleOrder(ctx, { customerId: f.customerId, storeId: f.storeId, warehouseId: f.warehouseId, lines: [{ genericItemId: f.genericItemId, quantityBase: KG, unitPriceCents: 1000, vatRate: 24 }] });
    await confirmWholesaleOrder(ctx, second.id);
    await deliverWholesaleOrder(ctx, { orderId: second.id, seriesId: await newSeries(f.orgId, "9.3") });
    const secondInvoice = await invoiceWholesaleOrder(ctx, { orderId: second.id, seriesId: await newSeries(f.orgId, "1.1") });
    const balanceBeforeCredit = await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: f.lateLotId });
    const credit = await creditSalesDocument(ctx, { documentId: secondInvoice.id, seriesId: await newSeries(f.orgId, "5.1"), reason: "Επιστροφή integration" });
    assert.equal(credit.docType, "5.1");
    assert.equal(await stockBalance(db, { orgId: f.orgId, warehouseId: f.warehouseId, genericItemId: f.genericItemId, lotId: f.lateLotId }), balanceBeforeCredit + KG);
    await assert.rejects(invoiceWholesaleOrder(ctx, { orderId: second.id, seriesId: await newSeries(f.orgId, "1.1") }), WorkflowError);
  } finally { await cleanup(f); }
});

test("PostgreSQL WSL: B2B customer isolation, idempotent external key και store/warehouse scope", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  try {
    await savePriceList(ctx, { name: `B2B ${randomUUID()}`, validFrom: new Date("2026-01-01T00:00:00.000Z"), customerId: f.customerId, lines: [{ genericItemId: f.genericItemId, unitPriceCents: 1234, vatRate: 13 }] });
    const own = await createB2bAccess(ctx, f.customerId);
    const other = await createB2bAccess(ctx, f.otherCustomerId);
    assert.notEqual(own.token, other.token);
    assert.equal(await db.b2bAccess.count({ where: { orgId: f.orgId, tokenHash: own.token } }), 0);
    const input = { storeId: f.storeId, warehouseId: f.warehouseId, externalKey: `external-${randomUUID()}`, lines: [{ genericItemId: f.genericItemId, quantityBase: KG }] };
    const order = await createB2bOrder(own.token, input);
    assert.equal((await db.wholesaleOrderLine.findFirstOrThrow({ where: { orgId: f.orgId, orderId: order.id } })).unitPriceCents, 1234);
    assert.equal(order.totalCents, 1394);
    assert.equal((await createB2bOrder(own.token, input)).id, order.id);
    await assert.rejects(createB2bOrder(other.token, input), WorkflowError);
    await assert.rejects(createB2bOrder(own.token, { ...input, externalKey: `other-${randomUUID()}`, storeId: f.otherStoreId }), WorkflowError);
    await assert.rejects(createB2bOrder(other.token, { ...input, externalKey: `other-${randomUUID()}` }), /ενεργή τιμή/);
    await assert.rejects(createWholesaleOrder(context(f, true), { customerId: f.customerId, storeId: f.otherStoreId, warehouseId: f.otherWarehouseId, lines: [{ genericItemId: f.genericItemId, quantityBase: KG, unitPriceCents: 100, vatRate: 24 }] }), (error: unknown) => {
      assert.ok(error instanceof WorkflowError);
      return true;
    });
    await assert.rejects(savePriceList(context(f, true), { name: "Απαγορευμένος καθολικός", validFrom: new Date(), lines: [{ genericItemId: f.genericItemId, unitPriceCents: 1, vatRate: 24 }] }), (error: unknown) => {
      assert.ok(error instanceof StockScopeError);
      assert.equal(error.code, "GLOBAL_SCOPE_NOT_ALLOWED");
      return true;
    });
    assert.equal(await db.wholesaleOrder.count({ where: { orgId: f.orgId } }), 1);
  } finally { await cleanup(f); }
});
