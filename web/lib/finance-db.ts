// Οικονομικά: κάθε εγγραφή είναι tenant-scoped, αιτιολογημένη και χωρίς έμμεση δεύτερη απόσυρση αποθέματος.
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { athensBusinessRange, expectedCashCents, paymentBucket, purchaseTotals } from "./finance";
import { assertGlobalStockScope, assertStockScope, type StockContext } from "./stock-scope";
import { stockTransaction } from "./stock-transaction";
import { assertNonNegativeInt, assertParty, assertPositiveInt, auditWorkflow, cleanText, WorkflowError } from "./workflow-db";

type Tx = Prisma.TransactionClient;
const actor = (ctx: StockContext) => ({ id: ctx.userId, name: ctx.userName });
function validDate(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new WorkflowError(`Άκυρη ${label}`);
  return value;
}
function validShift(value: string) {
  const shift = cleanText(value, "Βάρδια", 30, true)!.toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(shift)) throw new WorkflowError("Η βάρδια δέχεται μόνο λατινικά γράμματα, αριθμούς, παύλα ή κάτω παύλα");
  return shift;
}
async function ownedAccount(tx: Tx, ctx: StockContext, accountId: string, forWrite = true) {
  const account = await tx.financeAccount.findFirst({ where: { id: accountId, orgId: ctx.orgId, ...(forWrite ? { active: true } : {}) } });
  if (!account) throw new WorkflowError("Ο χρηματοοικονομικός λογαριασμός δεν βρέθηκε ή είναι ανενεργός");
  if (!account.storeId) assertGlobalStockScope(ctx);
  await assertStockScope(tx, ctx, { storeId: account.storeId ?? undefined, forWrite });
  return account;
}
async function duplicateAccount(tx: Tx, orgId: string, name: string) {
  if (await tx.financeAccount.findFirst({ where: { orgId, name }, select: { id: true } })) throw new WorkflowError("Υπάρχει ήδη λογαριασμός με αυτό το όνομα");
}

export async function createFinanceAccount(ctx: StockContext, input: { name: string; kind?: string; storeId?: string | null; openingBalanceCents?: number; openingAt: Date }) {
  const name = cleanText(input.name, "Όνομα λογαριασμού", 100, true)!;
  const kind = cleanText(input.kind, "Είδος", 30) ?? "bank";
  if (!["bank", "cash", "card_clearing", "platform", "other"].includes(kind)) throw new WorkflowError("Άκυρο είδος λογαριασμού");
  if (!Number.isSafeInteger(input.openingBalanceCents ?? 0)) throw new WorkflowError("Το αρχικό υπόλοιπο πρέπει να είναι ακέραια λεπτά");
  validDate(input.openingAt, "ημερομηνία αρχικού υπολοίπου");
  return stockTransaction(async (tx) => {
    if (!input.storeId) assertGlobalStockScope(ctx);
    await assertStockScope(tx, ctx, { storeId: input.storeId ?? undefined, forWrite: true });
    await duplicateAccount(tx, ctx.orgId, name);
    const account = await tx.financeAccount.create({ data: { orgId: ctx.orgId, storeId: input.storeId ?? null, name, kind, openingBalanceCents: input.openingBalanceCents ?? 0, openingAt: input.openingAt } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "finance.account.create", entityType: "finance_account", entityId: account.id, storeId: account.storeId, metadata: { kind, openingBalanceCents: account.openingBalanceCents } });
    return account;
  });
}

export async function transferFinanceFunds(ctx: StockContext, input: { sourceAccountId: string; destinationAccountId: string; amountCents: number; occurredAt: Date; note?: string | null }) {
  assertPositiveInt(input.amountCents, "Ποσό μεταφοράς");
  validDate(input.occurredAt, "ημερομηνία μεταφοράς");
  if (input.sourceAccountId === input.destinationAccountId) throw new WorkflowError("Η προέλευση και ο προορισμός πρέπει να διαφέρουν");
  return stockTransaction(async (tx) => {
    const [source, destination] = await Promise.all([ownedAccount(tx, ctx, input.sourceAccountId), ownedAccount(tx, ctx, input.destinationAccountId)]);
    const transferId = randomUUID();
    const note = cleanText(input.note, "Σημείωση", 500);
    const transactions = await Promise.all([
      tx.financeTransaction.create({ data: { orgId: ctx.orgId, accountId: source.id, storeId: source.storeId, amountCents: -input.amountCents, kind: "transfer_out", referenceType: "transfer", referenceId: transferId, transferId, occurredAt: input.occurredAt, note, createdByName: ctx.userName } }),
      tx.financeTransaction.create({ data: { orgId: ctx.orgId, accountId: destination.id, storeId: destination.storeId, amountCents: input.amountCents, kind: "transfer_in", referenceType: "transfer", referenceId: transferId, transferId, occurredAt: input.occurredAt, note, createdByName: ctx.userName } }),
    ]);
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "finance.transfer", entityType: "finance_transfer", entityId: transferId, storeId: source.storeId, metadata: { sourceAccountId: source.id, destinationAccountId: destination.id, destinationStoreId: destination.storeId, amountCents: input.amountCents } });
    return { transferId, transactions };
  });
}

