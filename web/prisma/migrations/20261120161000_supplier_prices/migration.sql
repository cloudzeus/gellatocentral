-- CreateTable
CREATE TABLE "SupplierItemPrice" (
    "id" TEXT NOT NULL,
    "supplierItemId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "minPackQty" INTEGER,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierItemPrice_supplierItemId_validFrom_idx" ON "SupplierItemPrice"("supplierItemId", "validFrom");

-- AddForeignKey
ALTER TABLE "SupplierItemPrice" ADD CONSTRAINT "SupplierItemPrice_supplierItemId_fkey" FOREIGN KEY ("supplierItemId") REFERENCES "SupplierItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
