import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { decideExpense, ensureExpenseCategories, saveExpenseCategory } from "./expense-categories-db.ts";
import { createExpense } from "./finance-db.ts";
import type { Permission } from "./permissions.ts";
import type { StockContext } from "./stock-scope.ts";

// Ενότητα 6: προεπιλεγμένοι τύποι, χαρακτηρισμός myDATA στη δαπάνη, συνδυασμοί ΑΑΔΕ, έγκριση, απομόνωση.
const databaseOptions = { skip: !process.env.DATABASE_URL, timeout: 120_000 };
const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `EXP ${suffix}`, vatNumber: `EX-${suffix}` } });
  const foreign = await db.organization.create({ data: { name: `EXP foreign ${suffix}`, vatNumber: `EXF-${suffix}` } });
  const users = await Promise.all(["Ταμίας", "Υπεύθυνος"].map((name, i) => db.user.create({ data: { email: `exp-${i}-${suffix}@example.test`, name } })));
  const store = await db.store.create({ data: { orgId: org.id, name: "Κηφισιά" } });
  const account = await db.financeAccount.create({ data: { orgId: org.id, name: "Ταμείο", kind: "cash", openingAt: day("2026-01-01") } });
  const ctx = (userIndex = 0, extra: Permission[] = [], orgId = org.id): StockContext => {
    const permissions: Permission[] = ["finance.read", "finance.edit", "finance.approve", ...extra];
    const u = users[userIndex];
    return { orgId, membershipId: "exp", userId: u.id, userName: u.name!, permissions, storeIds: [], warehouseIds: [], can: (p) => permissions.includes(p) };
  };
  return { org, foreign, users, store, account, ctx };
}
const cleanup = async (f: Awaited<ReturnType<typeof fixture>>) => {
  await db.organization.deleteMany({ where: { id: { in: [f.org.id, f.foreign.id] } } });
  await db.user.deleteMany({ where: { id: { in: f.users.map((u) => u.id) } } });
};
const typeOf = (orgId: string, code: string) => db.expenseCategory.findFirstOrThrow({ where: { orgId, code } });

test("PostgreSQL τύποι εξόδων: 18 προεπιλογές χωρίς διπλά, με κέντρο όπου ορίζεται· ό,τι άλλαξε ο λογιστής μένει", databaseOptions, async () => {
  const f = await fixture();
  try {
    await Promise.all([db.$transaction((tx) => ensureExpenseCategories(tx, f.org.id)), db.$transaction((tx) => ensureExpenseCategories(tx, f.org.id))]);
    assert.equal(await db.expenseCategory.count({ where: { orgId: f.org.id } }), 18);
    const accountant = await typeOf(f.org.id, "E08");
    assert.equal((await db.costCenter.findUniqueOrThrow({ where: { id: accountant.costCenterId! } })).code, "30");
    assert.equal((await typeOf(f.org.id, "E04")).costCenterId, null, "ενέργεια: κέντρο του καταστήματος");

    const energy = await typeOf(f.org.id, "E04");
    await saveExpenseCategory(f.ctx(), { ...energy, id: energy.id, accountCode: "62.00.01", source: "ACCOUNTANT" });
    await db.$transaction((tx) => ensureExpenseCategories(tx, f.org.id));
    const after = await typeOf(f.org.id, "E04");
    assert.deepEqual([after.accountCode, after.source], ["62.00.01", "ACCOUNTANT"]);
    await assert.rejects(saveExpenseCategory(f.ctx(), { ...energy, id: undefined, source: "USER", code: "X1", mydataCategory: "category2_6", mydataType: "E3_585_011" }), /σε κανένα παραστατικό/);
    assert.equal(await db.expenseCategory.count({ where: { orgId: f.foreign.id } }), 0);
  } finally { await cleanup(f); }
});

