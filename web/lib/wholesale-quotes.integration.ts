import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import type { StockContext } from "./stock-scope.ts";
import {
  acceptWholesaleQuote, convertWholesaleQuote, createWholesaleQuote, expireWholesaleQuote,
  rejectWholesaleQuote, sendWholesaleQuote, updateWholesaleQuote,
} from "./wholesale-db.ts";
import { WorkflowError } from "./workflow-db.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };
const KG = 1_000_000;

type Fixture = {
  orgId: string; userId: string; membershipId: string; storeId: string; otherStoreId: string;
  warehouseId: string; otherWarehouseId: string; customerId: string; genericItemId: string;
  unitId: string; ownsUnit: boolean;
};

async function fixture(): Promise<Fixture> {
  return db.$transaction(async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: `WHOLESALE QUOTE integration ${suffix}`, vatNumber: `TEST-Q-${suffix}` } });
    const user = await tx.user.create({ data: { email: `wholesale-quote-${suffix}@example.test`, name: "Υπεύθυνος προσφορών integration" } });
    const role = await tx.orgRole.create({ data: { orgId: org.id, name: "Προσφορές integration", permissions: ["wholesale.read", "wholesale.add", "wholesale.edit"] } });
    const membership = await tx.membership.create({ data: { orgId: org.id, userId: user.id, roleId: role.id } });
    const store = await tx.store.create({ data: { orgId: org.id, name: "Κατάστημα προσφορών integration" } });
    const otherStore = await tx.store.create({ data: { orgId: org.id, name: "Εκτός scope integration" } });
    const warehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη προσφορών integration" } });
    const otherWarehouse = await tx.warehouse.create({ data: { orgId: org.id, name: "Αποθήκη εκτός scope integration" } });
    await tx.storeWarehouse.createMany({ data: [{ storeId: store.id, warehouseId: warehouse.id }, { storeId: otherStore.id, warehouseId: otherWarehouse.id }] });
    const existingUnit = await tx.unit.findFirst({ where: { code: "mg", toBase: 1 } });
    const unit = existingUnit ?? await tx.unit.create({ data: { code: `test-quote-mg-${suffix}`, nameEL: "χιλιοστόγραμμο προσφοράς", dimension: "mass", toBase: 1 } });
    const generic = await tx.genericItem.create({ data: { orgId: org.id, name: "Παγωτό προσφοράς integration", baseUnitId: unit.id } });
    const customer = await tx.party.create({ data: { orgId: org.id, name: "Πελάτης προσφοράς integration", roles: ["customer"], vatNumber: `Q-${suffix}` } });
    return { orgId: org.id, userId: user.id, membershipId: membership.id, storeId: store.id, otherStoreId: otherStore.id, warehouseId: warehouse.id, otherWarehouseId: otherWarehouse.id, customerId: customer.id, genericItemId: generic.id, unitId: unit.id, ownsUnit: !existingUnit };
  });
}

function context(f: Fixture, restricted = false): StockContext {
  return {
    orgId: f.orgId, membershipId: f.membershipId, userId: f.userId, userName: "Υπεύθυνος προσφορών integration",
    permissions: ["wholesale.read", "wholesale.add", "wholesale.edit"],
    storeIds: restricted ? [f.storeId] : [], warehouseIds: restricted ? [f.warehouseId] : [], can: () => true,
  };
}

function input(f: Fixture, unitPriceCents = 1000) {
  return {
    customerId: f.customerId, storeId: f.storeId, warehouseId: f.warehouseId,
    validUntil: new Date(Date.now() + 86_400_000), neededAt: new Date(Date.now() + 172_800_000),
    note: "Προσφορά integration", lines: [{ genericItemId: f.genericItemId, quantityBase: 2 * KG, unitPriceCents, vatRate: 24 }],
  };
}

async function cleanup(f: Fixture) {
  await db.wholesaleQuoteLine.deleteMany({ where: { orgId: f.orgId } });
  await db.wholesaleQuote.deleteMany({ where: { orgId: f.orgId } });
  await db.wholesaleOrderLine.deleteMany({ where: { orgId: f.orgId } });
  await db.wholesaleOrder.deleteMany({ where: { orgId: f.orgId } });
  await db.documentDelivery.deleteMany({ where: { orgId: f.orgId } });
  await db.organization.deleteMany({ where: { id: f.orgId } });
  await db.user.deleteMany({ where: { id: f.userId } });
  if (f.ownsUnit) await db.unit.deleteMany({ where: { id: f.unitId } });
}

