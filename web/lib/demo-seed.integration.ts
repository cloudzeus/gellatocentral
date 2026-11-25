import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "./db.ts";
import { DEMO_IDS, seedDemoDatabase } from "../prisma/demo-seed.ts";

const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "") : "";
const databaseOptions = { skip: !database.startsWith("gelato_agent_"), timeout: 120_000 };

test("PostgreSQL demo seed: επαναλήψιμο, χωρίς users/sessions/fiscal side effects", databaseOptions, async () => {
  await seedDemoDatabase(db);
  const first = {
    parties: await db.party.count({ where: { orgId: DEMO_IDS.org } }),
    items: await db.genericItem.count({ where: { orgId: DEMO_IDS.org } }),
    lots: await db.stockLot.count({ where: { orgId: DEMO_IDS.org } }),
    movements: await db.stockMovement.count({ where: { orgId: DEMO_IDS.org, source: "demo_seed" } }),
    plans: await db.productionPlan.count({ where: { orgId: DEMO_IDS.org } }),
  };
  await seedDemoDatabase(db);
  assert.deepEqual({
    parties: await db.party.count({ where: { orgId: DEMO_IDS.org } }),
    items: await db.genericItem.count({ where: { orgId: DEMO_IDS.org } }),
    lots: await db.stockLot.count({ where: { orgId: DEMO_IDS.org } }),
    movements: await db.stockMovement.count({ where: { orgId: DEMO_IDS.org, source: "demo_seed" } }),
    plans: await db.productionPlan.count({ where: { orgId: DEMO_IDS.org } }),
  }, first);
  assert.deepEqual(first, { parties: 2, items: 4, lots: 3, movements: 3, plans: 1 });
  assert.equal(await db.membership.count({ where: { orgId: DEMO_IDS.org } }), 0);
  assert.equal(await db.fiscalDocument.count({ where: { orgId: DEMO_IDS.org } }), 0);
  assert.equal(await db.salesDocument.count({ where: { orgId: DEMO_IDS.org } }), 0);
  const org = await db.organization.findUniqueOrThrow({ where: { id: DEMO_IDS.org } });
  assert.equal(org.aadeUserId, null);
  assert.equal(org.aadeSubKey, null);
  assert.equal(org.vivaMerchantId, null);
});
