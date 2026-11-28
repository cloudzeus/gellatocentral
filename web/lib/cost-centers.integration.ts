import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ensureCostCenters, previewAllocation, saveAllocationRule, saveCostCenter } from "./cost-centers-db.ts";
import { db } from "./db.ts";
import { createExpense } from "./finance-db.ts";
import type { StockContext } from "./stock-scope.ts";

// Ενότητα 5: προεπιλογές χωρίς διπλά, κέντρο ανά κατάστημα, κέντρο στη δαπάνη, κανόνες και κατανομή, απομόνωση.
const databaseOptions = { skip: !process.env.DATABASE_URL, timeout: 120_000 };
const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `CC ${suffix}`, vatNumber: `CC-${suffix}` } });
  const foreign = await db.organization.create({ data: { name: `CC foreign ${suffix}`, vatNumber: `CCF-${suffix}` } });
  const user = await db.user.create({ data: { email: `cc-${suffix}@example.test`, name: "Κέντρα integration" } });
  const stores = [];
  for (const name of ["Κηφισιά", "Γλυφάδα", "Πειραιάς"]) stores.push(await db.store.create({ data: { orgId: org.id, name } }));
  const device = await db.device.create({ data: { orgId: org.id, storeId: stores[0].id, name: "Ταμείο", kind: "POS_ANDROID" } });
  const ctx = (orgId = org.id): StockContext => {
    const permissions: StockContext["permissions"] = ["finance.edit", "finance.read"];
    return { orgId, membershipId: "cc", userId: user.id, userName: user.name, permissions, storeIds: [], warehouseIds: [], can: (p) => permissions.includes(p) };
  };
  return { org, foreign, user, stores, device, ctx };
}
const cleanup = async (f: Awaited<ReturnType<typeof fixture>>) => {
  await db.sale.deleteMany({ where: { orgId: f.org.id } });
  await db.organization.deleteMany({ where: { id: { in: [f.org.id, f.foreign.id] } } });
  await db.user.deleteMany({ where: { id: f.user.id } });
};
const centers = (orgId: string) => db.costCenter.findMany({ where: { orgId }, orderBy: { code: "asc" } });

test("PostgreSQL κέντρα: 5 + ένα ανά κατάστημα, χωρίς διπλά ακόμη και ταυτόχρονα, και νέο κατάστημα → 10.4", databaseOptions, async () => {
  const f = await fixture();
  try {
    await Promise.all([db.$transaction((tx) => ensureCostCenters(tx, f.org.id)), db.$transaction((tx) => ensureCostCenters(tx, f.org.id))]);
    await db.$transaction((tx) => ensureCostCenters(tx, f.org.id));
    const list = await centers(f.org.id);
    assert.deepEqual(list.map((c) => c.code), ["10", "10.1", "10.2", "10.3", "20", "30", "40", "50"]);
    assert.equal(await db.costAllocationRule.count({ where: { orgId: f.org.id } }), 4);
    const parent = list.find((c) => c.code === "10")!;
    assert.ok(list.filter((c) => c.storeId).every((c) => c.parentId === parent.id && c.kind === "STORE"));

    const fourth = await db.store.create({ data: { orgId: f.org.id, name: "Μαρούσι" } });
    await db.$transaction((tx) => ensureCostCenters(tx, f.org.id));
    assert.equal((await db.costCenter.findUniqueOrThrow({ where: { storeId: fourth.id } })).code, "10.4");
    assert.equal(await db.costCenter.count({ where: { orgId: f.foreign.id } }), 0, "η ξένη επιχείρηση δεν αγγίζεται");
  } finally { await cleanup(f); }
});

test("PostgreSQL κέντρα: η δαπάνη παίρνει το κέντρο του καταστήματος ή την έδρα· ξένο κέντρο απορρίπτεται", databaseOptions, async () => {
  const f = await fixture();
  try {
    const base = { category: "Ενοίκιο", netCents: 10_000, vatRate: 24, occurredAt: day("2026-11-01") };
    const hq = await createExpense(f.ctx(), base);
    const store = await createExpense(f.ctx(), { ...base, storeId: f.stores[1].id });
    const byId = new Map((await centers(f.org.id)).map((c) => [c.id, c.code]));
    assert.equal(byId.get(hq.costCenterId!), "30");
    assert.equal(byId.get(store.costCenterId!), "10.2");

    await db.$transaction((tx) => ensureCostCenters(tx, f.foreign.id));
    const alien = (await centers(f.foreign.id))[0];
    await assert.rejects(createExpense(f.ctx(), { ...base, costCenterId: alien.id }), /δεν βρέθηκε/);
  } finally { await cleanup(f); }
});

