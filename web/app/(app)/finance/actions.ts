"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decideExpense } from "@/lib/expense-categories-db";
import { closeCashRegister, createExpense, createFinanceAccount, recordSupplierPayment, reopenCashRegister, saveBudgetTarget, transferFinanceFunds } from "@/lib/finance-db";
import { requireStockContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";
import { redirectUrl } from "@/lib/flash";

const cents = (value: FormDataEntryValue | null) => Math.round(Number(String(value ?? "0").replace(",", ".")) * 100);
const text = (form: FormData, key: string) => String(form.get(key) ?? "") || null;
const date = (value: FormDataEntryValue | null) => String(value ?? "") ? new Date(String(value)) : new Date(NaN);
const back = (query = ""): never => { revalidatePath("/finance"); redirect(redirectUrl(`/finance${query}`)); };
const fail = (error: unknown): never => back(`?error=${encodeURIComponent(workflowMessage(error))}`);

export async function newAccount(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  try {
    await createFinanceAccount(ctx, { name: String(form.get("name") ?? ""), kind: String(form.get("kind") ?? "bank"), storeId: text(form, "storeId"), openingBalanceCents: cents(form.get("openingBalance")), openingAt: date(form.get("openingAt")) });
    back("?saved=Ο λογαριασμός δημιουργήθηκε");
  } catch (error) { fail(error); }
}

export async function newTransfer(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  try {
    await transferFinanceFunds(ctx, { sourceAccountId: String(form.get("sourceAccountId") ?? ""), destinationAccountId: String(form.get("destinationAccountId") ?? ""), amountCents: cents(form.get("amount")), occurredAt: date(form.get("occurredAt")), note: text(form, "note") });
    back("?saved=Η μεταφορά καταχωρήθηκε");
  } catch (error) { fail(error); }
}

export async function newExpense(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  try {
    const day = (key: string) => (text(form, key) ? new Date(`${text(form, key)}T00:00:00Z`) : null);
    const expense = await createExpense(ctx, { storeId: text(form, "storeId"), costCenterId: text(form, "costCenterId"), supplierId: text(form, "supplierId"), accountId: text(form, "accountId"), categoryId: text(form, "categoryId"), mydataDocType: text(form, "mydataDocType"), documentNumber: text(form, "documentNumber"), netCents: cents(form.get("netAmount")), vatRate: Number(form.get("vatRate") ?? 24), informal: form.get("informal") === "on", occurredAt: date(form.get("occurredAt")), periodFrom: day("periodFrom"), periodTo: day("periodTo"), dueAt: day("dueAt"), fileId: text(form, "fileId"), note: text(form, "note") });
    if (expense.status === "PENDING") back("?saved=Η δαπάνη καταχωρήθηκε και περιμένει έγκριση");
    back("?saved=Το έξοδο καταχωρήθηκε");
  } catch (error) { fail(error); }
}

export async function newSupplierPayment(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  try {
    const purchaseDocId = text(form, "purchaseDocId");
    const allocationCents = cents(form.get("allocation"));
    await recordSupplierPayment(ctx, { clientKey: String(form.get("clientKey") ?? ""), supplierId: String(form.get("supplierId") ?? ""), accountId: text(form, "accountId"), amountCents: cents(form.get("amount")), paidAt: date(form.get("paidAt")), reference: text(form, "reference"), informal: form.get("informal") === "on", note: text(form, "note"), allocations: purchaseDocId && allocationCents > 0 ? [{ purchaseDocId, amountCents: allocationCents }] : [] });
    back("?saved=Η πληρωμή προμηθευτή καταχωρήθηκε");
  } catch (error) { fail(error); }
}

export async function closeCash(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  try {
    await closeCashRegister(ctx, { storeId: String(form.get("storeId") ?? ""), businessDate: date(form.get("businessDate")), shift: String(form.get("shift") ?? "DAY"), openingCashCents: cents(form.get("openingCash")), actualCashCents: cents(form.get("actualCash")), commissionCents: cents(form.get("commission")), cashAccountId: text(form, "cashAccountId") });
    back("?saved=Το ταμείο έκλεισε");
  } catch (error) { fail(error); }
}

export async function reopenCash(form: FormData) {
  const ctx = await requireStockContext("finance.reopen");
  try {
    await reopenCashRegister(ctx, String(form.get("closingId") ?? ""), String(form.get("reason") ?? ""));
    back("?saved=Το ταμείο άνοιξε για διόρθωση");
  } catch (error) { fail(error); }
}

export async function saveBudget(form: FormData) {
  const ctx = await requireStockContext("finance.edit");
  try {
    await saveBudgetTarget(ctx, { storeId: text(form, "storeId"), year: Number(form.get("year")), month: Number(form.get("month")), salesCents: cents(form.get("sales")), cogsCents: cents(form.get("cogs")), payrollCents: cents(form.get("payroll")), expenseCents: cents(form.get("expenses")) });
    back("?saved=Ο στόχος αποθηκεύτηκε");
  } catch (error) { fail(error); }
}

export async function decideExpenseAction(form: FormData) {
  const ctx = await requireStockContext("finance.read");
  try {
    const approve = form.get("decision") === "approve";
    await decideExpense(ctx, String(form.get("id") ?? ""), approve);
    back(approve ? "?saved=Η δαπάνη εγκρίθηκε" : "?saved=Η δαπάνη απορρίφθηκε");
  } catch (error) { fail(error); }
}