test("PostgreSQL δαπάνη με τύπο: ρεύμα 1.1 → category2_4/E3_585_011/VAT_361 στο κατάστημα· λιανικές σε 1.1 απορρίπτονται", databaseOptions, async () => {
  const f = await fixture();
  try {
    await db.$transaction((tx) => ensureExpenseCategories(tx, f.org.id));
    const energy = await typeOf(f.org.id, "E04");
    const base = { netCents: 10_000, vatRate: 24, occurredAt: day("2026-11-05") };
    const e = await createExpense(f.ctx(), { ...base, categoryId: energy.id, mydataDocType: "1.1", storeId: f.store.id, documentNumber: "ΔΕΗ-1" });
    assert.deepEqual([e.category, e.mydataCategory, e.mydataType, e.mydataVatType, e.classificationStatus], [energy.name, "category2_4", "E3_585_011", "VAT_361", "SUGGESTED"]);
    assert.equal((await db.costCenter.findUniqueOrThrow({ where: { id: e.costCenterId! } })).storeId, f.store.id);

    // αμοιβή λογιστή χωρίς κατάστημα → κέντρο του τύπου (30)· χωρίς ΦΠΑ → χωρίς τύπο ΦΠΑ (σφάλμα ΑΑΔΕ 316)
    const fee = await createExpense(f.ctx(), { ...base, vatRate: 0, categoryId: (await typeOf(f.org.id, "E08")).id, mydataDocType: "2.1" });
    assert.equal((await db.costCenter.findUniqueOrThrow({ where: { id: fee.costCenterId! } })).code, "30");
    assert.equal(fee.mydataVatType, null);

    const retail = await saveExpenseCategory(f.ctx(), { code: "R1", name: "Αγορές λιανικής", kind: "COGS", mydataCategory: "category2_1", mydataType: "E3_102_002", mydataVatType: "VAT_361", accountCode: null, vatAccountCode: null, costCenterId: null, active: true });
    await assert.rejects(createExpense(f.ctx(), { ...base, categoryId: retail.id, mydataDocType: "1.1" }), /Το E3_102_002 δεν επιτρέπεται σε Τιμολόγιο πώλησης 1.1. Διάλεξε E3_102_001/);
    assert.equal((await createExpense(f.ctx(), { ...base, categoryId: retail.id, mydataDocType: "13.1" })).mydataType, "E3_102_002");
    // ανεπίσημη: χωρίς χαρακτηρισμό και χωρίς έλεγχο
    const informal = await createExpense(f.ctx(), { ...base, categoryId: retail.id, mydataDocType: "1.1", informal: true });
    assert.deepEqual([informal.mydataType, informal.classificationStatus], [null, "NONE"]);
    // περίοδος: και αρχή και τέλος, με σωστή σειρά
    await assert.rejects(createExpense(f.ctx(), { ...base, categoryId: energy.id, periodFrom: day("2026-03-31"), periodTo: day("2026-01-01") }), /πριν αρχίσει/);
    // ξένος τύπος
    await db.$transaction((tx) => ensureExpenseCategories(tx, f.foreign.id));
    await assert.rejects(createExpense(f.ctx(), { ...base, categoryId: (await typeOf(f.foreign.id, "E04")).id }), /δεν βρέθηκε/);
  } finally { await cleanup(f); }
});

test("PostgreSQL έγκριση: 600 € με όριο 500 € περιμένει· όχι με πληρωμή, όχι από τον ίδιο, μία απόφαση", databaseOptions, async () => {
  const f = await fixture();
  try {
    await db.organization.update({ where: { id: f.org.id }, data: { expenseApprovalCents: 50_000 } });
    await db.$transaction((tx) => ensureExpenseCategories(tx, f.org.id));
    const input = { categoryId: (await typeOf(f.org.id, "E11")).id, netCents: 48_388, vatRate: 24, occurredAt: day("2026-11-05") }; // 600,00 €
    await assert.rejects(createExpense(f.ctx(), { ...input, accountId: f.account.id }), /όριο έγκρισης/);
    const e = await createExpense(f.ctx(), input);
    assert.equal(e.status, "PENDING");
    assert.equal(await db.financeTransaction.count({ where: { orgId: f.org.id } }), 0);
    assert.equal((await createExpense(f.ctx(), { ...input, netCents: 10_000 })).status, "APPROVED", "κάτω από το όριο");

    await assert.rejects(decideExpense(f.ctx(0), e.id, true), /καταχώρισες εσύ/);
    await assert.rejects(decideExpense({ ...f.ctx(1), can: () => false }, e.id, true), /δικαίωμα έγκρισης/);
    await assert.rejects(decideExpense(f.ctx(1, [], f.foreign.id), e.id, true), /δεν βρέθηκε/);
    await decideExpense(f.ctx(1), e.id, true);
    const approved = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    assert.deepEqual([approved.status, approved.approvedByName], ["APPROVED", "Υπεύθυνος"]);
    await assert.rejects(decideExpense(f.ctx(1), e.id, false), /δεν περιμένει/);
    // ο διαχειριστής χρηστών εγκρίνει και δική του
    const own = await createExpense(f.ctx(0, ["users.edit"]), input);
    await decideExpense(f.ctx(0, ["users.edit"]), own.id, false);
    assert.equal((await db.expense.findUniqueOrThrow({ where: { id: own.id } })).status, "REJECTED");
  } finally { await cleanup(f); }
});
