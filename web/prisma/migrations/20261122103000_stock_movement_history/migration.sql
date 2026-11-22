-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "countId" TEXT,
ADD COLUMN     "countLineId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "transferId" TEXT,
ADD COLUMN     "transferLineId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_countLineId_key" ON "StockMovement"("countLineId");

-- CreateIndex
CREATE INDEX "StockMovement_orgId_warehouseId_genericItemId_lotId_idx" ON "StockMovement"("orgId", "warehouseId", "genericItemId", "lotId");

-- CreateIndex
CREATE INDEX "StockMovement_orgId_warehouseId_recordedAt_idx" ON "StockMovement"("orgId", "warehouseId", "recordedAt");

-- CreateIndex
CREATE INDEX "StockMovement_orgId_transferId_idx" ON "StockMovement"("orgId", "transferId");

-- CreateIndex
CREATE INDEX "StockMovement_orgId_countId_idx" ON "StockMovement"("orgId", "countId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_orgId_transferLineId_warehouseId_key" ON "StockMovement"("orgId", "transferLineId", "warehouseId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
