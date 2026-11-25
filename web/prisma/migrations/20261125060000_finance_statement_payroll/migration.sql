-- Persisted statement reviews και payroll execution χωρίς αυτόματη ledger εγγραφή.
CREATE TABLE "FinanceStatementImport" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "storeId" TEXT,
  "reviewId" TEXT NOT NULL,
  "sourceName" TEXT,
  "fromDate" DATE NOT NULL,
  "toDate" DATE NOT NULL,
  "totalAmountCents" INTEGER NOT NULL,
  "matchedCount" INTEGER NOT NULL,
  "unmatchedCount" INTEGER NOT NULL,
  "ambiguousCount" INTEGER NOT NULL,
  "conflictCount" INTEGER NOT NULL,
  "createdById" TEXT,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceStatementImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceStatementImport_counts_check" CHECK (
    "matchedCount" >= 0 AND "unmatchedCount" >= 0 AND "ambiguousCount" >= 0 AND "conflictCount" >= 0
  )
);

CREATE TABLE "FinanceStatementRow" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "line" INTEGER NOT NULL,
  "externalId" TEXT,
  "reference" TEXT,
  "description" TEXT,
  "bookedAt" DATE NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "reasons" TEXT[] NOT NULL,
  "matchedTransactionId" TEXT,
  "candidateTransactionIds" TEXT[] NOT NULL,
  "vivaCandidates" JSONB,
  "suggestedKind" TEXT,
  CONSTRAINT "FinanceStatementRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceStatementRow_status_check" CHECK ("status" IN ('MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'CONFLICT'))
);

CREATE TABLE "PayrollPaymentBatch" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "storeId" TEXT,
  "batchId" TEXT NOT NULL,
  "fromDate" DATE NOT NULL,
  "toDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREPARED',
  "totalAmountCents" INTEGER NOT NULL,
  "readyAmountCents" INTEGER NOT NULL,
  "employeeCount" INTEGER NOT NULL,
  "readyCount" INTEGER NOT NULL,
  "reviewCount" INTEGER NOT NULL,
  "createdById" TEXT,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollPaymentBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollPaymentBatch_status_check" CHECK ("status" IN ('PREPARED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN')),
  CONSTRAINT "PayrollPaymentBatch_amounts_check" CHECK (
    "totalAmountCents" >= 0 AND "readyAmountCents" >= 0 AND "employeeCount" >= 0 AND "readyCount" >= 0 AND "reviewCount" >= 0
  )
);

CREATE TABLE "PayrollPaymentItem" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeName" TEXT NOT NULL,
  "storeId" TEXT,
  "iban" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "workedMinutes" INTEGER NOT NULL,
  "reviewStatus" TEXT NOT NULL,
  "issues" TEXT[] NOT NULL,
  "executionStatus" TEXT NOT NULL DEFAULT 'NOT_EXECUTED',
  CONSTRAINT "PayrollPaymentItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollPaymentItem_review_check" CHECK ("reviewStatus" IN ('READY', 'REVIEW')),
  CONSTRAINT "PayrollPaymentItem_execution_check" CHECK ("executionStatus" IN ('NOT_EXECUTED', 'SUCCEEDED')),
  CONSTRAINT "PayrollPaymentItem_amounts_check" CHECK ("amountCents" >= 0 AND "workedMinutes" >= 0)
);

CREATE TABLE "PayrollPaymentExecution" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "storeId" TEXT,
  "clientKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "provider" TEXT NOT NULL,
  "providerReference" TEXT,
  "failureCode" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollPaymentExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollPaymentExecution_status_check" CHECK ("status" IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN'))
);

CREATE UNIQUE INDEX "FinanceStatementImport_orgId_reviewId_key" ON "FinanceStatementImport"("orgId", "reviewId");
CREATE INDEX "FinanceStatementImport_orgId_accountId_createdAt_idx" ON "FinanceStatementImport"("orgId", "accountId", "createdAt");
CREATE INDEX "FinanceStatementImport_orgId_storeId_createdAt_idx" ON "FinanceStatementImport"("orgId", "storeId", "createdAt");
CREATE UNIQUE INDEX "FinanceStatementRow_importId_line_key" ON "FinanceStatementRow"("importId", "line");
CREATE INDEX "FinanceStatementRow_orgId_matchedTransactionId_idx" ON "FinanceStatementRow"("orgId", "matchedTransactionId");
CREATE INDEX "FinanceStatementRow_orgId_importId_status_idx" ON "FinanceStatementRow"("orgId", "importId", "status");
CREATE UNIQUE INDEX "PayrollPaymentBatch_orgId_batchId_key" ON "PayrollPaymentBatch"("orgId", "batchId");
CREATE INDEX "PayrollPaymentBatch_orgId_storeId_fromDate_toDate_idx" ON "PayrollPaymentBatch"("orgId", "storeId", "fromDate", "toDate");
CREATE INDEX "PayrollPaymentBatch_orgId_status_createdAt_idx" ON "PayrollPaymentBatch"("orgId", "status", "createdAt");
CREATE UNIQUE INDEX "PayrollPaymentItem_batchId_employeeId_key" ON "PayrollPaymentItem"("batchId", "employeeId");
CREATE INDEX "PayrollPaymentItem_orgId_employeeId_executionStatus_idx" ON "PayrollPaymentItem"("orgId", "employeeId", "executionStatus");
CREATE UNIQUE INDEX "PayrollPaymentExecution_orgId_clientKey_key" ON "PayrollPaymentExecution"("orgId", "clientKey");
CREATE INDEX "PayrollPaymentExecution_orgId_batchId_createdAt_idx" ON "PayrollPaymentExecution"("orgId", "batchId", "createdAt");
CREATE INDEX "PayrollPaymentExecution_orgId_status_createdAt_idx" ON "PayrollPaymentExecution"("orgId", "status", "createdAt");

ALTER TABLE "FinanceStatementImport" ADD CONSTRAINT "FinanceStatementImport_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceStatementImport" ADD CONSTRAINT "FinanceStatementImport_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceStatementRow" ADD CONSTRAINT "FinanceStatementRow_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "FinanceStatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceStatementRow" ADD CONSTRAINT "FinanceStatementRow_matchedTransactionId_fkey"
  FOREIGN KEY ("matchedTransactionId") REFERENCES "FinanceTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentBatch" ADD CONSTRAINT "PayrollPaymentBatch_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentItem" ADD CONSTRAINT "PayrollPaymentItem_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PayrollPaymentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentExecution" ADD CONSTRAINT "PayrollPaymentExecution_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentExecution" ADD CONSTRAINT "PayrollPaymentExecution_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PayrollPaymentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentExecution" ADD CONSTRAINT "PayrollPaymentExecution_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
