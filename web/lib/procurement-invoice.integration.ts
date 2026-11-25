import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { recordSupplierPayment } from "./finance-db.ts";
import { createInvoiceFromReceipt, receivePurchaseOrder, reversePurchaseReceipt, reviewPurchaseReceipt, reviewReceiptInvoice, type ReceiptInvoiceInput } from "./procurement-db.ts";
import { postPurchase } from "./purchases-db.ts";
import { businessReport } from "./reports-db.ts";
import type { StockContext } from "./stock-scope.ts";
import { WorkflowError } from "./workflow-db.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL, timeout: 120_000 };
const KG = 1_000_000;
const issuedAt = new Date("2026-11-24T00:00:00.000Z");

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `PROC-INVOICE ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const foreign = await tx.organization.create({ data: { name: `PROC-INVOICE foreign ${suffix}`, vatNumber: `FOREIGN-${suffix}` } });
    const user = await tx.user.create({ data: { email: `proc-invoice-${suffix}@example.test`, name: "Τιμολόγιο παραλαβής integration" } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη τιμολογίου παραλαβής" } });
    const otherWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Εκτός scope αποθήκη" } });
    const supplier = await tx.party.create({ data: { orgId: org.id, name: "Προμηθευτής τιμολογίου παραλαβής", roles: ["supplier"], vatNumber: `S-${suffix}` } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-invoice-mg-${suffix}`, nameEL: "χιλιοστόγραμμο τιμολογίου", dimension: "mass", toBase: 1 } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα τιμολογίου παραλαβής", baseUnitId: unit.id } });
    const order = await tx.purchaseOrder.create({ data: {
      orgId: org.id, supplierId: supplier.id, warehouseId: warehouse.id, number: `ΠΠ-INVOICE-${suffix}`, status: "SENT",
      netCents: 1000, vatCents: 240, totalCents: 1240, createdByName: user.name ?? "Τιμολόγιο παραλαβής integration",
      lines: { create: [{ orgId: org.id, genericItemId: generic.id, orderedBaseQty: KG, unitPriceCents: 1000, vatRate: 24 }] },
    }, include: { lines: true } });
    return {
      orgId: org.id, foreignOrgId: foreign.id, userId: user.id, userName: user.name ?? "Τιμολόγιο παραλαβής integration",
      supplierId: supplier.id, warehouseId: warehouse.id, otherWarehouseId: otherWarehouse.id, genericId: generic.id,
      orderId: order.id, orderLineId: order.lines[0]!.id, unitId: unit.id, ownsUnit: !existingUnit,
    };
  });
}

function context(f: Fixture, options: { foreign?: boolean; restricted?: boolean } = {}): StockContext {
  const permissions: StockContext["permissions"] = ["orders.edit", "purchases.edit", "finance.edit", "reports.read"];
  return {
    orgId: options.foreign ? f.foreignOrgId : f.orgId,
    membershipId: options.foreign ? "foreign-procurement-invoice-integration" : "procurement-invoice-integration",
    userId: f.userId, userName: f.userName, permissions,
    storeIds: [], warehouseIds: options.restricted ? [f.otherWarehouseId] : [],
    can: (permission) => permissions.includes(permission),
  };
}

async function receive(f: Fixture, quantityBase = KG) {
  return receivePurchaseOrder(context(f), {
    orderId: f.orderId, clientKey: randomUUID(),
    lines: [{ orderLineId: f.orderLineId, quantityBase, batchNumber: `LOT-${f.orderId}` }],
  });
}

async function reviewedReceipt(f: Fixture, quantityBase = KG) {
  const receipt = await receive(f, quantityBase);
  await reviewPurchaseReceipt(context(f), { receiptId: receipt.id, note: "Έλεγχος παραλαβής πριν από το τιμολόγιο" });
  return receipt;
}

