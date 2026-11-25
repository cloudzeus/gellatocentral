-- Τριπλή συμφωνία μίας παραλαβής προς ένα τιμολόγιο, χωρίς αλλαγή των stock writers.
-- AlterTable
ALTER TABLE "PurchaseReceipt" ADD COLUMN "invoiceRequestHash" TEXT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "invoiceMatchStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "PurchaseReceipt" ADD COLUMN "invoiceReviewedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseReceipt" ADD COLUMN "invoiceReviewedByName" TEXT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "invoiceReviewNote" TEXT;

-- Ιστορικά συνδεδεμένα τιμολόγια παραμένουν έγκυρα· δεν επινοούνται retroactive line matches.
UPDATE "PurchaseReceipt"
SET "invoiceMatchStatus" = 'REVIEWED',
    "invoiceReviewedAt" = "createdAt",
    "invoiceReviewedByName" = "createdByName",
    "invoiceReviewNote" = 'Υφιστάμενο τιμολόγιο πριν από τον δομημένο τριπλό έλεγχο'
WHERE "invoiceDocId" IS NOT NULL;

-- CreateTable
CREATE TABLE "PurchaseInvoiceLineMatch" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "receiptLineId" TEXT NOT NULL,
  "invoiceLineId" TEXT NOT NULL,
  "quantityBase" INTEGER NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "discountBps" INTEGER NOT NULL DEFAULT 0,
  "vatRate" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseInvoiceLineMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoiceDiscrepancy" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "expectedQuantityBase" INTEGER,
  "actualQuantityBase" INTEGER,
  "expectedUnitPriceCents" INTEGER,
  "actualUnitPriceCents" INTEGER,
  "expectedVatRate" INTEGER,
  "actualVatRate" INTEGER,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseInvoiceDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoiceLineMatch_receiptLineId_key" ON "PurchaseInvoiceLineMatch"("receiptLineId");
CREATE UNIQUE INDEX "PurchaseInvoiceLineMatch_invoiceLineId_key" ON "PurchaseInvoiceLineMatch"("invoiceLineId");
CREATE INDEX "PurchaseInvoiceLineMatch_orgId_receiptId_idx" ON "PurchaseInvoiceLineMatch"("orgId", "receiptId");
CREATE UNIQUE INDEX "PurchaseInvoiceDiscrepancy_matchId_kind_key" ON "PurchaseInvoiceDiscrepancy"("matchId", "kind");
CREATE INDEX "PurchaseInvoiceDiscrepancy_orgId_receiptId_idx" ON "PurchaseInvoiceDiscrepancy"("orgId", "receiptId");
CREATE INDEX "PurchaseInvoiceDiscrepancy_orgId_kind_createdAt_idx" ON "PurchaseInvoiceDiscrepancy"("orgId", "kind", "createdAt");
CREATE INDEX "PurchaseReceipt_orgId_invoiceMatchStatus_createdAt_idx" ON "PurchaseReceipt"("orgId", "invoiceMatchStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLineMatch" ADD CONSTRAINT "PurchaseInvoiceLineMatch_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceLineMatch" ADD CONSTRAINT "PurchaseInvoiceLineMatch_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceLineMatch" ADD CONSTRAINT "PurchaseInvoiceLineMatch_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "PurchaseReceiptLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceLineMatch" ADD CONSTRAINT "PurchaseInvoiceLineMatch_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "PurchaseLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceDiscrepancy" ADD CONSTRAINT "PurchaseInvoiceDiscrepancy_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceDiscrepancy" ADD CONSTRAINT "PurchaseInvoiceDiscrepancy_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "PurchaseInvoiceLineMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
