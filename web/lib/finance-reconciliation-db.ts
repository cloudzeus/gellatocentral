// Scoped DB reader για stateless bank/Viva review. Δεν υπάρχει create/update σε FinanceTransaction.
import { db } from "./db";
import { parseBankStatement, reviewBankStatementRows, type BankStatementRow } from "./finance-reconciliation";
import { reportPeriod } from "./reports";
import { assertGlobalStockScope, assertStockScope, type StockContext } from "./stock-scope";
import { auditWorkflow, WorkflowError } from "./workflow-db";

const DAY = 86_400_000;

export async function reviewAccountStatement(ctx: StockContext, input: { accountId: string; from: string; to: string; csv: string }) {
  const account = await db.financeAccount.findFirst({ where: { id: input.accountId, orgId: ctx.orgId } });
  if (!account || !["bank", "card_clearing"].includes(account.kind)) throw new WorkflowError("Ο τραπεζικός λογαριασμός δεν βρέθηκε ή δεν υποστηρίζει statement review");
  if (!account.storeId) assertGlobalStockScope(ctx);
  await assertStockScope(db, ctx, { storeId: account.storeId ?? undefined });
  if (account.storeId && !ctx.storeIds.length && ctx.warehouseIds.length) {
    const linked = await db.storeWarehouse.findFirst({ where: { storeId: account.storeId, warehouseId: { in: [...ctx.warehouseIds] }, warehouse: { orgId: ctx.orgId } }, select: { storeId: true } });
    if (!linked) throw new WorkflowError("Δεν έχεις πρόσβαση στο κατάστημα του λογαριασμού");
  }
  const period = reportPeriod(input.from, input.to);
  const statement = parseBankStatement(input.csv);
  const storeWhere = account.storeId ? { storeId: account.storeId } : ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {};
  const [ledger, sales, closings] = await Promise.all([
    db.financeTransaction.findMany({
      where: { orgId: ctx.orgId, accountId: account.id, occurredAt: { gte: new Date(period.fromAt.getTime() - 3 * DAY), lt: new Date(period.toAt.getTime() + 3 * DAY) } },
      select: { id: true, orgId: true, accountId: true, storeId: true, amountCents: true, occurredAt: true, referenceId: true },
    }),
    db.sale.findMany({
      where: {
        orgId: ctx.orgId,
        ...storeWhere,
        status: "COMPLETED",
        issuedAt: { gte: new Date(period.fromAt.getTime() - 5 * DAY), lt: period.toAt },
        payment: { is: { success: true, method: { is: { provider: { in: ["VIVA_TERMINAL", "VIVA_CHECKOUT"] } } } } },
      },
      select: { orgId: true, storeId: true, issuedAt: true, payment: { select: { amountCents: true } } },
    }),
    db.cashClosing.findMany({
      where: { orgId: ctx.orgId, ...storeWhere, status: "CLOSED", businessDate: { gte: new Date(new Date(`${input.from}T00:00:00.000Z`).getTime() - 5 * DAY), lt: new Date(new Date(`${input.to}T00:00:00.000Z`).getTime() + DAY) } },
      select: { orgId: true, storeId: true, businessDate: true, commissionCents: true },
    }),
  ]);
  const review = reviewBankStatementRows({
    orgId: ctx.orgId,
    accountId: account.id,
    storeId: account.storeId,
    from: input.from,
    to: input.to,
    statement,
    ledger,
    vivaPayments: sales.flatMap((sale) => sale.payment && sale.issuedAt ? [{ orgId: sale.orgId, storeId: sale.storeId, issuedAt: sale.issuedAt, amountCents: sale.payment.amountCents }] : []),
    vivaCommissions: closings.map((row) => ({ orgId: row.orgId, storeId: row.storeId, businessDate: row.businessDate.toISOString().slice(0, 10), commissionCents: row.commissionCents })),
  });
  await auditWorkflow(db, {
    orgId: ctx.orgId,
    actor: { id: ctx.userId, name: ctx.userName },
    action: "finance.reconciliation.review",
    entityType: "finance_statement_review",
    entityId: review.reviewId,
    storeId: account.storeId,
    metadata: { accountId: account.id, from: input.from, to: input.to, persistence: review.persistence, movementsCreated: review.movementsCreated, summary: review.summary },
  });
  return review;
}

export type { BankStatementRow };
