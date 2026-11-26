// Persisted, scoped statement reviews· δεν υπάρχει create/update σε FinanceTransaction.
import type { PaymentProvider, Prisma } from "./generated/prisma/client";
import { db } from "./db";
import {
  parseBankStatement,
  reviewBankStatementRows,
  type BankStatementRow,
  type PersistedStatementReview,
  type StatementReviewListItem,
  type StatementReviewRow,
  type StatementReviewStatus,
  type VivaSettlementCandidate,
} from "./finance-reconciliation";
import { reportPeriod } from "./reports";
import { stockTransaction } from "./stock-transaction";
import { assertGlobalStockScope, assertStockScope, type StockContext } from "./stock-scope";
import { auditWorkflow, cleanText, WorkflowError } from "./workflow-db";

const VIVA: PaymentProvider[] = ["VIVA_TERMINAL", "VIVA_CHECKOUT"];

const DAY = 86_400_000;
type Tx = Prisma.TransactionClient;
type StoredRow = {
  line: number;
  externalId: string | null;
  reference: string | null;
  description: string | null;
  bookedAt: Date;
  amountCents: number;
  status: string;
  reasons: string[];
  matchedTransactionId: string | null;
  candidateTransactionIds: string[];
  vivaCandidates: Prisma.JsonValue | null;
  suggestedKind: string | null;
};
type StoredImport = {
  id: string;
  orgId: string;
  accountId: string;
  storeId: string | null;
  reviewId: string;
  sourceName: string | null;
  fromDate: Date;
  toDate: Date;
  totalAmountCents: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  conflictCount: number;
  createdAt: Date;
  rows: StoredRow[];
};

function storedReview(importRow: StoredImport): PersistedStatementReview {
  const rows: StatementReviewRow[] = importRow.rows.map((row) => ({
    line: row.line,
    externalId: row.externalId,
    reference: row.reference,
    description: row.description,
    bookedAt: row.bookedAt,
    amountCents: row.amountCents,
    status: row.status as StatementReviewStatus,
    reasons: row.reasons,
    matchedTransactionId: row.matchedTransactionId,
    candidateTransactionIds: row.candidateTransactionIds,
    vivaCandidates: (row.vivaCandidates ?? []) as unknown as VivaSettlementCandidate[],
    suggestedKind: row.suggestedKind === "viva_settlement" ? "viva_settlement" : null,
  }));
  return {
    reviewId: importRow.reviewId,
    importId: importRow.id,
    persistence: "PERSISTED",
    movementsCreated: 0,
    accountId: importRow.accountId,
    storeId: importRow.storeId,
    sourceName: importRow.sourceName,
    createdAt: importRow.createdAt,
    from: importRow.fromDate.toISOString().slice(0, 10),
    to: importRow.toDate.toISOString().slice(0, 10),
    rows,
    summary: {
      MATCHED: importRow.matchedCount,
      UNMATCHED: importRow.unmatchedCount,
      AMBIGUOUS: importRow.ambiguousCount,
      CONFLICT: importRow.conflictCount,
      total: rows.length,
      amountCents: importRow.totalAmountCents,
    },
  };
}

function listedReview(importRow: Omit<StoredImport, "rows">): StatementReviewListItem {
  const review = storedReview({ ...importRow, rows: [] });
  return { ...review, summary: { ...review.summary, total: review.summary.MATCHED + review.summary.UNMATCHED + review.summary.AMBIGUOUS + review.summary.CONFLICT } };
}

async function ownedStatementAccount(tx: Tx, ctx: StockContext, accountId: string) {
  const account = await tx.financeAccount.findFirst({ where: { id: accountId, orgId: ctx.orgId } });
  if (!account || !["bank", "card_clearing"].includes(account.kind)) throw new WorkflowError("Ο τραπεζικός λογαριασμός δεν βρέθηκε ή δεν υποστηρίζει statement review");
  if (!account.storeId) assertGlobalStockScope(ctx);
  await assertStockScope(tx, ctx, { storeId: account.storeId ?? undefined });
  if (account.storeId && !ctx.storeIds.length && ctx.warehouseIds.length) {
    const linked = await tx.storeWarehouse.findFirst({ where: { storeId: account.storeId, warehouseId: { in: [...ctx.warehouseIds] }, warehouse: { orgId: ctx.orgId } }, select: { storeId: true } });
    if (!linked) throw new WorkflowError("Δεν έχεις πρόσβαση στο κατάστημα του λογαριασμού");
  }
  return account;
}