async function invoiceInput(
  f: Fixture,
  receiptId: string,
  options: { number?: string; quantityBase?: number; unitPriceCents?: number; discountBps?: number; vatRate?: number } = {},
): Promise<ReceiptInvoiceInput> {
  const line = await db.purchaseReceiptLine.findFirstOrThrow({ where: { orgId: f.orgId, receiptId } });
  return {
    receiptId,
    number: options.number ?? `ΤΙΜ-${randomUUID()}`,
    issuedAt,
    lines: [{
      receiptLineId: line.id,
      quantityBase: options.quantityBase ?? line.quantityBase,
      unitPriceCents: options.unitPriceCents ?? 1000,
      discountBps: options.discountBps ?? 0,
      vatRate: options.vatRate ?? 24,
    }],
  };
}

async function stockAndCostState(f: Fixture) {
  const [movements, lots, generic, orderLine, supplierPrices] = await Promise.all([
    db.stockMovement.count({ where: { orgId: f.orgId } }),
    db.stockLot.count({ where: { orgId: f.orgId } }),
    db.genericItem.findUniqueOrThrow({ where: { id: f.genericId }, select: { avgCostHundredths: true } }),
    db.purchaseOrderLine.findUniqueOrThrow({ where: { id: f.orderLineId }, select: { receivedBaseQty: true } }),
    db.supplierItemPrice.count({ where: { supplierItem: { orgId: f.orgId } } }),
  ]);
  return { movements, lots, avgCostHundredths: generic.avgCostHundredths, receivedBaseQty: orderLine.receivedBaseQty, supplierPrices };
}

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: { in: [f.orgId, f.foreignOrgId] } } });
  await db.purchaseReceipt.deleteMany({ where: { orgId: { in: [f.orgId, f.foreignOrgId] } } });
  await db.organization.deleteMany({ where: { id: { in: [f.orgId, f.foreignOrgId] } } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

test("PostgreSQL procurement invoice: exact match, replay, πραγματική οφειλή και κανένα stock rewrite", databaseOptions, async () => {
  const f = await fixture();
  try {
    const receipt = await receive(f);
    const before = await stockAndCostState(f);
    const provisionalInput = await invoiceInput(f, receipt.id);
    await assert.rejects(createInvoiceFromReceipt(context(f), { ...provisionalInput, number: "" }), /Αριθμός τιμολογίου/);
    await assert.rejects(createInvoiceFromReceipt(context(f), provisionalInput), /με επιφύλαξη/);
    const reviewed = await reviewPurchaseReceipt(context(f), { receiptId: receipt.id, note: "Οι τιμές ελέγχθηκαν" });
    assert.equal(reviewed.reviewStatus, "REVIEWED");
    assert.equal(reviewed.reviewedByName, f.userName);
    await reviewPurchaseReceipt(context(f), { receiptId: receipt.id, note: "Replay χωρίς δεύτερο audit" });
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "order.receipt.review", entityId: receipt.id } }), 1);

    // Ακόμη και concurrent διαφορετικά submits συγκλίνουν σε ένα μόνο συνδεδεμένο invoice.
    const inputA = await invoiceInput(f, receipt.id, { number: `Α-${randomUUID()}` });
    const inputB = await invoiceInput(f, receipt.id, { number: `Β-${randomUUID()}` });
    const attempts = await Promise.allSettled([
      createInvoiceFromReceipt(context(f), inputA),
      createInvoiceFromReceipt(context(f), inputB),
    ]);
    const successfulIndex = attempts.findIndex((attempt) => attempt.status === "fulfilled");
    assert.ok(successfulIndex >= 0);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
    const successful = attempts[successfulIndex]!;
    assert.ok(successful.status === "fulfilled");
    const invoice = successful.value;
    const winningInput = successfulIndex === 0 ? inputA : inputB;
    assert.equal((await createInvoiceFromReceipt(context(f), winningInput)).id, invoice.id);
    assert.equal(invoice.kind, "INVOICE");
    assert.equal(invoice.status, "POSTED");
    assert.equal(invoice.source, "receipt");
    assert.equal(invoice.warehouseId, f.warehouseId);
    assert.equal(invoice.issuedAt?.toISOString(), issuedAt.toISOString());

    const linked = await db.purchaseReceipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { invoiceDoc: { include: { lines: true } }, invoiceMatches: true } });
    assert.equal(linked.invoiceDocId, invoice.id);
    assert.equal(linked.invoiceMatchStatus, "MATCHED");
    assert.equal(linked.invoiceDoc?.lines.length, 1);
    assert.equal(linked.invoiceDoc?.lines[0]?.quantity, 1);
    assert.equal(linked.invoiceDoc?.lines[0]?.unitPriceCents, 1000);
    assert.equal(linked.invoiceMatches.length, 1);
    assert.equal(linked.invoiceMatches[0]?.orderLineId, f.orderLineId);
    assert.equal(linked.invoiceMatches[0]?.receiptLineId, winningInput.lines[0]!.receiptLineId);
    assert.equal(linked.invoiceMatches[0]?.invoiceLineId, linked.invoiceDoc?.lines[0]?.id);
    assert.equal(linked.invoiceMatches[0]?.quantityBase, KG);
    assert.equal(linked.invoiceMatches[0]?.unitPriceCents, 1000);
    assert.equal(await db.purchaseInvoiceDiscrepancy.count({ where: { orgId: f.orgId, receiptId: receipt.id } }), 0);
    assert.deepEqual(await stockAndCostState(f), before);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, documentId: invoice.id } }), 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "purchase.receipt.invoice", entityId: invoice.id } }), 1);

    await assert.rejects(createInvoiceFromReceipt(context(f), inputA.number === winningInput.number ? inputB : inputA), /διαφορετικά δεδομένα/);
    await assert.rejects(reversePurchaseReceipt(context(f), receipt.id, "Απαγορευμένη αναίρεση μετά τιμολόγιο"), /συνδεδεμένο τιμολόγιο/);
    assert.equal(await db.purchaseDoc.count({ where: { orgId: f.orgId, kind: "INVOICE" } }), 1);
    assert.deepEqual(await stockAndCostState(f), before);

    const report = await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24" });
    assert.equal(report.purchases.netCents, 1000);
    assert.equal(report.purchases.vatCents, 240);
    assert.equal(report.vat.purchaseCents, 240);
    assert.deepEqual(report.purchases.rows.map((row) => row.id), [invoice.id]);
    assert.equal(report.suppliers.find((row) => row.id === f.supplierId)?.outstandingCents, 1240);

    await assert.rejects(recordSupplierPayment(context(f), {
      clientKey: randomUUID(), supplierId: f.supplierId, amountCents: 1240, paidAt: issuedAt,
      allocations: [{ purchaseDocId: receipt.purchaseDocId, amountCents: 1240 }],
    }), /Το τιμολόγιο αγοράς δεν βρέθηκε/);
    await recordSupplierPayment(context(f), {
      clientKey: randomUUID(), supplierId: f.supplierId, amountCents: 1240, paidAt: issuedAt,
      allocations: [{ purchaseDocId: invoice.id, amountCents: 1240 }],
    });
    const paidReport = await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24" });
    assert.equal(paidReport.suppliers.length, 0);
    assert.deepEqual(await stockAndCostState(f), before);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL procurement invoice: price mismatch απαιτεί αιτιολογία και η οφειλή ακολουθεί το πραγματικό invoice", databaseOptions, async () => {
  const f = await fixture();
  try {
    const receipt = await reviewedReceipt(f);
    const before = await stockAndCostState(f);
    const input = await invoiceInput(f, receipt.id, { unitPriceCents: 1100 });
    const invoice = await createInvoiceFromReceipt(context(f), input);
    assert.equal(invoice.status, "DRAFT");
    const discrepancies = await db.purchaseInvoiceDiscrepancy.findMany({ where: { orgId: f.orgId, receiptId: receipt.id } });
    assert.deepEqual(discrepancies.map((row) => ({ basis: row.basis, kind: row.kind, expected: row.expectedUnitPriceCents, actual: row.actualUnitPriceCents })), [{ basis: "ORDER", kind: "PRICE_MISMATCH", expected: 1000, actual: 1100 }]);
    await assert.rejects(postPurchase(context(f), invoice.id), /τριπλού ελέγχου/);
    await assert.rejects(reviewReceiptInvoice(context(f), { receiptId: receipt.id }), /αιτιολογία/);
    assert.equal((await db.purchaseDoc.findUniqueOrThrow({ where: { id: invoice.id } })).status, "DRAFT");
    assert.equal((await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24" })).purchases.netCents, 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "purchase.receipt.invoice.review", entityId: invoice.id } }), 0);

    const reviewed = await reviewReceiptInvoice(context(f), { receiptId: receipt.id, note: "Εγκρίθηκε έκδοση πιστωτικού για τη διαφορά" });
    assert.equal(reviewed.status, "POSTED");
    assert.equal((await reviewReceiptInvoice(context(f), { receiptId: receipt.id, note: "Replay" })).id, invoice.id);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "purchase.receipt.invoice.review", entityId: invoice.id } }), 1);
    assert.equal((await db.purchaseReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).invoiceMatchStatus, "REVIEWED");
    const report = await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24" });
    assert.equal(report.purchases.netCents, 1100);
    assert.equal(report.purchases.vatCents, 264);
    assert.equal(report.suppliers[0]?.outstandingCents, 1364);
    await recordSupplierPayment(context(f), { clientKey: randomUUID(), supplierId: f.supplierId, amountCents: 1364, paidAt: issuedAt, allocations: [{ purchaseDocId: invoice.id, amountCents: 1364 }] });
    assert.equal((await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24" })).suppliers.length, 0);
    assert.deepEqual(await stockAndCostState(f), before);
    await assert.rejects(reversePurchaseReceipt(context(f), receipt.id, "Κλειδωμένη αναίρεση"), /συνδεδεμένο τιμολόγιο/);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL procurement invoice: quantity mismatch και πραγματικά financial totals χωρίς αλλαγή παραλαβής", databaseOptions, async () => {
  const f = await fixture();
  try {
    const receipt = await reviewedReceipt(f);
    const before = await stockAndCostState(f);
    const invoice = await createInvoiceFromReceipt(context(f), await invoiceInput(f, receipt.id, { quantityBase: KG / 2 }));
    assert.equal(invoice.status, "DRAFT");
    const discrepancy = await db.purchaseInvoiceDiscrepancy.findFirstOrThrow({ where: { orgId: f.orgId, receiptId: receipt.id, kind: "QUANTITY_MISMATCH" } });
    assert.equal(discrepancy.expectedQuantityBase, KG);
    assert.equal(discrepancy.actualQuantityBase, KG / 2);
    assert.equal(await db.purchaseInvoiceDiscrepancy.count({ where: { orgId: f.orgId, receiptId: receipt.id } }), 1);
    await reviewReceiptInvoice(context(f), { receiptId: receipt.id, note: "Το τιμολόγιο αφορά μισή ποσότητα· εγκρίθηκε λογιστικά" });
    const report = await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24" });
    assert.equal(report.purchases.netCents, 500);
    assert.equal(report.purchases.vatCents, 120);
    assert.equal(report.suppliers[0]?.outstandingCents, 620);
    assert.deepEqual(await stockAndCostState(f), before);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL procurement invoice: combined quantity/price/VAT discrepancies", databaseOptions, async () => {
  const f = await fixture();
  try {
    const receipt = await reviewedReceipt(f);
    const before = await stockAndCostState(f);
    const invoice = await createInvoiceFromReceipt(context(f), await invoiceInput(f, receipt.id, { quantityBase: KG / 2, unitPriceCents: 1100, vatRate: 13 }));
    const discrepancies = await db.purchaseInvoiceDiscrepancy.findMany({ where: { orgId: f.orgId, receiptId: receipt.id }, orderBy: { kind: "asc" } });
    assert.deepEqual(discrepancies.map((row) => row.kind), ["PRICE_MISMATCH", "QUANTITY_MISMATCH", "VAT_MISMATCH"]);
    await reviewReceiptInvoice(context(f), { receiptId: receipt.id, note: "Επαληθεύτηκε το πρωτότυπο και εγκρίθηκαν και οι τρεις διαφορές" });
    const report = await businessReport(context(f), { from: "2026-11-24", to: "2026-11-24" });
    assert.equal(report.purchases.netCents, 550);
    assert.equal(report.purchases.vatCents, 72);
    assert.equal(report.suppliers[0]?.outstandingCents, 622);
    assert.equal(invoice.status, "DRAFT");
    assert.deepEqual(await stockAndCostState(f), before);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL procurement invoice: μερική παραλαβή είναι νόμιμη και ταυτοποιείται με τη δική της ποσότητα", databaseOptions, async () => {
  const f = await fixture();
  try {
    const receipt = await reviewedReceipt(f, KG / 2);
    const before = await stockAndCostState(f);
    const invoice = await createInvoiceFromReceipt(context(f), await invoiceInput(f, receipt.id));
    assert.equal(invoice.status, "POSTED");
    const linked = await db.purchaseReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
    assert.equal(linked.invoiceMatchStatus, "MATCHED");
    assert.equal(await db.purchaseInvoiceDiscrepancy.count({ where: { orgId: f.orgId, receiptId: receipt.id } }), 0);
    assert.deepEqual(await stockAndCostState(f), before);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL procurement invoice: invalid/foreign/duplicate/missing lines, tenant/warehouse scope και αναίρεση πριν από τιμολόγιο", databaseOptions, async () => {
  const f = await fixture();
  try {
    const receipt = await reviewedReceipt(f);
    const exact = await invoiceInput(f, receipt.id);
    await assert.rejects(createInvoiceFromReceipt(context(f), { ...exact, lines: [...exact.lines, ...exact.lines] }), /μία φορά/);
    await assert.rejects(createInvoiceFromReceipt(context(f), { ...exact, lines: [] }), /1–200 γραμμές/);
    await assert.rejects(createInvoiceFromReceipt(context(f), { ...exact, lines: [{ ...exact.lines[0]!, receiptLineId: randomUUID() }] }), /ξένη ή μη υπαρκτή/);
    await assert.rejects(createInvoiceFromReceipt(context(f), { ...exact, lines: [{ ...exact.lines[0]!, quantityBase: 0 }] }), /Ποσότητα τιμολογίου/);
    await assert.rejects(createInvoiceFromReceipt(context(f, { foreign: true }), exact), /Η παραλαβή δεν βρέθηκε/);
    await assert.rejects(createInvoiceFromReceipt(context(f, { restricted: true }), exact), WorkflowError);
    assert.equal(await db.purchaseDoc.count({ where: { orgId: f.orgId, kind: "INVOICE" } }), 0);

    await reversePurchaseReceipt(context(f), receipt.id, "Διόρθωση πριν από την τιμολόγηση");
    assert.equal((await db.purchaseOrderLine.findUniqueOrThrow({ where: { id: f.orderLineId } })).receivedBaseQty, 0);
    assert.equal(await db.stockMovement.aggregate({ where: { orgId: f.orgId }, _sum: { quantity: true } }).then((row) => row._sum.quantity), 0);
    await assert.rejects(createInvoiceFromReceipt(context(f), exact), /αναιρεμένη παραλαβή/);
    await assert.rejects(reviewReceiptInvoice(context(f), { receiptId: receipt.id, note: "Χωρίς τιμολόγιο" }), /Δεν βρέθηκε συνδεδεμένο τιμολόγιο/);
    assert.equal(await db.purchaseDoc.count({ where: { orgId: f.orgId, kind: "INVOICE" } }), 0);
  } finally {
    await cleanup(f);
  }
});
