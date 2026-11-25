-- Ρητός τιμολογιακός έλεγχος παραλαβής πριν από τη δημιουργία χρηματοοικονομικού τιμολογίου.
-- AlterTable
ALTER TABLE "PurchaseReceipt" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'PROVISIONAL';
ALTER TABLE "PurchaseReceipt" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseReceipt" ADD COLUMN "reviewedByName" TEXT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "reviewNote" TEXT;

-- Οι ιστορικές παραλαβές παραμένουν τιμολογήσιμες· η προσωρινή κατάσταση αφορά τις νέες.
UPDATE "PurchaseReceipt"
SET "reviewStatus" = 'REVIEWED',
    "reviewedAt" = "createdAt",
    "reviewedByName" = "createdByName",
    "reviewNote" = 'Υφιστάμενη παραλαβή πριν από τον δομημένο τιμολογιακό έλεγχο';

-- CreateTable
CREATE TABLE "PurchaseReceiptDiscrepancy" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "receiptLineId" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "expectedPriceCents" INTEGER NOT NULL,
  "actualPriceCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceiptDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptDiscrepancy_receiptLineId_key" ON "PurchaseReceiptDiscrepancy"("receiptLineId");
CREATE INDEX "PurchaseReceiptDiscrepancy_orgId_receiptId_idx" ON "PurchaseReceiptDiscrepancy"("orgId", "receiptId");
CREATE INDEX "PurchaseReceiptDiscrepancy_orgId_kind_createdAt_idx" ON "PurchaseReceiptDiscrepancy"("orgId", "kind", "createdAt");
CREATE INDEX "PurchaseReceipt_orgId_reviewStatus_createdAt_idx" ON "PurchaseReceipt"("orgId", "reviewStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "PurchaseReceiptDiscrepancy" ADD CONSTRAINT "PurchaseReceiptDiscrepancy_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptDiscrepancy" ADD CONSTRAINT "PurchaseReceiptDiscrepancy_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "PurchaseReceiptLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
