-- Επιστροφές σε προμηθευτή (9.3 σκοπός 5) και πιστωτικά προμηθευτή (5.1/5.2)
ALTER TABLE "PurchaseDoc" ADD COLUMN "relatedId" TEXT;
ALTER TABLE "PurchaseDoc" ADD COLUMN "returnId" TEXT;
ALTER TABLE "PurchaseDoc" ADD COLUMN "fiscalDocumentId" TEXT;
ALTER TABLE "PurchaseDoc" ADD COLUMN "mydataType" TEXT;
ALTER TABLE "PurchaseDoc" ADD COLUMN "relatedMark" TEXT;
ALTER TABLE "PurchaseDoc" ADD COLUMN "stockMode" TEXT;
ALTER TABLE "PurchaseDoc" ADD COLUMN "creditCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseLine" ADD COLUMN "sourceLineId" TEXT;

CREATE UNIQUE INDEX "PurchaseDoc_fiscalDocumentId_key" ON "PurchaseDoc"("fiscalDocumentId");
CREATE INDEX "PurchaseDoc_orgId_relatedId_idx" ON "PurchaseDoc"("orgId", "relatedId");

ALTER TABLE "PurchaseDoc" ADD CONSTRAINT "PurchaseDoc_relatedId_fkey" FOREIGN KEY ("relatedId") REFERENCES "PurchaseDoc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDoc" ADD CONSTRAINT "PurchaseDoc_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PurchaseDoc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDoc" ADD CONSTRAINT "PurchaseDoc_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
