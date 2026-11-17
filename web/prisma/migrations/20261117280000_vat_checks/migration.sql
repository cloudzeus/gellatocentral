-- CreateTable
CREATE TABLE "VatCheck" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "vat" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "valid" BOOLEAN,
    "name" TEXT,
    "address" TEXT,
    "provider" TEXT,
    "source" TEXT,
    "consultationNumber" TEXT,
    "requester" TEXT,
    "match" JSONB,
    "error" TEXT,
    "message" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VatCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VatCheck_vat_createdAt_idx" ON "VatCheck"("vat", "createdAt");

-- CreateIndex
CREATE INDEX "VatCheck_orgId_createdAt_idx" ON "VatCheck"("orgId", "createdAt");

