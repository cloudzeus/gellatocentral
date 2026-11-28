-- Τιμολόγια προμηθευτών που βρέθηκαν στο myDATA και λείπουν (ή όχι) από τις αγορές
CREATE TABLE "MydataIncoming" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mark" TEXT NOT NULL,
    "supplierVat" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "type" TEXT,
    "series" TEXT,
    "number" TEXT,
    "issuedAt" TIMESTAMP(3),
    "netCents" INTEGER,
    "vatCents" INTEGER,
    "grossCents" INTEGER,
    "doc" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MISSING',
    "purchaseDocId" TEXT,
    "ignoredReason" TEXT,
    "resolvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MydataIncoming_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MydataIncoming_purchaseDocId_key" ON "MydataIncoming"("purchaseDocId");
CREATE UNIQUE INDEX "MydataIncoming_orgId_mark_key" ON "MydataIncoming"("orgId", "mark");
CREATE INDEX "MydataIncoming_orgId_status_idx" ON "MydataIncoming"("orgId", "status");
ALTER TABLE "MydataIncoming" ADD CONSTRAINT "MydataIncoming_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MydataIncoming" ADD CONSTRAINT "MydataIncoming_purchaseDocId_fkey" FOREIGN KEY ("purchaseDocId") REFERENCES "PurchaseDoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;
