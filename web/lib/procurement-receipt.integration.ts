import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { receivePurchaseOrder, reviewPurchaseReceipt } from "./procurement-db.ts";
import type { StockContext } from "./stock-scope.ts";
import { WorkflowError } from "./workflow-db.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL, timeout: 120_000 };
const KG = 1_000_000;

type Fixture = {
  orgId: string;
  userId: string;
  orderId: string;
  orderLineId: string;
  unitId: string;
  ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `PROC-RECEIPT ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const user = await tx.user.create({ data: { email: `proc-receipt-${suffix}@example.test`, name: "Παραλαβή integration" } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη παραλαβής integration" } });
    const supplier = await tx.party.create({ data: { orgId: org.id, name: "Προμηθευτής παραλαβής integration", roles: ["supplier"], vatNumber: `S-${suffix}` } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα παραλαβής integration", baseUnitId: unit.id } });
    // Πραγματική posted αγορά 9 €/kg: η νέα παραλαβή στα 10 €/kg έχει δομημένη ασυμφωνία.
    const trade = await tx.tradeItem.create({ data: { orgId: org.id, name: "Γάλα προηγούμενης αγοράς", contentQty: KG, contentUnitId: unit.id } });
    const supplierItem = await tx.supplierItem.create({ data: { orgId: org.id, supplierId: supplier.id, tradeItemId: trade.id, packQty: 1 } });
    const previousDoc = await tx.purchaseDoc.create({ data: {
      orgId: org.id, supplierId: supplier.id, warehouseId: warehouse.id, kind: "INVOICE", status: "POSTED",
      number: `ΠΡΟΗΓ-${suffix}`, issuedAt: new Date("2026-11-20T00:00:00.000Z"), createdByName: user.name ?? "Παραλαβή integration",
    } });
    await tx.purchaseLine.create({ data: {
      orgId: org.id, documentId: previousDoc.id, description: generic.name, quantity: 1, unitPriceCents: 900,
      discountBps: 0, vatRate: 24, supplierItemId: supplierItem.id, tradeItemId: trade.id, genericItemId: generic.id,
    } });
    const order = await tx.purchaseOrder.create({
      data: {
        orgId: org.id,
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        number: `ΠΠ-TEST-${suffix}`,
        status: "SENT",
        netCents: 3000,
        vatCents: 720,
        totalCents: 3720,
        createdByName: user.name ?? "Παραλαβή integration",
        lines: { create: [{ orgId: org.id, genericItemId: generic.id, orderedBaseQty: 3 * KG, unitPriceCents: 1000, vatRate: 24 }] },
      },
      include: { lines: true },
    });
    return { orgId: org.id, userId: user.id, orderId: order.id, orderLineId: order.lines[0]!.id, unitId: unit.id, ownsUnit: !existingUnit };
  });
}

function context(f: Fixture): StockContext {
  return {
    orgId: f.orgId,
    membershipId: "unrestricted-procurement-receipt-integration",
    userId: f.userId,
    userName: "Παραλαβή integration",
    permissions: ["orders.edit"],
    storeIds: [],
    warehouseIds: [],
    can: (permission) => permission === "orders.edit",
  };
}

function input(f: Fixture, clientKey: string, quantityBase = KG) {
  return { orderId: f.orderId, clientKey, lines: [{ orderLineId: f.orderLineId, quantityBase, batchNumber: `LOT-${f.orderId}` }] };
}

async function cleanup(f: Fixture) {
  await db.stockMovement.deleteMany({ where: { orgId: f.orgId } });
  await db.purchaseReceipt.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

async function assertSinglePostedReceipt(f: Fixture, receiptId: string) {
  const [receipts, receiptLines, docs, movements, orderLine, discrepancies, receiveAudits, reviewAudits] = await Promise.all([
    db.purchaseReceipt.findMany({ where: { orgId: f.orgId } }),
    db.purchaseReceiptLine.count({ where: { orgId: f.orgId } }),
    db.purchaseDoc.findMany({ where: { orgId: f.orgId, kind: "RECEIPT" }, select: { status: true, kind: true } }),
    db.stockMovement.findMany({ where: { orgId: f.orgId, source: "purchase" }, select: { quantity: true } }),
    db.purchaseOrderLine.findUnique({ where: { id: f.orderLineId }, select: { receivedBaseQty: true } }),
    db.purchaseReceiptDiscrepancy.findMany({ where: { orgId: f.orgId }, select: { basis: true, kind: true, expectedPriceCents: true, actualPriceCents: true } }),
    db.auditEvent.count({ where: { orgId: f.orgId, action: "order.receive", entityId: receiptId } }),
    db.auditEvent.count({ where: { orgId: f.orgId, action: "order.receipt.review", entityId: receiptId } }),
  ]);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.id, receiptId);
  assert.equal(receipts[0]!.reviewStatus, "PROVISIONAL");
  assert.equal(receiptLines, 1);
  assert.deepEqual(docs, [{ status: "POSTED", kind: "RECEIPT" }]);
  assert.deepEqual(movements, [{ quantity: KG }]);
  assert.equal(orderLine?.receivedBaseQty, KG);
  assert.deepEqual(discrepancies, [{ basis: "PREVIOUS_PURCHASE", kind: "PRICE_INCREASE", expectedPriceCents: 900, actualPriceCents: 1000 }]);
  assert.equal(receiveAudits, 1);
  assert.equal(reviewAudits, 0);
}

test("PostgreSQL procurement receipt: replay και απόρριψη mismatched key χωρίς δεύτερη εγγραφή", databaseOptions, async () => {
  const f = await fixture();
  try {
    const clientKey = randomUUID();
    const first = await receivePurchaseOrder(context(f), input(f, clientKey));
    const replay = await receivePurchaseOrder(context(f), input(f, clientKey));
    assert.equal(replay.id, first.id);
    await assertSinglePostedReceipt(f, first.id);
    await assert.rejects(reviewPurchaseReceipt(context(f), { receiptId: first.id }), /απαιτεί αιτιολογία/);
    await assertSinglePostedReceipt(f, first.id);

    await assert.rejects(receivePurchaseOrder(context(f), input(f, clientKey, KG / 2)), (error: unknown) => {
      assert.ok(error instanceof WorkflowError);
      assert.match(error.message, /διαφορετικά δεδομένα/);
      return true;
    });
    await assertSinglePostedReceipt(f, first.id);
  } finally {
    await cleanup(f);
  }
});

test("PostgreSQL procurement receipt: concurrent ίδιο request συγκλίνει στο committed receipt", databaseOptions, async () => {
  const f = await fixture();
  try {
    const request = input(f, randomUUID());
    const results = await Promise.all([
      receivePurchaseOrder(context(f), request),
      receivePurchaseOrder(context(f), request),
    ]);
    assert.equal(results[0]!.id, results[1]!.id);
    await assertSinglePostedReceipt(f, results[0]!.id);
  } finally {
    await cleanup(f);
  }
});
