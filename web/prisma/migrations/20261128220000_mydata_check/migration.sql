-- Έλεγχος σκαναρισμένων παραστατικών προμηθευτών με το myDATA
CREATE TABLE "MydataCheck" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "purchaseDocId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "diff" JSONB,
    "mydata" JSONB,
    "error" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "recheckUntil" TIMESTAMP(3),
    "resolution" TEXT,
    "resolvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "MydataCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MydataCheck_purchaseDocId_key" ON "MydataCheck"("purchaseDocId");
CREATE INDEX "MydataCheck_orgId_status_idx" ON "MydataCheck"("orgId", "status");
ALTER TABLE "MydataCheck" ADD CONSTRAINT "MydataCheck_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MydataCheck" ADD CONSTRAINT "MydataCheck_purchaseDocId_fkey" FOREIGN KEY ("purchaseDocId") REFERENCES "PurchaseDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
