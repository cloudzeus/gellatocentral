-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastBackupCheckAt" TIMESTAMP(3),
ADD COLUMN     "lastRestoreDrillAt" TIMESTAMP(3);

