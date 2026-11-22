-- Offline edit idempotency και ρητά thresholds χαμηλού αποθέματος ανά tenant/warehouse/generic.
CREATE TABLE "StockCountEdit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCountEdit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockThreshold" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "minimumQty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockThreshold_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockThreshold_minimum_nonnegative_chk" CHECK ("minimumQty" >= 0)
);

CREATE UNIQUE INDEX "StockCountEdit_orgId_countId_clientKey_key" ON "StockCountEdit"("orgId", "countId", "clientKey");
CREATE INDEX "StockCountEdit_orgId_countId_createdAt_idx" ON "StockCountEdit"("orgId", "countId", "createdAt");
CREATE UNIQUE INDEX "StockThreshold_orgId_warehouseId_genericItemId_key" ON "StockThreshold"("orgId", "warehouseId", "genericItemId");
CREATE INDEX "StockThreshold_orgId_warehouseId_idx" ON "StockThreshold"("orgId", "warehouseId");

ALTER TABLE "StockCountEdit" ADD CONSTRAINT "StockCountEdit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockCountEdit" ADD CONSTRAINT "StockCountEdit_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockThreshold" ADD CONSTRAINT "StockThreshold_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockThreshold" ADD CONSTRAINT "StockThreshold_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockThreshold" ADD CONSTRAINT "StockThreshold_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
