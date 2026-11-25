import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { closeCashRegister, createExpense, createFinanceAccount, recordSupplierPayment, reopenCashRegister, saveBudgetTarget, transferFinanceFunds, updateCompanyProfile } from "./finance-db.ts";
import type { Permission } from "./permissions.ts";
import { StockScopeError, type StockContext } from "./stock-scope.ts";
import { WorkflowError } from "./workflow-db.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `FIN integration ${suffix}`, vatNumber: `TEST-${suffix}`, aadeUserId: "private-test-user", aadeSubKey: "private-test-key", vivaMerchantId: "private-viva" } });
  const foreign = await db.organization.create({ data: { name: `FIN foreign ${suffix}`, vatNumber: `FOREIGN-${suffix}` } });
  const user = await db.user.create({ data: { email: `finance-${suffix}@example.test`, name: "Οικονομικά integration" } });
  const role = await db.orgRole.create({ data: { orgId: org.id, name: "Οικονομικά integration", permissions: ["finance.read", "finance.edit", "finance.reopen", "users.edit"] } });
  const membership = await db.membership.create({ data: { orgId: org.id, userId: user.id, roleId: role.id } });
  const store = await db.store.create({ data: { orgId: org.id, name: "Κατάστημα FIN integration" } });
  const otherStore = await db.store.create({ data: { orgId: org.id, name: "Άλλο κατάστημα FIN" } });
  const warehouse = await db.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη FIN integration" } });
  await db.storeWarehouse.create({ data: { storeId: store.id, warehouseId: warehouse.id } });
  await db.membershipStore.create({ data: { membershipId: membership.id, storeId: store.id } });
  const supplier = await db.party.create({ data: { orgId: org.id, name: "Προμηθευτής FIN integration", roles: ["supplier"] } });
  const foreignSupplier = await db.party.create({ data: { orgId: foreign.id, name: "Ξένος προμηθευτής FIN", roles: ["supplier"] } });
  const purchase = await db.purchaseDoc.create({ data: {
    orgId: org.id, supplierId: supplier.id, warehouseId: warehouse.id, status: "POSTED", number: `Α-${suffix}`, createdByName: "FIN integration", shippingCostCents: 100, otherExpensesCents: 50, expensesVatRate: 24,
    lines: { create: [{ orgId: org.id, description: "Υλικό integration", quantity: 2, unitPriceCents: 1000, discountBps: 1000, vatRate: 24 }] },
  }, include: { lines: true } });
  const receipt = await db.purchaseDoc.create({ data: {
    orgId: org.id, supplierId: supplier.id, warehouseId: warehouse.id, kind: "RECEIPT", source: "order", status: "POSTED", number: `ΠΑΡ-${suffix}`, createdByName: "FIN integration",
    lines: { create: [{ orgId: org.id, description: "Παραλαβή χωρίς οφειλή", quantity: 1, unitPriceCents: 5000, vatRate: 24 }] },
  } });
  const device = await db.device.create({ data: { orgId: org.id, storeId: store.id, name: "POS FIN integration", kind: "POS_WEB" } });
  const otherDevice = await db.device.create({ data: { orgId: org.id, storeId: otherStore.id, name: "POS other FIN integration", kind: "POS_WEB" } });
  const methods = {} as Record<"cash" | "card" | "platform" | "credit", { id: string }>;
  for (const [key, ledgerKind] of [["cash", "CASH"], ["card", "CARD_CLEARING"], ["platform", "BANK"], ["credit", "CREDIT"]] as const) {
    methods[key] = await db.paymentMethod.create({ data: { code: `${key}-${suffix}`, name: `${key} integration`, provider: "MANUAL", ledgerKind } });
  }
  return { orgId: org.id, foreignOrgId: foreign.id, userId: user.id, membershipId: membership.id, storeId: store.id, otherStoreId: otherStore.id, warehouseId: warehouse.id, supplierId: supplier.id, foreignSupplierId: foreignSupplier.id, purchaseId: purchase.id, receiptId: receipt.id, deviceId: device.id, otherDeviceId: otherDevice.id, methods };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture, reopen = true, restricted = false): StockContext {
  const permissions: Permission[] = ["finance.read", "finance.edit", "users.edit", ...(reopen ? ["finance.reopen" as const] : [])];
  return { orgId: f.orgId, userId: f.userId, membershipId: f.membershipId, userName: "Οικονομικά integration", permissions, storeIds: restricted ? [f.storeId] : [], warehouseIds: [], can: (permission) => permissions.includes(permission) };
}
async function sale(f: Fixture, method: "cash" | "card" | "platform" | "credit", amountCents: number, success = true, otherStore = false) {
  return db.sale.create({ data: {
    orgId: f.orgId, storeId: otherStore ? f.otherStoreId : f.storeId, deviceId: otherStore ? f.otherDeviceId : f.deviceId,
    status: "COMPLETED", totalCents: amountCents, issuedAt: new Date("2026-11-24T10:00:00.000Z"), series: `FIN-${randomUUID()}`, aa: 1,
    payment: { create: { methodId: f.methods[method].id, amountCents, success } },
  } });
}
async function cleanup(f: Fixture) {
  await db.organization.deleteMany({ where: { id: { in: [f.orgId, f.foreignOrgId] } } });
  await db.user.deleteMany({ where: { id: f.userId } });
  await db.paymentMethod.deleteMany({ where: { id: { in: Object.values(f.methods).map((method) => method.id) } } });
}

