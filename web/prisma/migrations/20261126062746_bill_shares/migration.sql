-- CreateEnum
CREATE TYPE "BillShareStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "BillShare" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "BillShareStatus" NOT NULL DEFAULT 'PENDING',
    "vivaTransactionId" TEXT,
    "saleId" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "BillShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillShare_reference_key" ON "BillShare"("reference");

-- CreateIndex
CREATE INDEX "BillShare_billId_status_idx" ON "BillShare"("billId", "status");

-- CreateIndex
CREATE INDEX "BillShare_deviceId_status_idx" ON "BillShare"("deviceId", "status");

-- CreateIndex
CREATE INDEX "BillShare_saleId_idx" ON "BillShare"("saleId");

-- AddForeignKey
ALTER TABLE "BillShare" ADD CONSTRAINT "BillShare_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillShare" ADD CONSTRAINT "BillShare_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillShare" ADD CONSTRAINT "BillShare_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
