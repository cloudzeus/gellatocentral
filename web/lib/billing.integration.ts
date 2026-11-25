import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { settleCharge } from "./billing.ts";
import { db } from "./db.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };

test("PostgreSQL billing: η εξόφληση ενεργοποιεί τη συνδρομή μία φορά, όσες φορές κι αν κληθεί", databaseOptions, async () => {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `BILL integration ${suffix}`, vatNumber: `BILL-${suffix}` } });
  try {
    const past = new Date(Date.now() - 864e5);
    const periodEnd = new Date(Date.now() + 30 * 864e5);
    const subscription = await db.subscription.create({ data: { orgId: org.id, status: "PAST_DUE", currentPeriodEnd: past } });
    const charge = await db.subscriptionCharge.create({ data: { subscriptionId: subscription.id, periodStart: past, periodEnd, stores: 1, devices: 1, amountCents: 5000 } });

    await Promise.all([settleCharge(charge.id, "tx-1"), settleCharge(charge.id, "tx-2")]);
    await settleCharge(charge.id, "tx-3");

    const after = await db.subscription.findUniqueOrThrow({ where: { id: subscription.id }, include: { charges: true } });
    assert.equal(after.status, "ACTIVE");
    assert.equal(after.currentPeriodEnd.getTime(), periodEnd.getTime());
    assert.ok(after.charges[0].paidAt);
    assert.ok(["tx-1", "tx-2"].includes(after.charges[0].vivaTransactionId!), "μετράει μόνο η πρώτη εξόφληση");
  } finally {
    await db.organization.delete({ where: { id: org.id } });
  }
});
