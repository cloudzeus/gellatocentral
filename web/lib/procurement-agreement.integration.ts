import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { createPurchaseOrder, markPurchaseOrderSent, receivePurchaseOrder } from "./procurement-db.ts";
import type { StockContext } from "./stock-scope.ts";
import { WorkflowError } from "./workflow-db.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL, timeout: 120_000 };
const KG = 1_000_000;

type Fixture = {
  orgId: string;
  foreignOrgId: string;
  userId: string;
  warehouseId: string;
  supplierId: string;
  otherSupplierId: string;
  genericItemId: string;
  otherGenericItemId: string;
  supplierItemId: string;
  foreignSupplierItemId: string;
  unitId: string;
  ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const now = Date.now();
    const org = await tx.organization.create({ data: { name: `PROC-AGREEMENT ${suffix}`, vatNumber: `TEST-${suffix}` } });
    const foreignOrg = await tx.organization.create({ data: { name: `PROC-AGREEMENT-FOREIGN ${suffix}`, vatNumber: `TEST-F-${suffix}` } });
    const user = await tx.user.create({ data: { email: `proc-agreement-${suffix}@example.test`, name: "Συμφωνία integration" } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη συμφωνίας integration" } });
    const supplier = await tx.party.create({ data: { orgId: org.id, name: "Προμηθευτής συμφωνίας integration", roles: ["supplier"], vatNumber: `S-${suffix}` } });
    const otherSupplier = await tx.party.create({ data: { orgId: org.id, name: "Άλλος προμηθευτής integration", roles: ["supplier"], vatNumber: `S2-${suffix}` } });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-mg-${suffix}`, nameEL: "χιλιοστόγραμμο δοκιμής", dimension: "mass", toBase: 1 } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Γάλα συμφωνίας integration", baseUnitId: unit.id } });
    const otherGeneric = await tx.genericItem.create({ data: { orgId: org.id, name: "Άλλο γενικό είδος integration", baseUnitId: unit.id } });
    const trade = await tx.tradeItem.create({ data: { orgId: org.id, name: "Γάλα 0,5 kg integration", contentQty: KG / 2, contentUnitId: unit.id } });
    await tx.itemMapping.create({ data: { orgId: org.id, genericItemId: generic.id, tradeItemId: trade.id } });
    const supplierItem = await tx.supplierItem.create({ data: { orgId: org.id, supplierId: supplier.id, tradeItemId: trade.id, packQty: 2 } });
    await tx.supplierItemPrice.create({ data: {
      supplierItemId: supplierItem.id,
      priceCents: 500,
      minPackQty: 2,
      validFrom: new Date(now - 24 * 60 * 60 * 1000),
      validTo: new Date(now + 24 * 60 * 60 * 1000),
      createdByName: user.name,
    } });

    const foreignSupplier = await tx.party.create({ data: { orgId: foreignOrg.id, name: "Ξένος προμηθευτής integration", roles: ["supplier"], vatNumber: `SF-${suffix}` } });
    const foreignGeneric = await tx.genericItem.create({ data: { orgId: foreignOrg.id, name: "Ξένο γάλα integration", baseUnitId: unit.id } });
    const foreignTrade = await tx.tradeItem.create({ data: { orgId: foreignOrg.id, name: "Ξένη συσκευασία integration", contentQty: KG / 2, contentUnitId: unit.id } });
    await tx.itemMapping.create({ data: { orgId: foreignOrg.id, genericItemId: foreignGeneric.id, tradeItemId: foreignTrade.id } });
    const foreignSupplierItem = await tx.supplierItem.create({ data: { orgId: foreignOrg.id, supplierId: foreignSupplier.id, tradeItemId: foreignTrade.id, packQty: 2 } });

    return {
      orgId: org.id,
      foreignOrgId: foreignOrg.id,
      userId: user.id,
      warehouseId: warehouse.id,
      supplierId: supplier.id,
      otherSupplierId: otherSupplier.id,
      genericItemId: generic.id,
      otherGenericItemId: otherGeneric.id,
      supplierItemId: supplierItem.id,
      foreignSupplierItemId: foreignSupplierItem.id,
      unitId: unit.id,
      ownsUnit: !existingUnit,
    };
  });
}

function context(f: Fixture): StockContext {
  return {
    orgId: f.orgId,
    membershipId: "unrestricted-procurement-agreement-integration",
    userId: f.userId,
    userName: "Συμφωνία integration",
    permissions: ["orders.edit"],
    storeIds: [],
    warehouseIds: [],
    can: (permission) => permission === "orders.edit",
  };
}

function orderInput(f: Fixture, unitPriceCents: number, supplierItemId?: string) {
  return {
    supplierId: f.supplierId,
    warehouseId: f.warehouseId,
    lines: [{ genericItemId: f.genericItemId, supplierItemId, quantityBase: 2 * KG, unitPriceCents, vatRate: 24 }],
  };
}

async function receiveFullOrder(f: Fixture, orderId: string, orderLineId: string) {
  await markPurchaseOrderSent(context(f), orderId);
  return receivePurchaseOrder(context(f), {
    orderId,
    clientKey: randomUUID(),
    lines: [{ orderLineId, quantityBase: 2 * KG, batchNumber: `LOT-${randomUUID()}` }],
  });
}

async function cleanup(f: Fixture) {
  const orgIds = [f.orgId, f.foreignOrgId];
  await db.stockMovement.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.purchaseReceipt.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

test("PostgreSQL procurement agreement: αποθήκευση συσκευασίας και έλεγχος ειδικής συμφωνίας", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  try {
    const explicitOrder = await createPurchaseOrder(ctx, orderInput(f, 1100, f.supplierItemId));
    const explicitLine = explicitOrder.lines[0]!;
    assert.equal(explicitLine.supplierItemId, f.supplierItemId);
    assert.equal(explicitLine.packQty, 2);
    const explicitReceipt = await receiveFullOrder(f, explicitOrder.id, explicitLine.id);
    const discrepancies = await db.purchaseReceiptDiscrepancy.findMany({
      where: { orgId: f.orgId, receiptId: explicitReceipt.id },
      select: { basis: true, kind: true, expectedPriceCents: true, actualPriceCents: true },
    });
    assert.deepEqual(discrepancies, [{ basis: "AGREEMENT", kind: "AGREEMENT_MISMATCH", expectedPriceCents: 500, actualPriceCents: 550 }]);

    const fallbackOrder = await createPurchaseOrder(ctx, orderInput(f, 1000));
    const fallbackLine = fallbackOrder.lines[0]!;
    assert.equal(fallbackLine.supplierItemId, f.supplierItemId);
    assert.equal(fallbackLine.packQty, 2);
    const fallbackReceipt = await receiveFullOrder(f, fallbackOrder.id, fallbackLine.id);
    assert.equal(await db.purchaseReceiptDiscrepancy.count({ where: { orgId: f.orgId, receiptId: fallbackReceipt.id } }), 0);

    await assert.rejects(createPurchaseOrder(ctx, orderInput(f, 1000, f.foreignSupplierItemId)), WorkflowError);
    await assert.rejects(createPurchaseOrder(ctx, { ...orderInput(f, 1000, f.supplierItemId), supplierId: f.otherSupplierId }), WorkflowError);
    await assert.rejects(createPurchaseOrder(ctx, {
      supplierId: f.supplierId,
      warehouseId: f.warehouseId,
      lines: [{ genericItemId: f.otherGenericItemId, supplierItemId: f.supplierItemId, quantityBase: 2 * KG, unitPriceCents: 1000, vatRate: 24 }],
    }), WorkflowError);
  } finally {
    await cleanup(f);
  }
});
