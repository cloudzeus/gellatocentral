-- 8.6 Δελτίο Παραγγελίας Εστίασης: ένα ανά αποστολή στο τραπέζι (BillRound)
ALTER TABLE "FiscalDocument" ADD COLUMN "billRoundId" TEXT;
CREATE UNIQUE INDEX "FiscalDocument_billRoundId_key" ON "FiscalDocument"("billRoundId");
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_billRoundId_fkey" FOREIGN KEY ("billRoundId") REFERENCES "BillRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 0x4752_2000_0008_3004: «Order» + δική μας αρίθμηση
INSERT INTO "DocumentType" ("id", "code", "title", "sign", "retail", "needsParty", "needsRelated", "receiptCase", "active", "sort")
VALUES ('dt_8_6', '8.6', 'Δελτίο Παραγγελίας Εστίασης', 1, true, false, false, '5139205309155782660', true, 6)
ON CONFLICT ("code") DO NOTHING;
