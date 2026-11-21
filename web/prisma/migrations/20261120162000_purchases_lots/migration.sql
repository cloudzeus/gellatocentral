-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "genericItemId" TEXT,
ADD COLUMN     "lotId" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'sale',
ALTER COLUMN "storeId" DROP NOT NULL,
ALTER COLUMN "documentId" DROP NOT NULL,
ALTER COLUMN "lineId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "batchNumber" TEXT,
    "expiresAt" TIMESTAMP(3),
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDoc" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "number" TEXT,
    "issuedAt" TIMESTAMP(3),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "mydataMark" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "supplierCode" TEXT,
    "ean" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "batchNumber" TEXT,
    "expiresAt" TIMESTAMP(3),
    "receiptTempC" DOUBLE PRECISION,
    "receiptIssue" TEXT,
    "supplierItemId" TEXT,
    "tradeItemId" TEXT,
    "genericItemId" TEXT,
    "matchNote" TEXT,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockLot_orgId_expiresAt_idx" ON "StockLot"("orgId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_orgId_genericItemId_warehouseId_batchNumber_key" ON "StockLot"("orgId", "genericItemId", "warehouseId", "batchNumber");

-- CreateIndex
CREATE INDEX "PurchaseDoc_orgId_supplierId_createdAt_idx" ON "PurchaseDoc"("orgId", "supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDoc_orgId_mydataMark_key" ON "PurchaseDoc"("orgId", "mydataMark");

-- CreateIndex
CREATE INDEX "PurchaseLine_orgId_documentId_idx" ON "PurchaseLine"("orgId", "documentId");

-- CreateIndex
CREATE INDEX "PurchaseLine_orgId_supplierCode_idx" ON "PurchaseLine"("orgId", "supplierCode");

-- CreateIndex
CREATE INDEX "StockMovement_orgId_genericItemId_occurredAt_idx" ON "StockMovement"("orgId", "genericItemId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_lotId_idx" ON "StockMovement"("lotId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PurchaseDoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDoc" ADD CONSTRAINT "PurchaseDoc_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDoc" ADD CONSTRAINT "PurchaseDoc_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDoc" ADD CONSTRAINT "PurchaseDoc_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PurchaseDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_supplierItemId_fkey" FOREIGN KEY ("supplierItemId") REFERENCES "SupplierItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_tradeItemId_fkey" FOREIGN KEY ("tradeItemId") REFERENCES "TradeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Παρτίδα «χωρίς αριθμό παρτίδας» (χύμα είδη): μία ανά είδος/αποθήκη — το κανονικό unique αφήνει πολλά NULL.
CREATE UNIQUE INDEX "StockLot_nobatch_key" ON "StockLot"("orgId", "genericItemId", "warehouseId") WHERE "batchNumber" IS NULL;
