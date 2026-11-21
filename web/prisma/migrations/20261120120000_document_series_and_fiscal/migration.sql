-- AlterTable: το orgId μπαίνει πρώτα nullable, γεμίζει από την πώληση και μετά γίνεται υποχρεωτικό
ALTER TABLE "FiscalDocument" ADD COLUMN     "orgId" TEXT,
ADD COLUMN     "partyId" TEXT,
ADD COLUMN     "relatedId" TEXT,
ADD COLUMN     "seriesId" TEXT,
ALTER COLUMN "saleId" DROP NOT NULL;

UPDATE "FiscalDocument" fd SET "orgId" = s."orgId" FROM "Sale" s WHERE fd."saleId" = s."id";

ALTER TABLE "FiscalDocument" ALTER COLUMN "orgId" SET NOT NULL;

-- CreateTable
CREATE TABLE "DocumentSeries" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "docType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nextAa" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSeries_orgId_docType_code_key" ON "DocumentSeries"("orgId", "docType", "code");

-- CreateIndex
CREATE INDEX "FiscalDocument_orgId_docType_createdAt_idx" ON "FiscalDocument"("orgId", "docType", "createdAt");

-- CreateIndex: έλειπε από τη βάση αν και το σχήμα το δηλώνει
CREATE UNIQUE INDEX "VatRate_rate_key" ON "VatRate"("rate");

-- AddForeignKey
ALTER TABLE "DocumentSeries" ADD CONSTRAINT "DocumentSeries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSeries" ADD CONSTRAINT "DocumentSeries_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "DocumentSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_relatedId_fkey" FOREIGN KEY ("relatedId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
