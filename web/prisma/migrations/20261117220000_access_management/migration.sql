-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccessEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessEvent_orgId_createdAt_idx" ON "AccessEvent"("orgId", "createdAt");

