-- CreateEnum
CREATE TYPE "ItemNature" AS ENUM ('GOODS', 'PRODUCT', 'SERVICE');

-- AlterTable
ALTER TABLE "DocumentSeries" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "transmit" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "orgId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FiscalDocument" ADD COLUMN     "aa" INTEGER,
ADD COLUMN     "chargeId" TEXT,
ADD COLUMN     "mark" TEXT,
ADD COLUMN     "totalCents" INTEGER,
ALTER COLUMN "orgId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GenericItem" ADD COLUMN     "nature" "ItemNature" NOT NULL DEFAULT 'GOODS';

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_chargeId_key" ON "FiscalDocument"("chargeId");

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "SubscriptionCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Σειρές της πλατφόρμας (orgId κενό): στην Postgres τα NULL δεν συγκρούονται στο @@unique
CREATE UNIQUE INDEX "DocumentSeries_platform_docType_code_key" ON "DocumentSeries"("docType", "code") WHERE "orgId" IS NULL;

-- ftReceiptCase από τα δείγματα της Viva (greece-samples): τιμολόγια 0x0008_1002 (δική μας αρίθμηση),
-- πιστωτικό 5.1 0x0108_1002 (+ επιστροφή), δελτίο αποστολής 9.3 0x0408_0005 (+ στοιχεία μεταφοράς).
-- Το 2.1 επαληθεύτηκε στο demo στις 2026-11-25 (MARK 400001977048610).
UPDATE "DocumentType" SET "receiptCase" = '5139205309155774466' WHERE "code" IN ('1.1', '2.1') AND "receiptCase" IS NULL;
UPDATE "DocumentType" SET "receiptCase" = '5139205309172551682' WHERE "code" = '5.1' AND "receiptCase" IS NULL;
UPDATE "DocumentType" SET "receiptCase" = '5139205309222879237' WHERE "code" = '9.3' AND "receiptCase" IS NULL;

-- Ο αριθμός των παραστατικών εκτός ταμείου ζούσε μόνο στο request
UPDATE "FiscalDocument" SET "aa" = ("request"->>'aa')::int WHERE "seriesId" IS NOT NULL AND "request" ? 'aa' AND "aa" IS NULL;
