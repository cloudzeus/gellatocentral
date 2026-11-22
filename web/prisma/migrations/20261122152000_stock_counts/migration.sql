-- Απογραφές εργαστηρίου: παγωμένο snapshot, αποθηκευμένες μετρήσεις και το πολύ μία correction ανά γραμμή.
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'FINALIZED');

CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "countedOn" DATE NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "clientKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "finalizedById" TEXT,
    "finalizedByName" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockCount_finalized_fields_chk" CHECK (
        ("status" = 'DRAFT' AND "finalizedById" IS NULL AND "finalizedByName" IS NULL AND "finalizedAt" IS NULL)
        OR ("status" = 'FINALIZED' AND "finalizedByName" IS NOT NULL AND "finalizedAt" IS NOT NULL)
    )
);

CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "lotId" TEXT,
    "expectedQty" INTEGER NOT NULL,
    "actualQty" INTEGER,
    "differenceQty" INTEGER,
    "unitCostHundredths" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockCountLine_actual_nonnegative_chk" CHECK ("actualQty" IS NULL OR "actualQty" >= 0),
    CONSTRAINT "StockCountLine_cost_nonnegative_chk" CHECK ("unitCostHundredths" >= 0),
    CONSTRAINT "StockCountLine_difference_chk" CHECK (
        ("actualQty" IS NULL AND "differenceQty" IS NULL)
        OR (
            "actualQty" IS NOT NULL
            AND "differenceQty" IS NOT NULL
            AND "differenceQty"::bigint = "actualQty"::bigint - "expectedQty"::bigint
        )
    )
);

CREATE UNIQUE INDEX "StockCount_orgId_clientKey_key" ON "StockCount"("orgId", "clientKey");
CREATE INDEX "StockCount_orgId_warehouseId_countedOn_status_idx" ON "StockCount"("orgId", "warehouseId", "countedOn", "status");
CREATE INDEX "StockCount_orgId_storeId_countedOn_idx" ON "StockCount"("orgId", "storeId", "countedOn");
CREATE UNIQUE INDEX "StockCount_finalized_day_key" ON "StockCount"("orgId", "warehouseId", "countedOn") WHERE "status" = 'FINALIZED';

CREATE UNIQUE INDEX "StockCountLine_orgId_countId_genericItemId_lotId_key" ON "StockCountLine"("orgId", "countId", "genericItemId", "lotId");
CREATE UNIQUE INDEX "StockCountLine_no_lot_key" ON "StockCountLine"("orgId", "countId", "genericItemId") WHERE "lotId" IS NULL;
CREATE INDEX "StockCountLine_orgId_genericItemId_idx" ON "StockCountLine"("orgId", "genericItemId");

ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_countLineId_fkey" FOREIGN KEY ("countLineId") REFERENCES "StockCountLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
