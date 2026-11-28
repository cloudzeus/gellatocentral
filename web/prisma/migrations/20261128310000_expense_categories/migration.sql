-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "classificationStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "dueAt" DATE,
ADD COLUMN     "fileId" TEXT,
ADD COLUMN     "mydataCategory" TEXT,
ADD COLUMN     "mydataDocType" TEXT,
ADD COLUMN     "mydataType" TEXT,
ADD COLUMN     "mydataVatType" TEXT,
ADD COLUMN     "periodFrom" DATE,
ADD COLUMN     "periodTo" DATE,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'APPROVED';

-- AlterTable
ALTER TABLE "MydataIncoming" ADD COLUMN     "expenseId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "expenseApprovalCents" INTEGER;

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mydataCategory" TEXT,
    "mydataType" TEXT,
    "mydataVatType" TEXT,
    "accountCode" TEXT,
    "vatAccountCode" TEXT,
    "costCenterId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_orgId_code_key" ON "ExpenseCategory"("orgId", "code");

-- CreateIndex
CREATE INDEX "Expense_orgId_status_idx" ON "Expense"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MydataIncoming_expenseId_key" ON "MydataIncoming"("expenseId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MydataIncoming" ADD CONSTRAINT "MydataIncoming_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

