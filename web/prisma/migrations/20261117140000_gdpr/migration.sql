-- CreateEnum
CREATE TYPE "ErasureStatus" AS ENUM ('PENDING', 'REJECTED', 'COMPLETED');

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "legalVersion" TEXT,
ADD COLUMN     "privacyUrl" TEXT,
ADD COLUMN     "termsUrl" TEXT;

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErasureRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectLabel" TEXT,
    "subjectHash" TEXT NOT NULL,
    "reason" TEXT,
    "requestedById" TEXT,
    "status" "ErasureStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "summary" JSONB,

    CONSTRAINT "ErasureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GdprEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" TEXT,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "subjectLabel" TEXT,
    "detail" JSONB,

    CONSTRAINT "GdprEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consent_orgId_subjectType_subjectId_purpose_at_idx" ON "Consent"("orgId", "subjectType", "subjectId", "purpose", "at");

-- CreateIndex
CREATE INDEX "ErasureRequest_orgId_status_dueAt_idx" ON "ErasureRequest"("orgId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "GdprEvent_orgId_at_idx" ON "GdprEvent"("orgId", "at");

-- CreateIndex
CREATE INDEX "GdprEvent_subjectType_subjectId_idx" ON "GdprEvent"("subjectType", "subjectId");