export async function createExpense(ctx: StockContext, input: { storeId?: string | null; supplierId?: string | null; accountId?: string | null; category: string; documentNumber?: string | null; netCents: number; vatRate: number; informal?: boolean; occurredAt: Date; note?: string | null }) {
  const category = cleanText(input.category, "Κατηγορία", 80, true)!;
  const documentNumber = cleanText(input.documentNumber, "Αριθμός παραστατικού", 100);
  assertNonNegativeInt(input.netCents, "Καθαρή αξία");
  assertNonNegativeInt(input.vatRate, "ΦΠΑ", 100);
  validDate(input.occurredAt, "ημερομηνία εξόδου");
  const vatCents = Math.round(input.netCents * input.vatRate / 100);
  const totalCents = input.netCents + vatCents;
  if (!Number.isSafeInteger(totalCents)) throw new WorkflowError("Το σύνολο εξόδου υπερβαίνει το επιτρεπτό όριο");
  return stockTransaction(async (tx) => {
    if (!input.storeId) assertGlobalStockScope(ctx);
    await assertStockScope(tx, ctx, { storeId: input.storeId ?? undefined, forWrite: true });
    if (input.supplierId) await assertParty(tx, ctx.orgId, input.supplierId, "supplier");
    if (input.supplierId && documentNumber && await tx.expense.findFirst({ where: { orgId: ctx.orgId, supplierId: input.supplierId, documentNumber }, select: { id: true } })) throw new WorkflowError("Το παραστατικό εξόδου έχει ήδη καταχωρηθεί για τον προμηθευτή");
    const account = input.accountId ? await ownedAccount(tx, ctx, input.accountId) : null;
    if (account?.storeId && input.storeId && account.storeId !== input.storeId) throw new WorkflowError("Ο λογαριασμός πληρωμής ανήκει σε άλλο κατάστημα");
    if (account?.storeId && !input.storeId) throw new WorkflowError("Το έξοδο καταστήματος απαιτεί κατάστημα");
    const expense = await tx.expense.create({ data: { orgId: ctx.orgId, storeId: input.storeId ?? null, supplierId: input.supplierId ?? null, category, documentNumber, netCents: input.netCents, vatRate: input.vatRate, vatCents, totalCents, informal: input.informal ?? false, occurredAt: input.occurredAt, note: cleanText(input.note, "Σημείωση", 500), createdByName: ctx.userName } });
    if (account) await tx.financeTransaction.create({ data: { orgId: ctx.orgId, accountId: account.id, storeId: account.storeId ?? input.storeId ?? null, amountCents: -totalCents, kind: "expense", referenceType: "expense", referenceId: expense.id, occurredAt: input.occurredAt, note: cleanText(input.note, "Σημείωση", 500), createdByName: ctx.userName } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "finance.expense.create", entityType: "expense", entityId: expense.id, storeId: expense.storeId, metadata: { supplierId: expense.supplierId, accountId: account?.id ?? null, totalCents } });
    return expense;
  });
}

export type SupplierPaymentInput = { clientKey: string; supplierId: string; accountId?: string | null; amountCents: number; paidAt: Date; reference?: string | null; informal?: boolean; note?: string | null; allocations: { purchaseDocId: string; amountCents: number }[] };
export type CanonicalSupplierPaymentRequest = { clientKey: string; supplierId: string; accountId: string | null; amountCents: number; paidAt: Date; reference: string | null; informal: boolean; note: string | null; allocations: { purchaseDocId: string; amountCents: number }[] };

