-- CreateTable
CREATE TABLE "MydataDayCheck" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "issuerVat" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "invType" TEXT NOT NULL,
    "oursCount" INTEGER NOT NULL,
    "oursCents" INTEGER NOT NULL,
    "aadeCount" INTEGER,
    "aadeCents" INTEGER,
    "status" TEXT NOT NULL,
    "firstDiffAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MydataDayCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MydataDayCheck_orgId_issuerVat_day_invType_key" ON "MydataDayCheck"("orgId", "issuerVat", "day", "invType");
CREATE INDEX "MydataDayCheck_orgId_status_idx" ON "MydataDayCheck"("orgId", "status");
ALTER TABLE "MydataDayCheck" ADD CONSTRAINT "MydataDayCheck_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
