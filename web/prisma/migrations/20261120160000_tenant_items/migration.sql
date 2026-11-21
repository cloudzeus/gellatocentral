-- CreateTable
CREATE TABLE "GenericItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUnitId" TEXT NOT NULL,
    "vatRateId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenericItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemMapping" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "tradeItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tradeItemId" TEXT NOT NULL,
    "supplierCode" TEXT,
    "barcode" TEXT,
    "packQty" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenericItem_orgId_active_idx" ON "GenericItem"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "GenericItem_orgId_name_key" ON "GenericItem"("orgId", "name");

-- CreateIndex
CREATE INDEX "ItemMapping_orgId_genericItemId_idx" ON "ItemMapping"("orgId", "genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemMapping_orgId_tradeItemId_key" ON "ItemMapping"("orgId", "tradeItemId");

-- CreateIndex
CREATE INDEX "SupplierItem_orgId_tradeItemId_idx" ON "SupplierItem"("orgId", "tradeItemId");

-- CreateIndex
CREATE INDEX "SupplierItem_orgId_barcode_idx" ON "SupplierItem"("orgId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierItem_orgId_supplierId_supplierCode_key" ON "SupplierItem"("orgId", "supplierId", "supplierCode");

-- AddForeignKey
ALTER TABLE "GenericItem" ADD CONSTRAINT "GenericItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericItem" ADD CONSTRAINT "GenericItem_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericItem" ADD CONSTRAINT "GenericItem_vatRateId_fkey" FOREIGN KEY ("vatRateId") REFERENCES "VatRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemMapping" ADD CONSTRAINT "ItemMapping_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemMapping" ADD CONSTRAINT "ItemMapping_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemMapping" ADD CONSTRAINT "ItemMapping_tradeItemId_fkey" FOREIGN KEY ("tradeItemId") REFERENCES "TradeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_tradeItemId_fkey" FOREIGN KEY ("tradeItemId") REFERENCES "TradeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
