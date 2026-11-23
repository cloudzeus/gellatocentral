-- CreateEnum
CREATE TYPE "HaccpRecordStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "HaccpRecordResult" AS ENUM ('CONFORMING', 'DEVIATION', 'NA');

-- AlterTable
ALTER TABLE "PurchaseDoc" ADD COLUMN     "buyerSnapshot" JSONB,
ADD COLUMN     "expensesVatRate" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "otherExpensesCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "shippingCostCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippingMethod" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "supplierSnapshot" JSONB;

-- AlterTable
ALTER TABLE "PurchaseLine" ADD COLUMN     "discountBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "HaccpRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "templateId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" "HaccpRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "result" "HaccpRecordResult" NOT NULL DEFAULT 'CONFORMING',
    "measuredValue" DOUBLE PRECISION,
    "unit" TEXT,
    "responsibleName" TEXT NOT NULL,
    "notes" TEXT,
    "correctiveAction" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HaccpRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaccpAssessment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "critical" INTEGER NOT NULL,
    "warnings" INTEGER NOT NULL,
    "findings" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaccpAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaccpSourceCheck" (
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "fingerprint" TEXT,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "message" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "changedAt" TIMESTAMP(3),

    CONSTRAINT "HaccpSourceCheck_pkey" PRIMARY KEY ("sourceId")
);

-- CreateIndex
CREATE INDEX "HaccpRecord_orgId_templateId_occurredAt_idx" ON "HaccpRecord"("orgId", "templateId", "occurredAt");

-- CreateIndex
CREATE INDEX "HaccpRecord_orgId_storeId_occurredAt_idx" ON "HaccpRecord"("orgId", "storeId", "occurredAt");

-- CreateIndex
CREATE INDEX "HaccpRecord_orgId_status_result_idx" ON "HaccpRecord"("orgId", "status", "result");

-- CreateIndex
CREATE INDEX "HaccpAssessment_orgId_evaluatedAt_idx" ON "HaccpAssessment"("orgId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "HaccpSourceCheck_status_checkedAt_idx" ON "HaccpSourceCheck"("status", "checkedAt");

-- AddForeignKey
ALTER TABLE "HaccpRecord" ADD CONSTRAINT "HaccpRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaccpRecord" ADD CONSTRAINT "HaccpRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaccpAssessment" ADD CONSTRAINT "HaccpAssessment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