test("PostgreSQL FIN: accounts, transfers, expenses, supplier payments, cash close, budgets και tenant/RBAC", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  const noReopen = context(f, false);
  const restricted = context(f, true, true);
  try {
    const bank = await createFinanceAccount(ctx, { name: `Τράπεζα ${randomUUID()}`, kind: "bank", openingBalanceCents: 50_000, openingAt: new Date("2026-11-24T00:00:00.000Z") });
    const cash = await createFinanceAccount(ctx, { name: `Ταμείο ${randomUUID()}`, kind: "cash", storeId: f.storeId, openingBalanceCents: 10_000, openingAt: new Date("2026-11-24T00:00:00.000Z") });
    await assert.rejects(createFinanceAccount(restricted, { name: "Απαγορευμένος καθολικός", openingAt: new Date() }), StockScopeError);
    await assert.rejects(transferFinanceFunds(ctx, { sourceAccountId: cash.id, destinationAccountId: cash.id, amountCents: 100, occurredAt: new Date() }), WorkflowError);
    const transfer = await transferFinanceFunds(ctx, { sourceAccountId: cash.id, destinationAccountId: bank.id, amountCents: 500, occurredAt: new Date("2026-11-24T09:00:00.000Z"), note: "Εσωτερική κατάθεση" });
    assert.equal(transfer.transactions.length, 2);
    assert.equal(transfer.transactions.reduce((sum, row) => sum + row.amountCents, 0), 0);

    const expense = await createExpense(ctx, { storeId: f.storeId, supplierId: f.supplierId, accountId: cash.id, category: "utilities", documentNumber: `Ε-${randomUUID()}`, netCents: 1200, vatRate: 24, occurredAt: new Date("2026-11-24T09:30:00.000Z") });
    assert.equal(expense.totalCents, 1488);
    await assert.rejects(createExpense(ctx, { storeId: f.storeId, supplierId: f.supplierId, category: "utilities", documentNumber: expense.documentNumber, netCents: 1200, vatRate: 24, occurredAt: new Date() }), /ήδη καταχωρηθεί/);
    await assert.rejects(createExpense(ctx, { supplierId: f.foreignSupplierId, category: "foreign", netCents: 100, vatRate: 24, occurredAt: new Date() }), WorkflowError);

    const paymentAccount = await createFinanceAccount(ctx, { name: `Πληρωμές ${randomUUID()}`, kind: "cash", storeId: f.storeId, openingAt: new Date("2026-11-24T00:00:00.000Z") });
    await assert.rejects(recordSupplierPayment(ctx, { clientKey: randomUUID(), supplierId: f.supplierId, amountCents: 100, paidAt: new Date(), allocations: [{ purchaseDocId: f.receiptId, amountCents: 100 }] }), /Το τιμολόγιο αγοράς δεν βρέθηκε/);
    assert.equal(await db.supplierPayment.count({ where: { orgId: f.orgId } }), 0);
    const paymentInput = { clientKey: randomUUID(), supplierId: f.supplierId, accountId: paymentAccount.id, amountCents: 1500, paidAt: new Date("2026-11-24T11:00:00.000Z"), allocations: [{ purchaseDocId: f.purchaseId, amountCents: 1000 }] };
    const [payment, concurrentReplay] = await Promise.all([recordSupplierPayment(ctx, paymentInput), recordSupplierPayment(ctx, paymentInput)]);
    assert.equal(payment.amountCents, 1500);
    assert.equal(concurrentReplay.id, payment.id);
    assert.equal((await recordSupplierPayment(ctx, paymentInput)).id, payment.id);
    await assert.rejects(recordSupplierPayment(ctx, { ...paymentInput, note: "Αλλαγμένο payload" }), /διαφορετικά δεδομένα/);
    assert.equal(await db.supplierPayment.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.supplierPaymentAllocation.count({ where: { orgId: f.orgId, paymentId: payment.id } }), 1);
    assert.equal(await db.financeTransaction.count({ where: { orgId: f.orgId, referenceType: "supplier_payment", referenceId: payment.id } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "payment.supplier", entityId: payment.id } }), 1);
    const paymentLedger = await db.financeTransaction.findFirstOrThrow({ where: { orgId: f.orgId, referenceType: "supplier_payment", referenceId: payment.id } });
    assert.equal(paymentLedger.storeId, f.storeId);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId } }), 0);
    await assert.rejects(recordSupplierPayment(ctx, { clientKey: randomUUID(), supplierId: f.supplierId, amountCents: 2000, paidAt: new Date(), allocations: [{ purchaseDocId: f.purchaseId, amountCents: 2000 }] }), /ανεξόφλητο/);
    await assert.rejects(recordSupplierPayment(ctx, { clientKey: randomUUID(), supplierId: f.supplierId, amountCents: 100, paidAt: new Date(), allocations: [{ purchaseDocId: f.purchaseId, amountCents: 50 }, { purchaseDocId: f.purchaseId, amountCents: 50 }] }), /μία φορά/);

    await sale(f, "cash", 5000);
    await sale(f, "card", 3000);
    await sale(f, "platform", 2000);
    await sale(f, "credit", 700);
    await sale(f, "cash", 999, false);
    await sale(f, "cash", 888, true, true);
    const closing = await closeCashRegister(ctx, { storeId: f.storeId, businessDate: new Date("2026-11-24T00:00:00.000Z"), openingCashCents: 10_000, actualCashCents: 13_500, commissionCents: 40, cashAccountId: cash.id });
    assert.equal(closing.cashSalesCents, 5000);
    assert.equal(closing.cardCents, 3000);
    assert.equal(closing.platformCents, 2000);
    assert.equal(closing.creditCents, 700);
    assert.equal(closing.payoutsCents, 1488);
    assert.equal(closing.expectedCashCents, 13_512);
    assert.equal(closing.salesCount, 4);
    await assert.rejects(closeCashRegister(ctx, { storeId: f.storeId, businessDate: new Date("2026-11-24T00:00:00.000Z"), openingCashCents: 10_000, actualCashCents: 13_500, cashAccountId: cash.id }), /ήδη κλείσει/);
    await assert.rejects(reopenCashRegister(noReopen, closing.id, "Χωρίς δικαίωμα"), WorkflowError);
    assert.equal((await reopenCashRegister(ctx, closing.id, "Διόρθωση καταμέτρησης integration")).status, "REOPENED");

    const target = await saveBudgetTarget(ctx, { storeId: f.storeId, year: 2026, month: 11, salesCents: 100_000, cogsCents: 30_000, payrollCents: 20_000, expenseCents: 10_000 });
    const updated = await saveBudgetTarget(ctx, { storeId: f.storeId, year: 2026, month: 11, salesCents: 120_000, cogsCents: 30_000, payrollCents: 20_000, expenseCents: 10_000 });
    assert.equal(updated.id, target.id);
    assert.equal(updated.salesCents, 120_000);
    await assert.rejects(saveBudgetTarget(restricted, { year: 2026, month: 11, salesCents: 1, cogsCents: 0, payrollCents: 0, expenseCents: 0 }), StockScopeError);
    await assert.rejects(saveBudgetTarget(restricted, { storeId: f.otherStoreId, year: 2026, month: 11, salesCents: 1, cogsCents: 0, payrollCents: 0, expenseCents: 0 }), StockScopeError);

    const company = await updateCompanyProfile(ctx, { name: "FIN νέα επωνυμία", legalName: "FIN ΕΠΕ", vatNumber: `NEW-${randomUUID().slice(0, 12)}`, taxOffice: "ΔΟΥ δοκιμής", address: "Οδός 1", city: "Αθήνα", postalCode: "10000", phone: "2100000000", contactEmail: "finance@example.test", logoUrl: "https://example.test/logo.png", labelExtraText: "Δοκιμαστική ετικέτα" });
    assert.equal(company.legalName, "FIN ΕΠΕ");
    assert.equal(company.aadeUserId, "private-test-user");
    assert.equal(company.aadeSubKey, "private-test-key");
    assert.equal(company.vivaMerchantId, "private-viva");
    assert.notEqual((await db.organization.findUnique({ where: { id: f.foreignOrgId } }))?.name, company.name);
    await assert.rejects(updateCompanyProfile(restricted, { name: "Απαγορευμένο", vatNumber: "123456789" }), StockScopeError);
    assert.ok(await db.auditEvent.count({ where: { orgId: f.orgId, action: "finance.cash.reopen" } }));
  } finally { await cleanup(f); }
});
