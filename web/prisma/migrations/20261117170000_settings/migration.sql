-- AlterTable
ALTER TABLE "PlatformSettings" DROP COLUMN "bunnyCdnUrl",
DROP COLUMN "bunnyKey",
DROP COLUMN "bunnyRegion",
DROP COLUMN "bunnyZone";

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