/** Κανονικοποιημένο payload με σταθερή σειρά allocations για ασφαλές replay και concurrency recovery. */
export function canonicalSupplierPaymentRequest(input: SupplierPaymentInput): CanonicalSupplierPaymentRequest {
  const clientKey = cleanText(input.clientKey, "Κλειδί πληρωμής", 100, true)!;
  if (!/^[-_a-zA-Z0-9]{8,100}$/.test(clientKey)) throw new WorkflowError("Άκυρο κλειδί πληρωμής");
  const supplierId = cleanText(input.supplierId, "Προμηθευτής", 100, true)!;
  const accountId = cleanText(input.accountId, "Λογαριασμός", 100);
  assertPositiveInt(input.amountCents, "Ποσό πληρωμής");
  validDate(input.paidAt, "ημερομηνία πληρωμής");
  const allocations = input.allocations.map((row) => ({
    purchaseDocId: cleanText(row.purchaseDocId, "Τιμολόγιο αγοράς", 100, true)!,
    amountCents: assertPositiveInt(row.amountCents, "Αντιστοίχιση πληρωμής"),
  })).sort((a, b) => a.purchaseDocId < b.purchaseDocId ? -1 : a.purchaseDocId > b.purchaseDocId ? 1 : 0);
  if (new Set(allocations.map((row) => row.purchaseDocId)).size !== allocations.length) throw new WorkflowError("Κάθε τιμολόγιο αγοράς επιτρέπεται μία φορά");
  const allocated = allocations.reduce((sum, row) => sum + row.amountCents, 0);
  if (!Number.isSafeInteger(allocated) || allocated > input.amountCents) throw new WorkflowError("Οι αντιστοιχίσεις υπερβαίνουν το ποσό πληρωμής");
  return { clientKey, supplierId, accountId, amountCents: input.amountCents, paidAt: input.paidAt, reference: cleanText(input.reference, "Αναφορά", 100), informal: input.informal ?? false, note: cleanText(input.note, "Σημείωση", 500), allocations };
}

export function supplierPaymentRequestHash(orgId: string, request: CanonicalSupplierPaymentRequest) {
  return createHash("sha256").update(JSON.stringify({
    version: 1, orgId, supplierId: request.supplierId, accountId: request.accountId,
    amountCents: request.amountCents, paidAt: request.paidAt.toISOString(), reference: request.reference,
    informal: request.informal, note: request.note, allocations: request.allocations,
  })).digest("hex");
}

function isUniqueConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && current.code === "P2002") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

async function existingSupplierPayment(tx: Pick<Tx, "supplierPayment">, orgId: string, request: CanonicalSupplierPaymentRequest, requestHash: string) {
  const existing = await tx.supplierPayment.findUnique({ where: { orgId_clientKey: { orgId, clientKey: request.clientKey } } });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new WorkflowError("Το κλειδί πληρωμής χρησιμοποιήθηκε με διαφορετικά δεδομένα");
  return existing;
}