test("PostgreSQL WHL-03/WHL-09: snapshots, ιστορικό και concurrent conversion replay χωρίς απόθεμα/τιμολόγηση", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  try {
    const created = await createWholesaleQuote(ctx, input(f, 900));
    const originalNumber = created.number;
    const quote = await updateWholesaleQuote(ctx, created.id, input(f, 1000));
    assert.equal(quote.number, originalNumber);
    assert.equal(quote.netCents, 2000);
    assert.equal(quote.vatCents, 480);
    assert.equal(quote.totalCents, 2480);
    await sendWholesaleQuote(ctx, quote.id);
    await assert.rejects(updateWholesaleQuote(ctx, quote.id, input(f, 1)), /Μόνο πρόχειρη/);
    await db.party.update({ where: { id: f.customerId }, data: { name: "Μετονομασμένος πελάτης" } });
    await db.genericItem.update({ where: { id: f.genericItemId }, data: { name: "Μετονομασμένο είδος" } });
    await acceptWholesaleQuote(ctx, quote.id);
    const [order, concurrentReplay] = await Promise.all([convertWholesaleQuote(ctx, quote.id), convertWholesaleQuote(ctx, quote.id)]);
    assert.equal(concurrentReplay.id, order.id);
    assert.equal((await convertWholesaleQuote(ctx, quote.id)).id, order.id);
    assert.equal(order.status, "DRAFT");
    assert.equal(order.source, "quote");
    assert.equal(order.totalCents, 2480);
    assert.equal(order.lines[0]!.unitPriceCents, 1000);
    assert.equal(order.lines[0]!.vatRate, 24);
    const converted = await db.wholesaleQuote.findUniqueOrThrow({ where: { id: quote.id } });
    assert.equal(converted.number, originalNumber);
    assert.equal(converted.status, "ACCEPTED");
    assert.equal(converted.orderId, order.id);
    assert.ok(converted.convertedAt);
    assert.deepEqual((converted.customerSnapshot as { name?: string }).name, "Πελάτης προσφοράς integration");
    assert.equal((await db.wholesaleQuoteLine.findFirstOrThrow({ where: { quoteId: quote.id } })).description, "Παγωτό προσφοράς integration");
    assert.equal(await db.wholesaleOrder.count({ where: { orgId: f.orgId } }), 1);
    assert.equal(await db.salesDocument.count({ where: { orgId: f.orgId, orderId: order.id } }), 0);
    assert.equal(await db.stockMovement.count({ where: { orgId: f.orgId, documentId: order.id } }), 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, action: "wholesale.quote.convert", entityId: quote.id } }), 1);
  } finally { await cleanup(f); }
});

test("PostgreSQL WHL-03: draft/rejected/expired δεν μετατρέπονται και οι τερματικές καταστάσεις δεν ανατρέπονται", databaseOptions, async () => {
  const f = await fixture();
  const ctx = context(f);
  try {
    const draft = await createWholesaleQuote(ctx, input(f));
    await assert.rejects(convertWholesaleQuote(ctx, draft.id), /Μόνο αποδεκτή/);
    await sendWholesaleQuote(ctx, draft.id);
    await rejectWholesaleQuote(ctx, draft.id, "Δεν συμφωνεί ο πελάτης");
    await assert.rejects(convertWholesaleQuote(ctx, draft.id), WorkflowError);
    await assert.rejects(acceptWholesaleQuote(ctx, draft.id), WorkflowError);
    assert.equal((await db.wholesaleQuote.findUniqueOrThrow({ where: { id: draft.id } })).rejectionReason, "Δεν συμφωνεί ο πελάτης");

    const expired = await createWholesaleQuote(ctx, input(f));
    await sendWholesaleQuote(ctx, expired.id);
    await db.wholesaleQuote.update({ where: { id: expired.id }, data: { validUntil: new Date(Date.now() - 1000) } });
    await assert.rejects(acceptWholesaleQuote(ctx, expired.id), /έχει λήξει/);
    await expireWholesaleQuote(ctx, expired.id);
    assert.equal((await db.wholesaleQuote.findUniqueOrThrow({ where: { id: expired.id } })).status, "EXPIRED");
    await assert.rejects(convertWholesaleQuote(ctx, expired.id), WorkflowError);
  } finally { await cleanup(f); }
});

test("PostgreSQL WHL-03/WHL-09: tenant και store/warehouse isolation σε κάθε mutation", databaseOptions, async () => {
  const own = await fixture();
  const other = await fixture();
  try {
    const quote = await createWholesaleQuote(context(own), input(own));
    await assert.rejects(sendWholesaleQuote(context(other), quote.id), WorkflowError);
    await assert.rejects(updateWholesaleQuote(context(other), quote.id, input(other)), WorkflowError);
    await assert.rejects(convertWholesaleQuote(context(other), quote.id), WorkflowError);
    const otherScope = context({ ...own, storeId: own.otherStoreId, warehouseId: own.otherWarehouseId }, true);
    await assert.rejects(sendWholesaleQuote(otherScope, quote.id), WorkflowError);
    await assert.rejects(updateWholesaleQuote(context(own, true), quote.id, { ...input(own), storeId: own.otherStoreId, warehouseId: own.otherWarehouseId }), WorkflowError);
    await assert.rejects(createWholesaleQuote(context(own), { ...input(own), customerId: other.customerId }), WorkflowError);
    await assert.rejects(createWholesaleQuote(context(own, true), { ...input(own), storeId: own.otherStoreId, warehouseId: own.otherWarehouseId }), WorkflowError);
    assert.equal((await db.wholesaleQuote.findUniqueOrThrow({ where: { id: quote.id } })).status, "DRAFT");
    assert.equal(await db.wholesaleOrder.count({ where: { orgId: own.orgId } }), 0);
    assert.equal(await db.wholesaleOrder.count({ where: { orgId: other.orgId } }), 0);
  } finally { await cleanup(other); await cleanup(own); }
});
