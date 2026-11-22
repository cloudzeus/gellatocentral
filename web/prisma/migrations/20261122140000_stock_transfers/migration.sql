-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT NOT NULL,
    "storeId" TEXT,
    "clientKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "sourceLotId" TEXT,
    "destinationLotId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitCostHundredths" INTEGER NOT NULL,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockTransfer_orgId_sourceWarehouseId_createdAt_idx" ON "StockTransfer"("orgId", "sourceWarehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransfer_orgId_destinationWarehouseId_createdAt_idx" ON "StockTransfer"("orgId", "destinationWarehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransfer_orgId_storeId_createdAt_idx" ON "StockTransfer"("orgId", "storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_orgId_clientKey_key" ON "StockTransfer"("orgId", "clientKey");

-- CreateIndex
CREATE INDEX "StockTransferLine_orgId_genericItemId_idx" ON "StockTransferLine"("orgId", "genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferLine_orgId_transferId_genericItemId_sourceLotI_key" ON "StockTransferLine"("orgId", "transferId", "genericItemId", "sourceLotId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_transferLineId_fkey" FOREIGN KEY ("transferLineId") REFERENCES "StockTransferLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_sourceLotId_fkey" FOREIGN KEY ("sourceLotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_destinationLotId_fkey" FOREIGN KEY ("destinationLotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Επιχειρησιακά αμετάβλητα των άμεσων μεταφορών.
ALTER TABLE "StockTransfer"
ADD CONSTRAINT "StockTransfer_distinct_warehouses" CHECK ("sourceWarehouseId" <> "destinationWarehouseId");

ALTER TABLE "StockTransferLine"
ADD CONSTRAINT "StockTransferLine_positive_quantity" CHECK ("quantity" > 0),
ADD CONSTRAINT "StockTransferLine_nonnegative_cost" CHECK ("unitCostHundredths" >= 0),
ADD CONSTRAINT "StockTransferLine_lot_pair" CHECK (("sourceLotId" IS NULL AND "destinationLotId" IS NULL) OR ("sourceLotId" IS NOT NULL AND "destinationLotId" IS NOT NULL));

-- Η PostgreSQL επιτρέπει πολλά NULL στο κανονικό unique· χωρίς παρτίδα μία γραμμή ανά είδος.
CREATE UNIQUE INDEX "StockTransferLine_nolot_key"
ON "StockTransferLine" ("orgId", "transferId", "genericItemId")
WHERE "sourceLotId" IS NULL;
