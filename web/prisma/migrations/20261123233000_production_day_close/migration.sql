-- CreateTable
CREATE TABLE "ProductionDayClose" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "clientKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionDayClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionDayClose_orgId_clientKey_key" ON "ProductionDayClose"("orgId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionDayClose_orgId_warehouseId_businessDate_key" ON "ProductionDayClose"("orgId", "warehouseId", "businessDate");

-- CreateIndex
CREATE INDEX "ProductionDayClose_orgId_businessDate_status_idx" ON "ProductionDayClose"("orgId", "businessDate", "status");

-- AddForeignKey
ALTER TABLE "ProductionDayClose" ADD CONSTRAINT "ProductionDayClose_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
