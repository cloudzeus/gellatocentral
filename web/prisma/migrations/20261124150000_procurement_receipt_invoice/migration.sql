-- Διαχωρισμός μη χρηματοοικονομικής παραλαβής από το τιμολόγιο αγοράς.
-- AlterTable
ALTER TABLE "PurchaseDoc" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'INVOICE';
ALTER TABLE "PurchaseReceipt" ADD COLUMN "invoiceDocId" TEXT;

-- Οι ήδη συνδεδεμένες παραλαβές αλλάζουν μόνο κατηγορία· κινήσεις, παρτίδες και κόστη μένουν ανέγγιχτα.
UPDATE "PurchaseDoc" AS doc
SET "kind" = 'RECEIPT'
WHERE EXISTS (
  SELECT 1
  FROM "PurchaseReceipt" AS receipt
  WHERE receipt."purchaseDocId" = doc."id"
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_invoiceDocId_key" ON "PurchaseReceipt"("invoiceDocId");
CREATE INDEX "PurchaseDoc_orgId_kind_status_issuedAt_idx" ON "PurchaseDoc"("orgId", "kind", "status", "issuedAt");

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_invoiceDocId_fkey" FOREIGN KEY ("invoiceDocId") REFERENCES "PurchaseDoc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
