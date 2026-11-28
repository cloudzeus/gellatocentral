// Τύποι εξόδων στη βάση (ενότητα 6): προεπιλογές demo, αλλαγές από λογιστή ή χρήστη, έγκριση δαπανών.
import { ensureCostCenters } from "./cost-centers-db";
import { db } from "./db";
import { allowedTypes, CATEGORY_LABEL, DEFAULT_EXPENSE_TYPES, DOC_TYPES, KINDS } from "./expense-rules";
import type { Prisma } from "./generated/prisma/client";
import type { StockContext } from "./stock-scope";
import { auditWorkflow, cleanText, WorkflowError } from "./workflow-db";

type Tx = Prisma.TransactionClient;
const lock = (tx: Tx, orgId: string) => tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`expense-types:${orgId}`}, 0))) AS lock`;

/** Φτιάχνει όσους προεπιλεγμένους τύπους λείπουν (με τον κωδικό τους), χωρίς να πειράζει ό,τι άλλαξε ο λογιστής. */
export async function ensureExpenseCategories(tx: Tx, orgId: string) {
  await lock(tx, orgId);
  const have = new Set((await tx.expenseCategory.findMany({ where: { orgId }, select: { code: true } })).map((c) => c.code));
  const missing = DEFAULT_EXPENSE_TYPES.filter((t) => !have.has(t.code));
  if (!missing.length) return;
  await ensureCostCenters(tx, orgId);
  const centerId = new Map((await tx.costCenter.findMany({ where: { orgId, storeId: null }, select: { id: true, code: true } })).map((c) => [c.code, c.id]));
  await tx.expenseCategory.createMany({
    data: missing.map(({ center, ...t }) => ({ ...t, orgId, costCenterId: center ? centerId.get(center) ?? null : null, source: "SEED" })),
    skipDuplicates: true,
  });
}

export async function listExpenseCategories(orgId: string) {
  return db.$transaction(async (tx) => {
    await ensureExpenseCategories(tx, orgId);
    return tx.expenseCategory.findMany({ where: { orgId }, orderBy: { code: "asc" }, include: { costCenter: { select: { code: true, name: true } }, _count: { select: { expenses: true } } } });
  });
}

/** Ο συνδυασμός κατηγορίας και Ε3 πρέπει να επιτρέπεται σε τουλάχιστον ένα παραστατικό που βλέπουμε (1.1, 2.1, 13.1…). */
function assertUsableCombo(category: string | null, type: string | null) {
  if (!category && !type) return;
  if (!category || !type) throw new WorkflowError("Ο χαρακτηρισμός myDATA θέλει και κατηγορία και τύπο Ε3");
  if (!Object.keys(DOC_TYPES).some((doc) => allowedTypes(doc, category).includes(type))) throw new WorkflowError(`Ο τύπος ${type} δεν επιτρέπεται με «${CATEGORY_LABEL[category] ?? category}» σε κανένα παραστατικό`);
}

export type ExpenseCategoryInput = { id?: string; code: string; name: string; kind: string; mydataCategory: string | null; mydataType: string | null; mydataVatType: string | null; accountCode: string | null; vatAccountCode: string | null; costCenterId: string | null; active: boolean; source?: "USER" | "ACCOUNTANT" };

export async function saveExpenseCategory(ctx: StockContext, input: ExpenseCategoryInput) {
  const code = cleanText(input.code, "Κωδικός", 20, true)!;
  const name = cleanText(input.name, "Όνομα", 120, true)!;
  if (!(KINDS as readonly string[]).includes(input.kind)) throw new WorkflowError("Άγνωστο είδος εξόδου");
  assertUsableCombo(input.mydataCategory, input.mydataType);
  if (input.mydataVatType && !/^VAT_36[1-6]$/.test(input.mydataVatType)) throw new WorkflowError("Άγνωστος τύπος ΦΠΑ");
  return db.$transaction(async (tx) => {
    await ensureExpenseCategories(tx, ctx.orgId);
    if (input.costCenterId && !await tx.costCenter.findFirst({ where: { id: input.costCenterId, orgId: ctx.orgId }, select: { id: true } })) throw new WorkflowError("Το κέντρο κόστους δεν βρέθηκε");
    if (await tx.expenseCategory.findFirst({ where: { orgId: ctx.orgId, code, ...(input.id ? { id: { not: input.id } } : {}) }, select: { id: true } })) throw new WorkflowError(`Ο κωδικός ${code} υπάρχει ήδη`);
    const data = {
      code, name, kind: input.kind, mydataCategory: input.mydataCategory, mydataType: input.mydataType, mydataVatType: input.mydataVatType || null,
      accountCode: cleanText(input.accountCode, "Λογαριασμός", 40), vatAccountCode: cleanText(input.vatAccountCode, "Λογαριασμός ΦΠΑ", 40),
      costCenterId: input.costCenterId, active: input.active, source: input.source ?? "USER", // η αλλαγή του λογιστή έχει προτεραιότητα στις επόμενες προεπιλογές
    };
    const saved = input.id
      ? await tx.expenseCategory.update({ where: { id: (await tx.expenseCategory.findFirstOrThrow({ where: { id: input.id, orgId: ctx.orgId }, select: { id: true } })).id }, data })
      : await tx.expenseCategory.create({ data: { ...data, orgId: ctx.orgId } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: input.id ? "finance.expense_type.update" : "finance.expense_type.create", entityType: "expense_category", entityId: saved.id, metadata: { code, mydataType: data.mydataType, accountCode: data.accountCode } });
    return saved;
  });
}

/** Έγκριση ή απόρριψη δαπάνης που περιμένει. Δεν εγκρίνεις δική σου, εκτός αν διαχειρίζεσαι χρήστες (users.edit). */
export async function decideExpense(ctx: StockContext, id: string, approve: boolean) {
  if (!ctx.can("finance.approve")) throw new WorkflowError("Η έγκριση δαπανών θέλει δικαίωμα έγκρισης");
  return db.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true, status: true, createdById: true, storeId: true, totalCents: true } });
    if (!expense) throw new WorkflowError("Η δαπάνη δεν βρέθηκε");
    if (expense.status !== "PENDING") throw new WorkflowError("Η δαπάνη δεν περιμένει έγκριση");
    if (expense.createdById === ctx.userId && !ctx.can("users.edit")) throw new WorkflowError("Δεν εγκρίνεις δαπάνη που καταχώρισες εσύ· τη βλέπει άλλος με δικαίωμα έγκρισης");
    // υπό συνθήκη: δύο ταυτόχρονες αποφάσεις δεν γράφονται και οι δύο
    const { count } = await tx.expense.updateMany({ where: { id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "REJECTED", approvedByName: ctx.userName, approvedAt: new Date() } });
    if (!count) throw new WorkflowError("Η δαπάνη άλλαξε στο μεταξύ· άνοιξέ την ξανά");
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: approve ? "finance.expense.approve" : "finance.expense.reject", entityType: "expense", entityId: id, storeId: expense.storeId, metadata: { totalCents: expense.totalCents } });
  });
}

/** Όριο έγκρισης δαπανών (σύνολο με ΦΠΑ, σε λεπτά)· null = καμία δαπάνη δεν περιμένει έγκριση. */
export async function saveApprovalLimit(ctx: StockContext, cents: number | null) {
  if (!ctx.can("finance.approve")) throw new WorkflowError("Το όριο έγκρισης το αλλάζει όποιος εγκρίνει δαπάνες");
  if (cents != null && (!Number.isInteger(cents) || cents <= 0)) throw new WorkflowError("Το όριο θέλει ποσό μεγαλύτερο από 0, ή κενό για καμία έγκριση");
  await db.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: ctx.orgId }, data: { expenseApprovalCents: cents } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "finance.expense_limit.update", entityType: "organization", entityId: ctx.orgId, metadata: { cents } });
  });
}