export async function reviewAccountStatement(ctx: StockContext, input: { accountId: string; from: string; to: string; csv: string; sourceName?: string | null }) {
  const account = await ownedStatementAccount(db, ctx, input.accountId);
  const period = reportPeriod(input.from, input.to);
  const statement = parseBankStatement(input.csv);
  const sourceName = cleanText(input.sourceName, "Όνομα statement", 160);
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
        payment: { is: { success: true } },
        OR: [{ payment: { is: { method: { is: { provider: { in: VIVA } } } } } }, { shares: { some: { status: "PAID", method: { is: { provider: { in: VIVA } } } } } }],
      },
      select: {
        orgId: true, storeId: true, issuedAt: true, payment: { select: { amountCents: true, method: { select: { provider: true } } } },
        shares: { where: { status: "PAID", method: { is: { provider: { in: VIVA } } } }, select: { amountCents: true } }, // μοίρασμα κατά ποσό
      },
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
    vivaPayments: sales.flatMap((sale) => {
      if (!sale.payment || !sale.issuedAt) return [];
      const at = { orgId: sale.orgId, storeId: sale.storeId, issuedAt: sale.issuedAt };
      return [...(VIVA.includes(sale.payment.method.provider) ? [sale.payment] : []), ...sale.shares].map((p) => ({ ...at, amountCents: p.amountCents }));
    }),
    vivaCommissions: closings.map((row) => ({ orgId: row.orgId, storeId: row.storeId, businessDate: row.businessDate.toISOString().slice(0, 10), commissionCents: row.commissionCents })),
  });
  return stockTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`statement-review:${ctx.orgId}:${review.reviewId}`}, 0))) AS lock`;
    await ownedStatementAccount(tx, ctx, account.id);
    const previous = await tx.financeStatementImport.findUnique({ where: { orgId_reviewId: { orgId: ctx.orgId, reviewId: review.reviewId } }, include: { rows: { orderBy: { line: "asc" } } } });
    // Το ίδιο review επιστρέφεται χωρίς νέο import, match ή audit.
    if (previous) {
      if (previous.accountId !== account.id || previous.storeId !== account.storeId) throw new WorkflowError("Το review αντιστοιχεί σε διαφορετικό λογαριασμό ή κατάστημα");
      return storedReview(previous);
    }
    const created = await tx.financeStatementImport.create({ data: {
      orgId: ctx.orgId,
      accountId: account.id,
      storeId: account.storeId,
      reviewId: review.reviewId,
      sourceName,
      fromDate: new Date(`${input.from}T00:00:00.000Z`),
      toDate: new Date(`${input.to}T00:00:00.000Z`),
      totalAmountCents: review.summary.amountCents,
      matchedCount: review.summary.MATCHED,
      unmatchedCount: review.summary.UNMATCHED,
      ambiguousCount: review.summary.AMBIGUOUS,
      conflictCount: review.summary.CONFLICT,
      createdById: ctx.userId,
      createdByName: ctx.userName,
      rows: { create: review.rows.map((row) => ({
        orgId: ctx.orgId,
        line: row.line,
        externalId: row.externalId,
        reference: row.reference,
        description: row.description,
        bookedAt: row.bookedAt,
        amountCents: row.amountCents,
        status: row.status,
        reasons: row.reasons,
        matchedTransactionId: row.matchedTransactionId,
        candidateTransactionIds: row.candidateTransactionIds,
        vivaCandidates: row.vivaCandidates,
        suggestedKind: row.suggestedKind,
      })) },
    }, include: { rows: { orderBy: { line: "asc" } } } });
    await auditWorkflow(tx, {
      orgId: ctx.orgId,
      actor: { id: ctx.userId, name: ctx.userName },
      action: "finance.reconciliation.review",
      entityType: "finance_statement_review",
      entityId: review.reviewId,
      storeId: account.storeId,
      metadata: { accountId: account.id, importId: created.id, from: input.from, to: input.to, persistence: "PERSISTED", movementsCreated: 0, summary: review.summary },
    });
    return storedReview(created);
  });
}

async function accessibleAccountIds(ctx: StockContext): Promise<string[] | null> {
  if (!ctx.storeIds.length && !ctx.warehouseIds.length) return null;
  let storeIds = [...ctx.storeIds];
  if (!storeIds.length && ctx.warehouseIds.length) {
    const links = await db.storeWarehouse.findMany({ where: { warehouseId: { in: [...ctx.warehouseIds] }, warehouse: { orgId: ctx.orgId } }, select: { storeId: true } });
    storeIds = [...new Set(links.map((link) => link.storeId))];
  }
  const accounts = await db.financeAccount.findMany({ where: { orgId: ctx.orgId, kind: { in: ["bank", "card_clearing"] }, storeId: { in: storeIds } }, select: { id: true } });
  return accounts.map((account) => account.id);
}

export async function listAccountStatementReviews(ctx: StockContext, accountId?: string | null): Promise<StatementReviewListItem[]> {
  if (accountId) await ownedStatementAccount(db, ctx, accountId);
  const accessible = accountId ? [accountId] : await accessibleAccountIds(ctx);
  if (accessible && !accessible.length) return [];
  const imports = await db.financeStatementImport.findMany({
    where: { orgId: ctx.orgId, ...(accessible ? { accountId: { in: accessible } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return imports.map(listedReview);
}

export async function getAccountStatementReview(ctx: StockContext, input: { accountId: string; reviewId: string }) {
  const account = await ownedStatementAccount(db, ctx, input.accountId);
  const reviewId = cleanText(input.reviewId, "Review", 64, true)!;
  const importRow = await db.financeStatementImport.findFirst({ where: { orgId: ctx.orgId, accountId: account.id, reviewId }, include: { rows: { orderBy: { line: "asc" } } } });
  if (!importRow) throw new WorkflowError("Το statement review δεν βρέθηκε");
  return storedReview(importRow);
}

export type { BankStatementRow };
