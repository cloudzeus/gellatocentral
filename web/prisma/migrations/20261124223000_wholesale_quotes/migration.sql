-- CreateEnum
CREATE TYPE "WholesaleQuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "WholesaleQuote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "WholesaleQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3) NOT NULL,
    "neededAt" TIMESTAMP(3),
    "note" TEXT,
    "netCents" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "customerSnapshot" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiredAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleQuoteLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "unitScale" INTEGER NOT NULL,
    "quantityBase" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,

    CONSTRAINT "WholesaleQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleQuote_orgId_number_key" ON "WholesaleQuote"("orgId", "number");

-- CreateIndex
CREATE INDEX "WholesaleQuote_orgId_customerId_status_validUntil_idx" ON "WholesaleQuote"("orgId", "customerId", "status", "validUntil");

-- CreateIndex
CREATE INDEX "WholesaleQuote_orgId_storeId_warehouseId_status_idx" ON "WholesaleQuote"("orgId", "storeId", "warehouseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleQuote_orderId_key" ON "WholesaleQuote"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleQuoteLine_quoteId_genericItemId_key" ON "WholesaleQuoteLine"("quoteId", "genericItemId");

-- CreateIndex
CREATE INDEX "WholesaleQuoteLine_orgId_genericItemId_idx" ON "WholesaleQuoteLine"("orgId", "genericItemId");

-- AddForeignKey
ALTER TABLE "WholesaleQuote" ADD CONSTRAINT "WholesaleQuote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleQuote" ADD CONSTRAINT "WholesaleQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WholesaleOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleQuoteLine" ADD CONSTRAINT "WholesaleQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "WholesaleQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Τα snapshots και η μοναδική μετατροπή προστατεύονται και εκτός application validation.
ALTER TABLE "WholesaleQuote" ADD CONSTRAINT "WholesaleQuote_totals_check" CHECK ("netCents" >= 0 AND "vatCents" >= 0 AND "totalCents" >= 0);
ALTER TABLE "WholesaleQuoteLine" ADD CONSTRAINT "WholesaleQuoteLine_values_check" CHECK ("quantityBase" > 0 AND "unitScale" > 0 AND "unitPriceCents" >= 0 AND "vatRate" BETWEEN 0 AND 100);
