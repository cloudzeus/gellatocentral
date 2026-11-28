-- Ενότητα 4α/4α΄: μηχανή κατανάλωσης (συνταγές πώλησης, γεγονότα κατανάλωσης), ημερήσια ζήτηση και καιρός.

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "consumptionEventId" TEXT;

-- AlterTable
ALTER TABLE "StockCountLine" ADD COLUMN     "consumptionQty" INTEGER,
ADD COLUMN     "inflowQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wasteQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'SALE';

-- AlterTable
ALTER TABLE "GenericItem" ADD COLUMN     "consumptionSource" TEXT NOT NULL DEFAULT 'SALE',
ADD COLUMN     "madeToOrder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minDisplayBase" INTEGER,
ADD COLUMN     "perishable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "machineCapacityGrams" INTEGER,
ADD COLUMN     "normalWastePct" INTEGER;

-- CreateTable
CREATE TABLE "SalesRecipe" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT,
    "modifierOptionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesRecipeLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "salesRecipeId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "quantityBase" INTEGER NOT NULL,

    CONSTRAINT "SalesRecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "restock" BOOLEAN NOT NULL DEFAULT false,
    "saleId" TEXT,
    "saleLineId" TEXT,
    "countLineId" TEXT,
    "reversesId" TEXT,
    "clientKey" TEXT,
    "productId" TEXT,
    "genericItemId" TEXT,
    "quantity" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "day" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "note" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandDaily" (
    "orgId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "consumedBase" INTEGER NOT NULL DEFAULT 0,
    "theoreticalBase" INTEGER NOT NULL DEFAULT 0,
    "wasteBase" INTEGER NOT NULL DEFAULT 0,
    "wholesaleBase" INTEGER NOT NULL DEFAULT 0,
    "reviewBase" INTEGER NOT NULL DEFAULT 0,
    "stockedOut" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandDaily_pkey" PRIMARY KEY ("orgId","warehouseId","genericItemId","day")
);

-- CreateTable
CREATE TABLE "WeatherDaily" (
    "orgId" TEXT NOT NULL,
    "locationKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "tMaxC10" INTEGER,
    "tMinC10" INTEGER,
    "rainMm10" INTEGER,
    "code" INTEGER,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherDaily_pkey" PRIMARY KEY ("orgId","locationKey","day")
);

-- CreateIndex
CREATE INDEX "SalesRecipe_orgId_idx" ON "SalesRecipe"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesRecipe_productId_version_key" ON "SalesRecipe"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SalesRecipe_modifierOptionId_version_key" ON "SalesRecipe"("modifierOptionId", "version");

-- CreateIndex
CREATE INDEX "SalesRecipeLine_salesRecipeId_idx" ON "SalesRecipeLine"("salesRecipeId");

-- CreateIndex
CREATE INDEX "SalesRecipeLine_orgId_genericItemId_idx" ON "SalesRecipeLine"("orgId", "genericItemId");

-- CreateIndex
CREATE INDEX "ConsumptionEvent_orgId_warehouseId_occurredAt_idx" ON "ConsumptionEvent"("orgId", "warehouseId", "occurredAt");

-- CreateIndex
CREATE INDEX "ConsumptionEvent_orgId_status_idx" ON "ConsumptionEvent"("orgId", "status");

-- CreateIndex
CREATE INDEX "ConsumptionEvent_orgId_saleId_idx" ON "ConsumptionEvent"("orgId", "saleId");

-- CreateIndex
CREATE INDEX "ConsumptionEvent_orgId_kind_day_idx" ON "ConsumptionEvent"("orgId", "kind", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionEvent_saleLineId_kind_key" ON "ConsumptionEvent"("saleLineId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionEvent_countLineId_kind_key" ON "ConsumptionEvent"("countLineId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionEvent_orgId_clientKey_key" ON "ConsumptionEvent"("orgId", "clientKey");

-- CreateIndex
CREATE INDEX "DemandDaily_orgId_genericItemId_day_idx" ON "DemandDaily"("orgId", "genericItemId", "day");

-- CreateIndex
CREATE INDEX "StockMovement_consumptionEventId_idx" ON "StockMovement"("consumptionEventId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_consumptionEventId_fkey" FOREIGN KEY ("consumptionEventId") REFERENCES "ConsumptionEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRecipe" ADD CONSTRAINT "SalesRecipe_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRecipe" ADD CONSTRAINT "SalesRecipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRecipe" ADD CONSTRAINT "SalesRecipe_modifierOptionId_fkey" FOREIGN KEY ("modifierOptionId") REFERENCES "ModifierOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRecipeLine" ADD CONSTRAINT "SalesRecipeLine_salesRecipeId_fkey" FOREIGN KEY ("salesRecipeId") REFERENCES "SalesRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRecipeLine" ADD CONSTRAINT "SalesRecipeLine_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionEvent" ADD CONSTRAINT "ConsumptionEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandDaily" ADD CONSTRAINT "DemandDaily_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherDaily" ADD CONSTRAINT "WeatherDaily_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

