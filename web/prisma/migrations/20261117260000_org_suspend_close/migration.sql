-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "closingAt" TIMESTAMP(3),
ADD COLUMN     "deleteAfter" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