export async function recordSupplierPayment(ctx: StockContext, input: SupplierPaymentInput) {
  const request = canonicalSupplierPaymentRequest(input);
  const requestHash = supplierPaymentRequestHash(ctx.orgId, request);
  const allocated = request.allocations.reduce((sum, row) => sum + row.amountCents, 0);
  try {
    return await stockTransaction(async (tx) => {
      // Όλες οι πληρωμές του ίδιου προμηθευτή κλειδώνουν μαζί, ώστε τα ανεξόφλητα να ελέγχονται ατομικά.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-payment:${ctx.orgId}:${request.supplierId}`}, 0))) AS lock`;
      await assertParty(tx, ctx.orgId, request.supplierId, "supplier");
      const account = request.accountId ? await ownedAccount(tx, ctx, request.accountId) : null;
      const documents = [];
      for (const allocation of request.allocations) {
        const document = await tx.purchaseDoc.findFirst({ where: { id: allocation.purchaseDocId, orgId: ctx.orgId, supplierId: request.supplierId, kind: "INVOICE", status: "POSTED" }, include: { lines: true } });
        if (!document) throw new WorkflowError("Το τιμολόγιο αγοράς δεν βρέθηκε, δεν είναι οριστικοποιημένο ή ανήκει σε άλλο προμηθευτή");
        await assertStockScope(tx, ctx, { storeId: account?.storeId ?? undefined, warehouseId: document.warehouseId, forWrite: true });
        documents.push({ allocation, document });
      }
      // Η ίδια υποβολή επιστρέφεται χωρίς νέο allocation, ledger εγγραφή ή audit.
      const replay = await existingSupplierPayment(tx, ctx.orgId, request, requestHash);
      if (replay) return replay;
      for (const { allocation, document } of documents) {
        // διαφορά με το myDATA χωρίς απόφαση: πρώτα ξεκαθαρίζει τι οφείλουμε (mockup mydata-check.html)
        if (await tx.mydataCheck.findFirst({ where: { orgId: ctx.orgId, purchaseDocId: document.id, status: "DIFF", resolution: null }, select: { id: true } })) throw new WorkflowError(`Το τιμολόγιο ${document.number ?? ""} έχει διαφορά με το myDATA χωρίς απόφαση. Άνοιξέ το και διάλεξε ποια στοιχεία ισχύουν πριν το πληρώσεις`.replace("  ", " "));
        const totals = purchaseTotals(document, document.lines);
        const previous = await tx.supplierPaymentAllocation.aggregate({ where: { orgId: ctx.orgId, purchaseDocId: document.id }, _sum: { amountCents: true } });
        if (allocation.amountCents > totals.totalCents - document.creditCents - (previous._sum.amountCents ?? 0)) throw new WorkflowError("Η αντιστοίχιση υπερβαίνει το απλήρωτο τιμολόγιο αγοράς");
      }
      const payment = await tx.supplierPayment.create({ data: {
        orgId: ctx.orgId, supplierId: request.supplierId, accountId: account?.id ?? null, amountCents: request.amountCents, paidAt: request.paidAt,
        reference: request.reference, informal: request.informal, note: request.note, clientKey: request.clientKey, requestHash, createdByName: ctx.userName,
        allocations: { create: request.allocations.map((row) => ({ orgId: ctx.orgId, purchaseDocId: row.purchaseDocId, amountCents: row.amountCents })) },
      } });
      if (account) await tx.financeTransaction.create({ data: { orgId: ctx.orgId, accountId: account.id, storeId: account.storeId, amountCents: -request.amountCents, kind: "supplier_payment", referenceType: "supplier_payment", referenceId: payment.id, occurredAt: request.paidAt, note: request.note, createdByName: ctx.userName } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "payment.supplier", entityType: "supplier_payment", entityId: payment.id, storeId: account?.storeId, metadata: { supplierId: request.supplierId, amountCents: request.amountCents, allocations: request.allocations.length, unappliedCents: request.amountCents - allocated } });
      return payment;
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      // Σε concurrent create το aborted transaction ακυρώνεται· διαβάζουμε μόνο το συγκεκριμένο tenant/key.
      const { db } = await import("./db");
      const replay = await existingSupplierPayment(db, ctx.orgId, request, requestHash);
      if (replay) return replay;
    }
    throw error;
  }
}

async function cashSummary(tx: Tx, ctx: StockContext, input: { storeId: string; businessDate: Date; openingCashCents: number; actualCashCents: number; commissionCents: number; cashAccountId?: string | null }) {
  if (!Number.isSafeInteger(input.openingCashCents) || !Number.isSafeInteger(input.actualCashCents)) throw new WorkflowError("Τα μετρητά πρέπει να είναι ακέραια λεπτά");
  assertNonNegativeInt(input.commissionCents, "Προμήθεια");
  validDate(input.businessDate, "ημερομηνία ταμείου");
  const range = athensBusinessRange(input.businessDate);
  const sales = await tx.sale.findMany({ where: { orgId: ctx.orgId, storeId: input.storeId, status: "COMPLETED", issuedAt: { gte: range.fromAt, lt: range.toAt }, payment: { is: { success: true } } }, select: { id: true, payment: { select: { amountCents: true, method: { select: { code: true, ledgerKind: true } } } }, shares: { where: { status: "PAID" }, select: { amountCents: true, method: { select: { code: true, ledgerKind: true } } } } } });
  const buckets = { cash: 0, card: 0, platform: 0, credit: 0 };
  for (const sale of sales) {
    if (!sale.payment) continue;
    // μοίρασμα κατά ποσό: τα μερίδια που εισπράχθηκαν πριν από την απόδειξη, το καθένα στον τρόπο του
    for (const p of [sale.payment, ...sale.shares]) {
      const bucket = paymentBucket(p.method);
      buckets[bucket] += p.amountCents;
      if (!Number.isSafeInteger(buckets[bucket])) throw new WorkflowError("Το άθροισμα πωλήσεων υπερβαίνει το επιτρεπτό όριο");
    }
  }
  let payoutsCents = 0;
  if (input.cashAccountId) {
    const account = await ownedAccount(tx, ctx, input.cashAccountId);
    if (account.kind !== "cash" || account.storeId !== input.storeId) throw new WorkflowError("Επίλεξε ταμειακό λογαριασμό του ίδιου καταστήματος");
    const payouts = await tx.financeTransaction.aggregate({ where: { orgId: ctx.orgId, accountId: account.id, amountCents: { lt: 0 }, transferId: null, occurredAt: { gte: range.fromAt, lt: range.toAt } }, _sum: { amountCents: true } });
    payoutsCents = -(payouts._sum.amountCents ?? 0);
  }
  return { range, salesCount: sales.length, cashSalesCents: buckets.cash, cardCents: buckets.card, platformCents: buckets.platform, creditCents: buckets.credit, payoutsCents, expectedCashCents: expectedCashCents(input.openingCashCents, buckets.cash, payoutsCents) };
}

export async function closeCashRegister(ctx: StockContext, input: { storeId: string; businessDate: Date; shift?: string; openingCashCents: number; actualCashCents: number; commissionCents?: number; cashAccountId?: string | null }) {
  const shift = validShift(input.shift ?? "DAY");
  return stockTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`cash-closing:${ctx.orgId}:${input.storeId}`}, 0))) AS lock`;
    await assertStockScope(tx, ctx, { storeId: input.storeId, forWrite: true });
    const summary = await cashSummary(tx, ctx, { ...input, commissionCents: input.commissionCents ?? 0 });
    const businessDate = new Date(`${input.businessDate.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" })}T00:00:00.000Z`);
    const previous = await tx.cashClosing.findUnique({ where: { orgId_storeId_businessDate_shift: { orgId: ctx.orgId, storeId: input.storeId, businessDate, shift } } });
    if (previous?.status === "CLOSED") throw new WorkflowError("Το ταμείο έχει ήδη κλείσει· απαιτείται ελεγχόμενο επανοίγμα");
    const values = { openingCashCents: input.openingCashCents, expectedCashCents: summary.expectedCashCents, actualCashCents: input.actualCashCents, cardCents: summary.cardCents, platformCents: summary.platformCents, payoutsCents: summary.payoutsCents, commissionCents: input.commissionCents ?? 0, status: "CLOSED" as const, reopenedReason: null, reopenedAt: null, closedByName: ctx.userName, closedAt: new Date() };
    const closing = previous ? await tx.cashClosing.update({ where: { id: previous.id }, data: values }) : await tx.cashClosing.create({ data: { orgId: ctx.orgId, storeId: input.storeId, businessDate, shift, ...values } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "finance.cash.close", entityType: "cash_closing", entityId: closing.id, storeId: closing.storeId, metadata: { businessDate: businessDate.toISOString().slice(0, 10), shift, fromAt: summary.range.fromAt.toISOString(), toAt: summary.range.toAt.toISOString(), salesCount: summary.salesCount, cashSalesCents: summary.cashSalesCents, cardCents: summary.cardCents, platformCents: summary.platformCents, creditCents: summary.creditCents, payoutsCents: summary.payoutsCents, expectedCashCents: summary.expectedCashCents, differenceCents: input.actualCashCents - summary.expectedCashCents } });
    return { ...closing, cashSalesCents: summary.cashSalesCents, creditCents: summary.creditCents, salesCount: summary.salesCount };
  });
}

