-- Σερβιτόρος: θέσεις, «Μετά», σερβιρίστηκε, ζήτησε λογαριασμό, «Τελείωσε»
ALTER TABLE "Bill" ADD COLUMN "waiterId" TEXT, ADD COLUMN "billAskedAt" TIMESTAMP(3), ADD COLUMN "billAskedCash" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BillRound" ADD COLUMN "held" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BillLine" ADD COLUMN "seat" INTEGER, ADD COLUMN "servedAt" TIMESTAMP(3);

CREATE TABLE "SoldOut" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SoldOut_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SoldOut_storeId_itemId_key" ON "SoldOut"("storeId", "itemId");
ALTER TABLE "SoldOut" ADD CONSTRAINT "SoldOut_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
