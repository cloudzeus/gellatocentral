-- AlterTable
ALTER TABLE "PurchaseReceipt" ADD COLUMN     "clientKey" TEXT NOT NULL,
ADD COLUMN     "requestHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_orgId_clientKey_key" ON "PurchaseReceipt"("orgId", "clientKey");
