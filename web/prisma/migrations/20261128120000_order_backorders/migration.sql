-- Μερικές παραλαβές: τιμολόγιο παραγγελίας, δελτία αποστολής, αναμενόμενα και αιτήματα πιστωτικού
ALTER TABLE "PurchaseOrder" ADD COLUMN "invoiceDocId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "creditRequestedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "closedBaseQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "expectedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseReceipt" ADD COLUMN "deliveryNoteNumber" TEXT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "deliveryNoteDate" TIMESTAMP(3);
ALTER TABLE "PurchaseReceipt" ADD COLUMN "deliveryNoteMark" TEXT;

CREATE UNIQUE INDEX "PurchaseOrder_invoiceDocId_key" ON "PurchaseOrder"("invoiceDocId");
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_invoiceDocId_fkey" FOREIGN KEY ("invoiceDocId") REFERENCES "PurchaseDoc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