export async function reopenCashRegister(ctx: StockContext, closingId: string, reason: string) {
  if (!ctx.can("finance.reopen")) throw new WorkflowError("Δεν έχεις δικαίωμα επανοιγματος ταμείου");
  const cleanReason = cleanText(reason, "Αιτιολογία επανοιγματος", 300, true)!;
  return stockTransaction(async (tx) => {
    const closing = await tx.cashClosing.findFirst({ where: { id: closingId, orgId: ctx.orgId } });
    if (!closing) throw new WorkflowError("Το κλείσιμο ταμείου δεν βρέθηκε");
    await assertStockScope(tx, ctx, { storeId: closing.storeId, forWrite: true });
    if (closing.status !== "CLOSED") throw new WorkflowError("Το ταμείο είναι ήδη ανοιχτό προς διόρθωση");
    const updated = await tx.cashClosing.update({ where: { id: closing.id }, data: { status: "REOPENED", reopenedReason: cleanReason, reopenedAt: new Date() } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "finance.cash.reopen", entityType: "cash_closing", entityId: closing.id, storeId: closing.storeId, reason: cleanReason });
    return updated;
  });
}

export async function saveBudgetTarget(ctx: StockContext, input: { storeId?: string | null; year: number; month: number; salesCents: number; cogsCents: number; payrollCents: number; expenseCents: number }) {
  if (!Number.isSafeInteger(input.year) || input.year < 2000 || input.year > 2200 || !Number.isSafeInteger(input.month) || input.month < 1 || input.month > 12) throw new WorkflowError("Άκυρος μήνας ή έτος προϋπολογισμού");
  for (const [value, label] of [[input.salesCents, "Πωλήσεις"], [input.cogsCents, "Κόστος πωληθέντων"], [input.payrollCents, "Προσωπικό"], [input.expenseCents, "Έξοδα"]] as const) assertNonNegativeInt(value, label);
  return stockTransaction(async (tx) => {
    if (!input.storeId) assertGlobalStockScope(ctx);
    await assertStockScope(tx, ctx, { storeId: input.storeId ?? undefined, forWrite: true });
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`budget:${ctx.orgId}:${input.storeId ?? "all"}:${input.year}:${input.month}`}, 0))) AS lock`;
    const values = { salesCents: input.salesCents, cogsCents: input.cogsCents, payrollCents: input.payrollCents, expenseCents: input.expenseCents };
    const previous = await tx.budgetTarget.findFirst({ where: { orgId: ctx.orgId, storeId: input.storeId ?? null, year: input.year, month: input.month } });
    const target = previous ? await tx.budgetTarget.update({ where: { id: previous.id }, data: values }) : await tx.budgetTarget.create({ data: { orgId: ctx.orgId, storeId: input.storeId ?? null, year: input.year, month: input.month, ...values } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "finance.budget.save", entityType: "budget_target", entityId: target.id, storeId: target.storeId, metadata: { year: input.year, month: input.month, ...values } });
    return target;
  });
}

export async function updateCompanyProfile(ctx: StockContext, input: { name: string; legalName?: string | null; vatNumber: string; taxOffice?: string | null; address?: string | null; city?: string | null; postalCode?: string | null; phone?: string | null; contactEmail?: string | null; emailFromName?: string | null; logoUrl?: string | null; labelExtraText?: string | null }) {
  assertGlobalStockScope(ctx);
  const name = cleanText(input.name, "Όνομα επιχείρησης", 120, true)!;
  const vatNumber = cleanText(input.vatNumber.replace(/\s/g, "").toUpperCase(), "ΑΦΜ", 30, true)!;
  if (!/^[A-Z0-9-]{5,30}$/.test(vatNumber)) throw new WorkflowError("Άκυρη μορφή ΑΦΜ");
  const contactEmail = cleanText(input.contactEmail, "Email επικοινωνίας", 160);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new WorkflowError("Άκυρο email επικοινωνίας");
  const logoUrl = cleanText(input.logoUrl, "Λογότυπο", 500);
  if (logoUrl && !/^https:\/\/\S+$/.test(logoUrl) && !/^\/[^\s]*$/.test(logoUrl)) throw new WorkflowError("Το λογότυπο πρέπει να είναι HTTPS URL ή τοπικό μονοπάτι");
  return stockTransaction(async (tx) => {
    const duplicate = await tx.organization.findFirst({ where: { vatNumber, id: { not: ctx.orgId } }, select: { id: true } });
    if (duplicate) throw new WorkflowError("Το ΑΦΜ χρησιμοποιείται ήδη από άλλη επιχείρηση");
    const organization = await tx.organization.update({ where: { id: ctx.orgId }, data: {
      name, legalName: cleanText(input.legalName, "Επωνυμία", 180), vatNumber, taxOffice: cleanText(input.taxOffice, "ΔΟΥ", 100),
      address: cleanText(input.address, "Διεύθυνση", 200), city: cleanText(input.city, "Πόλη", 100), postalCode: cleanText(input.postalCode, "Τ.Κ.", 20),
      phone: cleanText(input.phone, "Τηλέφωνο", 40), contactEmail, emailFromName: cleanText(input.emailFromName, "Όνομα αποστολέα", 120),
      logoUrl, labelExtraText: cleanText(input.labelExtraText, "Κείμενο ετικέτας", 1000),
    } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "company.profile.update", entityType: "organization", entityId: ctx.orgId, metadata: { fields: ["name", "legalName", "vatNumber", "taxOffice", "address", "city", "postalCode", "phone", "contactEmail", "emailFromName", "logoUrl", "labelExtraText"] } });
    return organization;
  });
}