test("PostgreSQL κέντρα: σταθερά 50/30/20, επικάλυψη, τζίρος και μηδενικός τζίρος, κύκλος, απομόνωση", databaseOptions, async () => {
  const f = await fixture();
  try {
    await db.$transaction((tx) => ensureCostCenters(tx, f.org.id));
    const list = await centers(f.org.id);
    const code = (c: string) => list.find((x) => x.code === c)!;
    const [s1, s2, s3] = ["10.1", "10.2", "10.3"].map(code);
    const shares = [{ costCenterId: s1.id, weight: 5000 }, { costCenterId: s2.id, weight: 3000 }, { costCenterId: s3.id, weight: 2000 }];
    const rule = { sourceId: code("30").id, basis: "FIXED" as const, validFrom: day("2026-07-01"), validTo: null, shares };

    // ο κανόνας του seed (από 1/1, ανοιχτός) επικαλύπτεται
    await assert.rejects(saveAllocationRule(f.ctx(), rule), /ίδια περίοδο/);
    await db.costAllocationRule.updateMany({ where: { sourceId: code("30").id }, data: { validTo: day("2026-06-30") } });
    await saveAllocationRule(f.ctx(), rule);
    const fixed = await previewAllocation(f.org.id, code("30").id, 100_000, day("2026-07-01"), day("2026-08-01"));
    assert.deepEqual(fixed.rows.map((r) => [r.code, r.cents]), [["10.1", 50_000], ["10.2", 30_000], ["10.3", 20_000]]);

    // closeOpen: νέος κανόνας από 1/9 κλείνει τον ανοιχτό στις 31/8· ξανά την ίδια μέρα = αντικατάσταση, όχι διπλός
    await saveAllocationRule(f.ctx(), { ...rule, basis: "EQUAL", shares: [], validFrom: day("2026-09-01"), closeOpen: true });
    await saveAllocationRule(f.ctx(), { ...rule, basis: "REVENUE", shares: [], validFrom: day("2026-09-01"), closeOpen: true });
    const hq = await db.costAllocationRule.findMany({ where: { sourceId: code("30").id }, orderBy: { validFrom: "asc" } });
    assert.deepEqual(hq.map((r) => [r.basis, r.validTo?.toISOString().slice(0, 10) ?? null]), [["REVENUE", "2026-06-30"], ["FIXED", "2026-08-31"], ["REVENUE", null]]);
    assert.equal(hq[2].createdByName, f.user.name);

    // εργαστήριο με τζίρο: μόνο το πρώτο κατάστημα πούλησε → όλο εκεί· τον Ιούνιο κανείς → ισόποσα με προειδοποίηση
    await db.sale.create({ data: { orgId: f.org.id, storeId: f.stores[0].id, deviceId: f.device.id, status: "COMPLETED", totalCents: 4_000, issuedAt: day("2026-07-10") } });
    const revenue = await previewAllocation(f.org.id, code("20").id, 100_001, day("2026-07-01"), day("2026-08-01"));
    assert.deepEqual(revenue.rows.map((r) => [r.code, r.cents]), [["10.1", 100_001], ["10.2", 0], ["10.3", 0]]);
    const empty = await previewAllocation(f.org.id, code("20").id, 100_001, day("2026-06-01"), day("2026-07-01"));
    assert.equal(empty.rows.reduce((t, r) => t + r.cents, 0), 100_001);
    assert.match(empty.warning!, /ισόποσα/);

    // κέντρο καταστήματος δεν παίρνει κανόνα· τα μερίδια πάνε μόνο σε καταστήματα
    await assert.rejects(saveAllocationRule(f.ctx(), { ...rule, sourceId: s1.id, validFrom: day("2027-01-01") }), /τελικό/);
    await assert.rejects(saveAllocationRule(f.ctx(), { ...rule, validFrom: day("2027-01-01"), validTo: day("2027-12-31"), shares: [{ costCenterId: code("20").id, weight: 10_000 }] }), /μόνο σε κέντρα καταστημάτων/);

    // «Καταστήματα» κάτω από το «Κηφισιά» → κύκλος
    await assert.rejects(saveCostCenter(f.ctx(), { id: code("10").id, code: "10", name: "Καταστήματα", kind: "STORE", parentId: s1.id, accountCode: null }), /εαυτό του/);
    // ξένη επιχείρηση
    await assert.rejects(saveAllocationRule(f.ctx(f.foreign.id), { ...rule, validFrom: day("2027-01-01") }), /δεν βρέθηκε/);
    await assert.rejects(previewAllocation(f.foreign.id, code("30").id, 100, day("2026-07-01"), day("2026-08-01")), /κανόνα/);
  } finally { await cleanup(f); }
});
