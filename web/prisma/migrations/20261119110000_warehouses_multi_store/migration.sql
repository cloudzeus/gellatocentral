-- Αποθήκες ανεξάρτητες από κατάστημα: η σχέση περνά στο StoreWarehouse (κεντρική αποθήκη σε πολλά καταστήματα).
-- Το backfill γίνεται ΠΡΙΝ πέσει το Warehouse.storeId: κάθε υπάρχουσα αποθήκη δένεται στο κατάστημά της ως προεπιλογή.

-- CreateTable
CREATE TABLE "StoreWarehouse" (
    "storeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreWarehouse_pkey" PRIMARY KEY ("storeId","warehouseId")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreWarehouse_warehouseId_idx" ON "StoreWarehouse"("warehouseId");

-- CreateIndex
CREATE INDEX "StockMovement_orgId_warehouseId_occurredAt_idx" ON "StockMovement"("orgId", "warehouseId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_orgId_storeId_occurredAt_idx" ON "StockMovement"("orgId", "storeId", "occurredAt");

-- Πρώτα οι νέες στήλες (τις θέλουν οι δείκτες), μετά το backfill, και τελευταίο πέφτει το παλιό storeId
ALTER TABLE "Warehouse"
ADD COLUMN     "code" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Warehouse_orgId_idx" ON "Warehouse"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_orgId_code_key" ON "Warehouse"("orgId", "code");

-- AddForeignKey
ALTER TABLE "Device" ADD COLUMN     "defaultWarehouseId" TEXT;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_defaultWarehouseId_fkey" FOREIGN KEY ("defaultWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreWarehouse" ADD CONSTRAINT "StoreWarehouse_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreWarehouse" ADD CONSTRAINT "StoreWarehouse_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: η μέχρι τώρα σχέση warehouse→store γίνεται σύνδεση με προεπιλογή, ώστε τίποτα δεν αλλάζει στη συμπεριφορά
INSERT INTO "StoreWarehouse" ("storeId", "warehouseId", "isDefault", "priority")
SELECT "storeId", "id", true, 10 FROM "Warehouse" WHERE "storeId" IS NOT NULL;

-- Τώρα που τα δεδομένα είναι ασφαλή, πέφτει η παλιά στήλη
ALTER TABLE "Warehouse" DROP CONSTRAINT "Warehouse_storeId_fkey";
DROP INDEX "Warehouse_orgId_storeId_idx";
ALTER TABLE "Warehouse" DROP COLUMN "storeId";
